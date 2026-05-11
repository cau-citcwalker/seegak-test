"""Build per-gene visualization cache from an h5ad file.

Unlike build_csc.py (which stores the entire expression matrix for
arbitrary access), this script produces *only* what's needed to
visualize: subsampled cells × quantized per-gene sparse values.

Output layout:
    viz_cache/<dataset>/
        meta.json                # {n_cells, gene_count, subsample_seed}
        genes.txt                # one gene name per line (alphabet-safe filenames)
        expr/<safe_name>.bin     # per-gene sparse-quantized payload

Per-gene binary format (little-endian):
    [u32 n_total]                # number of cells in the subsample
    [u32 nnz]                    # number of non-zero entries
    [u32 max_raw_encoded]        # max expression value * 1e6 (for dequantization)
    [u32 * nnz row_ids]          # cell indices (0..n_total-1)
    [u8  * nnz quantized_values] # value / max * 255

Client reconstructs: out = Float32Array(n_total) filled with zeros,
then out[row_ids[i]] = quantized[i] / 255 * (max_raw_encoded / 1e6).

Usage:
    python build_viz_cache.py <dataset-id> [--n-cells 100000] [--top-hvg 0]

Dataset id corresponds to the h5ad filename stem:
    h5ad/<dataset-id>.h5ad  →  viz_cache/<dataset-id>/
"""
import argparse
import json
import re
import sqlite3
import struct
import sys
import time
from pathlib import Path

import numpy as np
import h5py
import scipy.sparse as sp

BASE_DIR = Path(__file__).parent
H5AD_DIR = BASE_DIR / "h5ad"
CACHE_DIR = BASE_DIR / "viz_cache"
DB_PATH = BASE_DIR / "viz_scatter.db"


def _safe_filename(name: str) -> str:
    """Make a gene symbol safe for use as a filename on any OS."""
    return re.sub(r"[^A-Za-z0-9._\-]", "_", name)[:200]


def _find_matrix(h5: h5py.File):
    for path in ["X", "layers/normalized", "layers/counts"]:
        if path in h5:
            g = h5[path]
            if hasattr(g, "keys") and "data" in g and "indices" in g and "indptr" in g:
                return g
    return None


def _decode_strs(arr) -> list[str]:
    return [v.decode() if isinstance(v, bytes) else str(v) for v in arr]


def _read_obs_var_column(group: h5py.Group, key: str) -> list[str]:
    """Read a column, transparently decoding AnnData categorical encoding.

    AnnData stores categorical columns as integer codes in `<col>` plus the
    string categories in `__categories/<col>`. Reading the raw column gives
    numbers; we need to follow the codes through __categories.
    """
    raw = group[key][:]
    # If categories exist for this column, treat values as codes
    cats_group = group.get("__categories")
    if cats_group is not None and key in cats_group:
        cats = _decode_strs(cats_group[key][:])
        return [cats[c] if 0 <= int(c) < len(cats) else "" for c in raw]
    return _decode_strs(raw)


def _looks_symbolic(names: list[str]) -> bool:
    """Heuristic: real gene symbols are mostly alphabetic, not pure digits or Ensembl IDs."""
    sample = names[:100] if len(names) > 100 else names
    if not sample:
        return False
    good = sum(
        1 for n in sample
        if n and any(c.isalpha() for c in n) and not n.startswith("ENS") and not n.isdigit()
    )
    return good >= len(sample) * 0.5


def _find_gene_names(h5: h5py.File) -> list[str]:
    """Find the most human-readable gene name column available.

    Preference order: symbol-like columns first, with categorical decoding,
    falling back to the AnnData _index (which may be Ensembl IDs).
    """
    var = h5["var"]
    index_key = var.attrs.get("_index", "_index")
    if isinstance(index_key, bytes):
        index_key = index_key.decode()

    # Try symbol-bearing columns; accept the first one that yields real symbols
    for key in ["gene_name", "feature_name", "Approved symbol", "gene_symbol", "symbol"]:
        if key in var:
            names = _read_obs_var_column(var, key)
            if _looks_symbolic(names):
                return names

    # Fall back to _index (AnnData's canonical identifier — symbol or Ensembl ID)
    if index_key in var:
        names = _read_obs_var_column(var, index_key)
        if names:
            return names

    raise RuntimeError("No usable gene name column found in var")


def _find_labels(h5: h5py.File) -> list[str]:
    """Extract cell type / cluster labels from obs."""
    for col in ["cell_type", "leiden", "louvain", "cluster", "seurat_clusters",
                 "Broad cell type", "Cell types level 2"]:
        if col not in h5["obs"]:
            continue
        obs_col = h5["obs"][col]
        if "categories" in obs_col:
            cats = obs_col["categories"][:]
            codes = obs_col["codes"][:]
            cats = [c.decode() if isinstance(c, bytes) else str(c) for c in cats]
            return [cats[c] if 0 <= c < len(cats) else "unknown" for c in codes]
        data = obs_col[:]
        return [v.decode() if isinstance(v, bytes) else str(v) for v in data]
    return []


def _find_embedding(h5: h5py.File) -> tuple[np.ndarray | None, str]:
    """Find best 2D embedding in obsm (UMAP preferred)."""
    for key in ["X_umap", "X_scVI", "X_pca"]:
        if key in h5["obsm"]:
            return h5["obsm"][key][:, :2].astype(np.float32), key
    return None, ""


def _compute_3d_umap(h5: h5py.File, row_idx: np.ndarray, seed: int) -> np.ndarray | None:
    """Compute 3D UMAP from PCA. Returns (n, 3) float32 or None."""
    if "X_pca" not in h5["obsm"]:
        return None
    pca_full = h5["obsm"]["X_pca"]
    pca = pca_full[row_idx, :].astype(np.float32) if len(row_idx) < pca_full.shape[0] else pca_full[:].astype(np.float32)
    n_components = min(pca.shape[1], 50)
    pca = pca[:, :n_components]

    print(f"  computing 3D UMAP ({len(pca)} cells, {n_components}D PCA)…")
    t0 = time.perf_counter()
    import umap
    reducer = umap.UMAP(n_components=3, random_state=seed, n_jobs=-1)
    coords_3d = reducer.fit_transform(pca).astype(np.float32)
    print(f"  3D UMAP done in {time.perf_counter() - t0:.1f}s")
    return coords_3d


def _build_scatter_db(
    dataset_id: str,
    x2d: np.ndarray, y2d: np.ndarray,
    umap3d: np.ndarray | None,
    labels: list[str],
) -> None:
    """Store precomputed scatter coordinates in SQLite.

    Stores both the 2D embedding (for flat mode) and the full 3D UMAP
    (for 3D mode) so the client gets consistent coordinates for each view.
    """
    table = f"scatter_{re.sub(r'[^A-Za-z0-9_]', '_', dataset_id)}"
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(f"DROP TABLE IF EXISTS [{table}]")
    conn.execute(f"""
        CREATE TABLE [{table}] (
            id    INTEGER PRIMARY KEY,
            x     REAL NOT NULL,
            y     REAL NOT NULL,
            x3    REAL,
            y3    REAL,
            z3    REAL,
            label TEXT NOT NULL
        )
    """)
    has_3d = umap3d is not None
    rows = []
    for i in range(len(x2d)):
        rows.append((
            i, float(x2d[i]), float(y2d[i]),
            float(umap3d[i, 0]) if has_3d else None,
            float(umap3d[i, 1]) if has_3d else None,
            float(umap3d[i, 2]) if has_3d else None,
            labels[i],
        ))
    conn.executemany(f"INSERT INTO [{table}] VALUES (?,?,?,?,?,?,?)", rows)
    conn.execute(f"CREATE INDEX [{table}_label_idx] ON [{table}](label)")
    conn.commit()
    conn.close()
    print(f"  scatter DB: {len(rows)} rows → {table} ({'with' if has_3d else 'no'} 3D)")


def build(dataset_id: str, n_cells: int, top_hvg: int, seed: int = 42) -> None:
    h5_path = H5AD_DIR / f"{dataset_id}.h5ad"
    if not h5_path.exists():
        print(f"[err] {h5_path} not found", file=sys.stderr)
        sys.exit(1)

    out_dir = CACHE_DIR / dataset_id
    expr_dir = out_dir / "expr"
    expr_dir.mkdir(parents=True, exist_ok=True)

    print(f"[load] {h5_path}")
    with h5py.File(str(h5_path), "r") as h5:
        X = _find_matrix(h5)
        if X is None:
            raise RuntimeError("No sparse X/layer found")
        total_cells, total_genes = tuple(X.attrs["shape"])
        print(f"  shape=({total_cells}, {total_genes}), nnz={len(X['data'])}")

        # Subsample rows — must match scatter endpoint (RNG seed=42 + sort)
        actual_n = min(n_cells, total_cells)
        if actual_n < total_cells:
            rng = np.random.default_rng(seed)
            row_idx = rng.choice(total_cells, actual_n, replace=False)
            row_idx.sort()
        else:
            row_idx = np.arange(total_cells, dtype=np.int64)
        print(f"  subsample: {actual_n} / {total_cells} cells")

        # ── Scatter coordinates: 2D embedding + 3D UMAP ──
        embed, embed_key = _find_embedding(h5)
        if embed is None:
            raise RuntimeError("No embedding found in obsm")
        print(f"  2D embedding: {embed_key}")
        embed_sub = embed[row_idx] if actual_n < total_cells else embed

        umap_3d = _compute_3d_umap(h5, row_idx, seed)

        labels = _find_labels(h5)
        if not labels:
            labels = ["unknown"] * total_cells
        labels_sub = [labels[i] for i in row_idx] if actual_n < total_cells else labels

        # ── Store scatter data in SQLite ──
        _build_scatter_db(
            dataset_id,
            x2d=embed_sub[:, 0], y2d=embed_sub[:, 1],
            umap3d=umap_3d,
            labels=labels_sub,
        )

        gene_names = _find_gene_names(h5)
        if len(gene_names) != total_genes:
            print(f"  [warn] gene name count ({len(gene_names)}) != var dim ({total_genes})")

        # ── Expression: Load CSR → slice rows → CSC ──
        print("  reading CSR…")
        csr = sp.csr_matrix(
            (X["data"][:], X["indices"][:], X["indptr"][:]),
            shape=(total_cells, total_genes),
        )
        print("  subsampling rows…")
        sub = csr[row_idx, :]
        del csr
        print("  converting to CSC…")
        csc = sub.tocsc()
        del sub

    # Optional HVG filter: keep top-N genes by variance
    gene_keep = np.arange(total_genes, dtype=np.int32)
    if top_hvg > 0 and top_hvg < total_genes:
        print(f"  computing gene variance for HVG top-{top_hvg}…")
        # Variance of sparse column = E[X^2] - E[X]^2, computed per column
        n_rows = csc.shape[0]
        means = np.asarray(csc.mean(axis=0)).ravel()
        sq = csc.multiply(csc)
        mean_sq = np.asarray(sq.mean(axis=0)).ravel()
        variance = mean_sq - means * means
        gene_keep = np.argsort(-variance)[:top_hvg]
        gene_keep.sort()
        print(f"  kept {len(gene_keep)} / {total_genes} genes")

    # Write per-gene files
    print(f"[write] {expr_dir}")
    kept_names: list[str] = []
    kept_safe: list[str] = []
    skipped_empty = 0
    for i, gene_col in enumerate(gene_keep):
        gene_col = int(gene_col)
        name = gene_names[gene_col] if gene_col < len(gene_names) else f"gene_{gene_col}"
        safe = _safe_filename(name)
        col_start = int(csc.indptr[gene_col])
        col_end = int(csc.indptr[gene_col + 1])
        nnz = col_end - col_start
        if nnz == 0:
            skipped_empty += 1
            continue

        row_ids = csc.indices[col_start:col_end].astype(np.uint32)
        values = csc.data[col_start:col_end].astype(np.float32)
        vmax = float(values.max())
        if vmax <= 0:
            skipped_empty += 1
            continue

        # Quantize to uint8: value / vmax * 255
        quantized = np.clip(np.round(values / vmax * 255.0), 0, 255).astype(np.uint8)
        max_encoded = int(round(vmax * 1_000_000))  # store as int for portability

        path = expr_dir / f"{safe}.bin"
        with open(path, "wb") as fp:
            fp.write(struct.pack("<III", int(csc.shape[0]), nnz, max_encoded))
            fp.write(row_ids.tobytes())
            fp.write(quantized.tobytes())

        kept_names.append(name)
        kept_safe.append(safe)

        if (i + 1) % 1000 == 0:
            print(f"    {i+1}/{len(gene_keep)}…")

    # Metadata
    meta = {
        "dataset": dataset_id,
        "n_cells": int(csc.shape[0]),
        "original_total_cells": int(total_cells),
        "subsample_seed": seed,
        "gene_count": len(kept_names),
        "skipped_empty": skipped_empty,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    (out_dir / "genes.txt").write_text("\n".join(f"{n}\t{s}" for n, s in zip(kept_names, kept_safe)))

    # Summary
    total_bytes = sum(f.stat().st_size for f in expr_dir.glob("*.bin"))
    print(f"  done: {len(kept_names)} genes, {total_bytes/1e6:.1f}MB total, "
          f"{total_bytes/max(len(kept_names),1)/1024:.1f}KB avg per gene")
    if skipped_empty:
        print(f"  skipped {skipped_empty} empty genes")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("datasets", nargs="*", help="Dataset IDs (h5ad stem). Empty = all files in h5ad/")
    p.add_argument("--n-cells", type=int, default=100_000, help="Max cells to keep (subsample)")
    p.add_argument("--top-hvg", type=int, default=0, help="Keep only top-N highest-variance genes (0=all)")
    args = p.parse_args()

    if not args.datasets:
        args.datasets = [f.stem for f in sorted(H5AD_DIR.glob("*.h5ad"))]
        if not args.datasets:
            print("No h5ad files found", file=sys.stderr)
            sys.exit(1)

    for ds in args.datasets:
        build(ds, n_cells=args.n_cells, top_hvg=args.top_hvg)


if __name__ == "__main__":
    main()
