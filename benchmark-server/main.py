"""
Seegak Benchmark Server
========================
FastAPI server that serves UMAP scatter data for performance benchmarking.

Modes:
  1. h5ad mode  : parse a real AnnData file once → cache in SQLite
  2. Synthetic  : generate UMAP-like clusters when no h5ad is provided

Transports:
  - REST JSON    : GET  /api/scatter.json
  - REST Binary  : GET  /api/scatter
  - WebSocket    : WS   /ws/scatter
  - gRPC-Web     : POST /grpc/scatter
  - MessagePack  : GET  /api/scatter.msgpack
  - FlatBuffers  : GET  /api/scatter.flatbuf
  - Arrow IPC    : GET  /api/scatter.arrow
  - SSE Streaming: GET  /api/scatter.sse
  - Zarr Chunked : GET  /api/scatter.zarr
  - CBOR         : GET  /api/scatter.cbor
  - Parquet      : GET  /api/scatter.parquet
  - Brotli Binary: GET  /api/scatter.br
  - gRPC native  : grpc://localhost:50051

Run:
  pip install -r requirements.txt
  python main.py                          # synthetic data
  python main.py --h5ad path/to/data.h5ad # real h5ad
"""

import argparse
import io
import json
import math
import os
import sqlite3
import struct
import time
import threading
from pathlib import Path
from concurrent import futures

import numpy as np
import uvicorn
import asyncio

from fastapi import FastAPI, HTTPException, Query, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

# ── Global state ─────────────────────────────────────────────────────────────

H5AD_DIR = Path(__file__).parent / "h5ad"
DB_DIR = Path(__file__).parent
DB_PATH = DB_DIR / "benchmark.db"

# In-memory cache: dataset_name -> { x, y, labels, clusters }
_dataset_cache: dict[str, dict] = {}

app = FastAPI(title="Seegak Benchmark Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── DB helpers ────────────────────────────────────────────────────────────────


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cells (
            id      INTEGER PRIMARY KEY,
            x       REAL NOT NULL,
            y       REAL NOT NULL,
            cluster TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cells_cluster ON cells(cluster)")
    conn.commit()


def count_cells(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM cells").fetchone()[0]


# ── Synthetic data generation ─────────────────────────────────────────────────

CLUSTERS = [
    ("AT1",          -5,  3,  1.2, 1.0, 0.08),
    ("AT2",          -3, -4,  1.0, 1.3, 0.12),
    ("Endothelial",   4,  2,  1.5, 1.1, 0.15),
    ("Fibroblast",    6, -3,  1.1, 1.4, 0.09),
    ("Macrophage",   -1,  7,  1.3, 1.2, 0.07),
    ("T Cell",        2, -7,  0.9, 0.8, 0.06),
    ("B Cell",       -7, -1,  0.8, 0.9, 0.04),
    ("NK Cell",       3, -5,  0.7, 0.7, 0.03),
    ("Ciliated",     -4,  0,  1.0, 0.9, 0.05),
    ("Smooth Muscle", 7,  5,  0.9, 1.0, 0.035),
]

COLORS = [
    [228, 26,  28],  [55, 126, 184], [77, 175,  74], [152, 78, 163],
    [255, 127,  0],  [166, 86,  40], [247, 129, 191], [153, 153, 153],
    [102, 194, 165], [252, 141,  98],
]


def generate_synthetic(n_total: int, seed: int = 42) -> tuple[np.ndarray, np.ndarray, list[str]]:
    rng = np.random.default_rng(seed)
    weights = np.array([c[5] for c in CLUSTERS])
    weights /= weights.sum()
    counts = np.round(weights * n_total).astype(int)
    counts[-1] += n_total - counts.sum()  # fix rounding

    xs, ys, labels = [], [], []
    for i, (name, cx, cy, sx, sy, _) in enumerate(CLUSTERS):
        n = int(counts[i])
        xs.append(rng.normal(cx, sx, n))
        ys.append(rng.normal(cy, sy, n))
        labels.extend([name] * n)

    return np.concatenate(xs, dtype=np.float32), np.concatenate(ys, dtype=np.float32), labels


def populate_db_synthetic(conn: sqlite3.Connection, n: int = 1_000_000) -> None:
    print(f"Generating {n:,} synthetic cells...")
    x, y, labels = generate_synthetic(n)
    conn.execute("DELETE FROM cells")
    conn.executemany(
        "INSERT INTO cells (x, y, cluster) VALUES (?, ?, ?)",
        zip(x.tolist(), y.tolist(), labels),
    )
    conn.commit()
    print(f"Stored {n:,} cells in {DB_PATH}")


# ── h5ad support (optional) ───────────────────────────────────────────────────


def populate_db_h5ad(conn: sqlite3.Connection, h5ad_path: str) -> None:
    try:
        import anndata
    except ImportError:
        raise RuntimeError("anndata not installed. Run: pip install anndata")

    print(f"Parsing {h5ad_path}...")
    t0 = time.perf_counter()
    adata = anndata.read_h5ad(h5ad_path)
    print(f"  Loaded in {time.perf_counter() - t0:.1f}s - {adata.n_obs:,} cells")

    # UMAP coordinates
    for key in ["X_umap", "X_scVI", "X_pca"]:
        if key in adata.obsm:
            coords = adata.obsm[key][:, :2].astype(np.float32)
            break
    else:
        raise ValueError("No UMAP/PCA embedding found in .obsm")

    # Cluster labels
    cluster_col = None
    for col in ["leiden", "louvain", "cell_type", "cluster", "seurat_clusters"]:
        if col in adata.obs.columns:
            cluster_col = col
            break
    labels = adata.obs[cluster_col].astype(str).tolist() if cluster_col else ["unknown"] * adata.n_obs

    conn.execute("DELETE FROM cells")
    conn.executemany(
        "INSERT INTO cells (x, y, cluster) VALUES (?, ?, ?)",
        zip(coords[:, 0].tolist(), coords[:, 1].tolist(), labels),
    )
    conn.commit()
    print(f"Stored {adata.n_obs:,} cells in {DB_PATH}")


# ── Shared data query ────────────────────────────────────────────────────────


COLOR_PALETTE_HEX = [
    "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
    "#a65628", "#f781bf", "#999999", "#66c2a5", "#fc8d62",
]


def query_scatter(n: int) -> tuple[np.ndarray, np.ndarray, list[str], list[str], list[str]]:
    """Returns (x, y, labels, colors, clusters) from DB."""
    with get_conn() as conn:
        total = count_cells(conn)
        if total == 0:
            raise ValueError("Database empty.")
        actual_n = min(n, total)
        rows = conn.execute(
            "SELECT x, y, cluster FROM cells ORDER BY RANDOM() LIMIT ?", (actual_n,)
        ).fetchall()

    x_arr = np.array([r[0] for r in rows], dtype=np.float32)
    y_arr = np.array([r[1] for r in rows], dtype=np.float32)
    labels_list = [r[2] for r in rows]
    unique = sorted(set(labels_list))
    c_map = {c: COLOR_PALETTE_HEX[i % len(COLOR_PALETTE_HEX)] for i, c in enumerate(unique)}
    colors_list = [c_map[l] for l in labels_list]
    return x_arr, y_arr, labels_list, colors_list, unique


# ── API endpoints ─────────────────────────────────────────────────────────────


# ── Dataset management ────────────────────────────────────────────────────────


def scan_datasets() -> list[dict]:
    """Scan h5ad/ folder and return available datasets."""
    datasets = [{"id": "synthetic", "name": "Synthetic (1M)", "cells": 0, "source": "generated"}]
    # Count synthetic cells in DB
    try:
        with get_conn() as conn:
            datasets[0]["cells"] = count_cells(conn)
    except Exception:
        pass

    if H5AD_DIR.exists():
        for f in sorted(H5AD_DIR.glob("*.h5ad")):
            try:
                import h5py
                with h5py.File(str(f), "r") as h5:
                    # Determine cell count from obsm
                    n_cells = 0
                    embed_key = None
                    for key in ["X_umap", "X_scVI", "X_pca"]:
                        if key in h5["obsm"]:
                            shape = h5["obsm"][key].shape
                            n_cells = shape[0]
                            embed_key = key
                            break
                    # Find cluster column
                    obs_keys = list(h5["obs"].keys())
                    cluster_col = None
                    for col in ["cell_type", "leiden", "louvain", "cluster", "seurat_clusters",
                                "Broad cell type", "Cell types level 2"]:
                        if col in obs_keys:
                            cluster_col = col
                            break
                    datasets.append({
                        "id": f.stem,
                        "name": f.stem[:40],
                        "cells": n_cells,
                        "source": "h5ad",
                        "file": f.name,
                        "embedding": embed_key,
                        "cluster_col": cluster_col,
                    })
            except Exception as e:
                print(f"Skipping {f.name}: {e}")
    return datasets


VIZ_SCATTER_DB = Path(__file__).parent / "viz_scatter.db"


def load_h5ad_dataset(dataset_id: str) -> dict:
    """Load scatter data from precomputed SQLite (built by build_viz_cache.py).

    Falls back to h5ad parsing only if the DB table doesn't exist yet.
    """
    if dataset_id in _dataset_cache:
        return _dataset_cache[dataset_id]

    import re as _re
    table = f"scatter_{_re.sub(r'[^A-Za-z0-9_]', '_', dataset_id)}"

    # ── Try SQLite first (fast path) ──
    if VIZ_SCATTER_DB.exists():
        import sqlite3
        conn = sqlite3.connect(str(VIZ_SCATTER_DB))
        try:
            rows = conn.execute(f"SELECT x, y, z3, label FROM [{table}]").fetchall()
        except Exception:
            rows = []
        conn.close()

        if rows:
            x_arr = np.array([r[0] for r in rows], dtype=np.float32)
            y_arr = np.array([r[1] for r in rows], dtype=np.float32)
            # z from 3D UMAP (column z3), not PCA
            z_arr = np.array([r[2] for r in rows], dtype=np.float32) if rows[0][2] is not None else None
            labels_list = [r[3] for r in rows]
            unique_clusters = sorted(set(labels_list))
            result = {
                "x": x_arr, "y": y_arr, "z": z_arr,
                "labels": labels_list, "clusters": unique_clusters,
                "total": len(labels_list),
            }
            _dataset_cache[dataset_id] = result
            print(f"  Loaded {len(rows):,} cells from DB ({table})")
            return result

    # ── Fallback: h5ad parsing (cold path — only if DB not built) ──
    h5_path = H5AD_DIR / f"{dataset_id}.h5ad"
    if not h5_path.exists():
        raise ValueError(f"Dataset not found: {dataset_id}")

    print(f"Loading h5ad dataset: {h5_path.name} (fallback — run build_viz_cache.py to pre-build)")
    t0 = time.perf_counter()

    import h5py
    with h5py.File(str(h5_path), "r") as h5:
        coords = None
        for key in ["X_umap", "X_scVI", "X_pca"]:
            if key in h5["obsm"]:
                coords = h5["obsm"][key][:, :2].astype(np.float32)
                break
        if coords is None:
            raise ValueError("No embedding found in .obsm")

        z_arr = None
        if "X_pca" in h5["obsm"] and h5["obsm"]["X_pca"].shape[1] >= 3:
            z_arr = h5["obsm"]["X_pca"][:, 2].astype(np.float32)

        labels_list = None
        for col in ["cell_type", "leiden", "louvain", "cluster", "seurat_clusters",
                     "Broad cell type", "Cell types level 2"]:
            if col in h5["obs"]:
                obs_col = h5["obs"][col]
                if "categories" in obs_col:
                    cats = obs_col["categories"][:]
                    codes = obs_col["codes"][:]
                    cats = [c.decode() if isinstance(c, bytes) else str(c) for c in cats]
                    labels_list = [cats[c] if 0 <= c < len(cats) else "unknown" for c in codes]
                else:
                    data = obs_col[:]
                    labels_list = [v.decode() if isinstance(v, bytes) else str(v) for v in data]
                break
        if labels_list is None:
            labels_list = ["unknown"] * len(coords)

    x_arr = coords[:, 0]
    y_arr = coords[:, 1]
    unique_clusters = sorted(set(labels_list))
    result = {
        "x": x_arr, "y": y_arr, "z": z_arr,
        "labels": labels_list, "clusters": unique_clusters,
        "total": len(labels_list),
    }
    _dataset_cache[dataset_id] = result
    print(f"  Loaded {len(labels_list):,} cells in {time.perf_counter() - t0:.1f}s")
    return result


def query_scatter(n: int, dataset: str | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, list[str], list[str], list[str]]:
    """Returns (x, y, z, labels, colors, clusters) from DB or h5ad cache."""
    if dataset and dataset != "synthetic":
        # Load from h5ad cache
        ds = load_h5ad_dataset(dataset)
        total = ds["total"]
        actual_n = min(n, total)

        if actual_n < total:
            rng = np.random.default_rng(42)
            indices = rng.choice(total, actual_n, replace=False)
            indices.sort()
            x_arr = ds["x"][indices]
            y_arr = ds["y"][indices]
            z_arr = ds["z"][indices] if ds["z"] is not None else None
            labels_list = [ds["labels"][i] for i in indices]
        else:
            x_arr = ds["x"]
            y_arr = ds["y"]
            z_arr = ds["z"]
            labels_list = ds["labels"]

        unique = sorted(set(labels_list))
        c_map = {c: COLOR_PALETTE_HEX[i % len(COLOR_PALETTE_HEX)] for i, c in enumerate(unique)}
        colors_list = [c_map[l] for l in labels_list]
        return x_arr, y_arr, z_arr, labels_list, colors_list, unique

    # Default: synthetic from DB
    with get_conn() as conn:
        total = count_cells(conn)
        if total == 0:
            raise ValueError("Database empty.")
        actual_n = min(n, total)
        rows = conn.execute(
            "SELECT x, y, cluster FROM cells ORDER BY RANDOM() LIMIT ?", (actual_n,)
        ).fetchall()

    x_arr = np.array([r[0] for r in rows], dtype=np.float32)
    y_arr = np.array([r[1] for r in rows], dtype=np.float32)
    labels_list = [r[2] for r in rows]
    unique = sorted(set(labels_list))
    c_map = {c: COLOR_PALETTE_HEX[i % len(COLOR_PALETTE_HEX)] for i, c in enumerate(unique)}
    colors_list = [c_map[l] for l in labels_list]
    return x_arr, y_arr, None, labels_list, colors_list, unique


@app.get("/api/datasets")
def api_datasets():
    """List available datasets."""
    return scan_datasets()


@app.get("/api/info")
def api_info(dataset: str | None = None):
    if dataset and dataset != "synthetic":
        ds = load_h5ad_dataset(dataset)
        return {"total_cells": ds["total"], "clusters": ds["clusters"], "dataset": dataset}
    with get_conn() as conn:
        n = count_cells(conn)
        clusters = [r[0] for r in conn.execute("SELECT DISTINCT cluster FROM cells ORDER BY cluster")]
    return {"total_cells": n, "clusters": clusters, "dataset": "synthetic"}


@app.get("/api/scatter")
def api_scatter(
    n: int = Query(100_000, ge=1_000, le=2_000_000, description="Number of cells to return"),
    seed: int = Query(0),
    dataset: str | None = Query(None),
):
    """
    Returns binary-encoded scatter data for maximum throughput.
    Format (little-endian):
      [4 bytes] n_points (uint32)
      [n×4 bytes] x (float32[])
      [n×4 bytes] y (float32[])
      [n×4 bytes] color_rgba packed as uint32 (RGBA8)
      then: newline-delimited JSON array of cluster names
    """
    x_arr, y_arr, _z, cluster_names, _colors, unique_clusters = query_scatter(n, dataset)
    cluster_to_idx = {c: i for i, c in enumerate(unique_clusters)}
    color_palette = [
        [228, 26,  28,  200], [55, 126, 184, 200], [77, 175,  74, 200],
        [152, 78, 163, 200],  [255, 127,  0, 200],  [166, 86,  40, 200],
        [247, 129, 191, 200], [153, 153, 153, 200], [102, 194, 165, 200],
        [252, 141,  98, 200], [179, 222, 105, 200],  [128, 177, 211, 200],
    ]

    # Pack colors as uint32 (RGBA)
    color_u32 = np.array([
        (color_palette[cluster_to_idx[c] % len(color_palette)][0]
         | (color_palette[cluster_to_idx[c] % len(color_palette)][1] << 8)
         | (color_palette[cluster_to_idx[c] % len(color_palette)][2] << 16)
         | (color_palette[cluster_to_idx[c] % len(color_palette)][3] << 24))
        for c in cluster_names
    ], dtype=np.uint32)

    # Build binary response: header + x + y + color + JSON metadata
    n_points = len(x_arr)
    header = struct.pack("<I", n_points)
    meta = json.dumps({
        "n": n_points,
        "clusters": unique_clusters,
        "cluster_per_point": cluster_names,
        "hex_colors": [
            "#{:02x}{:02x}{:02x}".format(*color_palette[i % len(color_palette)][:3])
            for i in range(len(unique_clusters))
        ],
    }).encode()

    body = (
        header
        + x_arr.tobytes()
        + y_arr.tobytes()
        + color_u32.tobytes()
        + b"\n"
        + meta
    )

    return Response(content=body, media_type="application/octet-stream", headers={
        "X-Point-Count": str(n_points),
    })


@app.get("/api/scatter.json")
def api_scatter_json(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """JSON version for libraries that don't support binary responses."""
    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
    return {
        "n": len(labels),
        "x": x_arr.tolist(),
        "y": y_arr.tolist(),
        "labels": labels,
        "colors": colors,
        "clusters": clusters,
    }


# ── WebSocket endpoint ──────────────────────────────────────────────────────

@app.websocket("/ws/scatter")
async def ws_scatter(websocket: WebSocket):
    """
    WebSocket binary transport.
    Client sends JSON: {"n": 100000}
    Server responds with binary:
      [4 bytes uint32 n_points]
      [n×4 bytes float32 x]
      [n×4 bytes float32 y]
      [2 bytes uint16 label_count]
      for each label: [2 bytes uint16 len][utf-8 bytes]
      [n×2 bytes uint16 label_indices]
      [2 bytes uint16 color_count]
      for each color: [7 bytes "#rrggbb"]
    """
    await websocket.accept()
    try:
        while True:
            msg = await websocket.receive_text()
            req = json.loads(msg)
            n = req.get("n", 100_000)
            dataset = req.get("dataset", None)

            x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
            n_points = len(labels)

            # Build label index mapping
            label_to_idx = {c: i for i, c in enumerate(clusters)}
            label_indices = np.array([label_to_idx[l] for l in labels], dtype=np.uint16)

            # Build color list (unique per cluster)
            c_map = {c: COLOR_PALETTE_HEX[i % len(COLOR_PALETTE_HEX)] for i, c in enumerate(clusters)}
            color_list = [c_map[c] for c in clusters]

            # Pack binary
            buf = bytearray()
            buf += struct.pack("<I", n_points)
            buf += x_arr.tobytes()
            buf += y_arr.tobytes()
            # cluster names
            buf += struct.pack("<H", len(clusters))
            for c in clusters:
                encoded = c.encode("utf-8")
                buf += struct.pack("<H", len(encoded))
                buf += encoded
            # label indices per point
            buf += label_indices.tobytes()
            # colors per cluster
            buf += struct.pack("<H", len(color_list))
            for col in color_list:
                buf += col.encode("ascii")

            await websocket.send_bytes(bytes(buf))
    except Exception:
        pass


# ── gRPC-Web proxy endpoint ──────────────────────────────────────────────────

@app.post("/grpc/scatter")
async def grpc_web_scatter(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """
    gRPC-Web compatible endpoint.
    Returns protobuf-encoded ScatterResponse (same schema as scatter.proto).
    Uses actual protobuf serialization via generated scatter_pb2.
    """
    import scatter_pb2

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)

    resp = scatter_pb2.ScatterResponse()
    resp.n = len(labels)
    # Use extend for packed repeated fields — efficient C++ path
    resp.x.extend(x_arr.tolist())
    resp.y.extend(y_arr.tolist())
    resp.labels.extend(labels)
    resp.colors.extend(colors)
    resp.clusters.extend(clusters)

    proto_bytes = resp.SerializeToString()

    # gRPC-Web framing: [0x00 (no compression)][4-byte big-endian length][payload]
    frame = struct.pack(">BI", 0, len(proto_bytes)) + proto_bytes
    # Trailers frame: [0x80][4-byte length][trailer text]
    trailer = b"grpc-status:0\r\n"
    frame += struct.pack(">BI", 0x80, len(trailer)) + trailer

    return Response(
        content=frame,
        media_type="application/grpc-web+proto",
        headers={
            "X-Point-Count": str(len(labels)),
            "X-Proto-Size": str(len(proto_bytes)),
        },
    )


# ── MessagePack endpoint ─────────────────────────────────────────────────────

@app.get("/api/scatter.msgpack")
def api_scatter_msgpack(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """MessagePack binary serialization — compact binary JSON alternative."""
    import msgpack

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
    payload = msgpack.packb({
        "n": len(labels),
        "x": x_arr.tobytes(),       # raw float32 bytes (compact)
        "y": y_arr.tobytes(),
        "labels": labels,
        "colors": colors,
        "clusters": clusters,
    }, use_bin_type=True)

    return Response(content=payload, media_type="application/x-msgpack", headers={
        "X-Point-Count": str(len(labels)),
    })


# ── FlatBuffers endpoint ────────────────────────────────────────────────────

@app.get("/api/scatter.flatbuf")
def api_scatter_flatbuf(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """
    FlatBuffers zero-copy format.
    Manual binary construction (no flatc codegen needed).
    Layout:
      [4B root_offset]
      Table: [vtable_offset][n(int32)][x_vec_off][y_vec_off][idx_vec_off]
             [clusters_vec_off][colors_vec_off]
      Vectors: x(float32[]), y(float32[]), idx(uint16[]), clusters(string[]), colors(string[])

    For simplicity, we use a custom packed format that mimics FlatBuffer's
    zero-copy benefit: all float arrays are directly accessible as typed arrays.

    Custom FlatBuffer-style format (little-endian):
      Header:  [4B magic "FLAT"][4B version=1][4B n_points][4B n_clusters]
      Section: [n×4B float32 x]
      Section: [n×4B float32 y]
      Section: [n×2B uint16 cluster_indices]
      Section: [n_clusters × (2B name_len + utf8 name)]
      Section: [n_clusters × 7B "#rrggbb"]
    """
    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
    n_points = len(labels)

    label_to_idx = {c: i for i, c in enumerate(clusters)}
    indices = np.array([label_to_idx[l] for l in labels], dtype=np.uint16)
    c_map = {c: COLOR_PALETTE_HEX[i % len(COLOR_PALETTE_HEX)] for i, c in enumerate(clusters)}

    buf = bytearray()
    buf += b"FLAT"
    buf += struct.pack("<III", 1, n_points, len(clusters))
    buf += x_arr.tobytes()
    buf += y_arr.tobytes()
    buf += indices.tobytes()
    for c in clusters:
        encoded = c.encode("utf-8")
        buf += struct.pack("<H", len(encoded))
        buf += encoded
    for c in clusters:
        buf += c_map[c].encode("ascii")

    return Response(content=bytes(buf), media_type="application/x-flatbuffers", headers={
        "X-Point-Count": str(n_points),
    })


# ── Apache Arrow IPC endpoint ───────────────────────────────────────────────

@app.get("/api/scatter.arrow")
def api_scatter_arrow(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """Apache Arrow IPC format — columnar, zero-copy typed arrays."""
    import pyarrow as pa

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)

    table = pa.table({
        "x": pa.array(x_arr, type=pa.float32()),
        "y": pa.array(y_arr, type=pa.float32()),
        "label": pa.array(labels, type=pa.utf8()),
        "color": pa.array(colors, type=pa.utf8()),
    })

    sink = io.BytesIO()
    writer = pa.ipc.new_stream(sink, table.schema)
    writer.write_table(table)
    writer.close()
    arrow_bytes = sink.getvalue()

    return Response(content=arrow_bytes, media_type="application/vnd.apache.arrow.stream", headers={
        "X-Point-Count": str(len(labels)),
    })


# ── SSE Streaming endpoint ──────────────────────────────────────────────────

@app.get("/api/scatter.sse")
async def api_scatter_sse(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """
    Server-Sent Events streaming.
    Sends data in chunks for progressive rendering.
    Events:
      meta: {n, clusters, colors}
      chunk: {offset, x: base64(float32[]), y: base64(float32[])}
      done: {total}
    """
    import base64

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
    n_points = len(labels)
    c_map = {c: COLOR_PALETTE_HEX[i % len(COLOR_PALETTE_HEX)] for i, c in enumerate(clusters)}

    CHUNK_SIZE = 10_000

    async def event_stream():
        # Send metadata first
        meta = json.dumps({
            "n": n_points,
            "clusters": list(clusters),
            "colors": [c_map[c] for c in clusters],
        })
        yield f"event: meta\ndata: {meta}\n\n"

        # Send data in chunks
        for offset in range(0, n_points, CHUNK_SIZE):
            end = min(offset + CHUNK_SIZE, n_points)
            chunk_x = base64.b64encode(x_arr[offset:end].tobytes()).decode()
            chunk_y = base64.b64encode(y_arr[offset:end].tobytes()).decode()
            chunk_labels = labels[offset:end]
            chunk_data = json.dumps({
                "offset": offset,
                "count": end - offset,
                "x": chunk_x,
                "y": chunk_y,
                "labels": chunk_labels,
            })
            yield f"event: chunk\ndata: {chunk_data}\n\n"

        # Done signal
        yield f"event: done\ndata: {json.dumps({'total': n_points})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Point-Count": str(n_points),
        },
    )


# ── Zarr chunked endpoint ────────────────────────────────────────────────────

@app.get("/api/scatter.zarr")
def api_scatter_zarr(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    chunk_size: int = Query(10_000, ge=1_000, le=100_000),
    dataset: str | None = Query(None),
):
    """
    Zarr-style chunked binary response.
    Simulates Zarr's chunk-based storage: data is split into fixed-size chunks,
    each individually compressed with zstd (or zlib fallback), with a JSON header
    describing the chunk layout.

    Binary format:
      [4B "ZARR"] magic
      [4B] header_len (uint32 LE)
      [header_len bytes] JSON header: {n, chunk_size, n_chunks, chunks: [{offset, count, x_len, y_len, idx_len}]}
      For each chunk:
        [x_len bytes] zstd-compressed float32 x
        [y_len bytes] zstd-compressed float32 y
        [idx_len bytes] zstd-compressed uint16 cluster indices
    """
    import zlib
    try:
        import zstandard as zstd
        compress_mode = "zstd"
        _zstd_compressor = zstd.ZstdCompressor(level=3)
        def compress(data: bytes) -> bytes:
            return _zstd_compressor.compress(data)
    except ImportError:
        compress_mode = "deflate"
        def compress(data: bytes) -> bytes:
            compressor = zlib.compressobj(level=6, wbits=-15)
            return compressor.compress(data) + compressor.flush()

    def shuffle_bytes(arr: np.ndarray) -> bytes:
        """Byte-shuffle pre-filter (Blosc-style): groups same-position bytes
        across all elements together. For smooth float/int data (UMAP coords,
        cluster indices) this drastically improves codec compression ratio
        by creating long runs of similar bytes."""
        raw = np.ascontiguousarray(arr).view(np.uint8).reshape(-1, arr.itemsize)
        return np.ascontiguousarray(raw.T).tobytes()

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
    n_points = len(labels)
    cluster_map = {c: i for i, c in enumerate(clusters)}
    indices = np.array([cluster_map[l] for l in labels], dtype=np.uint16)

    chunks_meta = []
    chunks_data = []

    has_z = z_arr is not None

    for offset in range(0, n_points, chunk_size):
        end = min(offset + chunk_size, n_points)
        cx = compress(shuffle_bytes(x_arr[offset:end]))
        cy = compress(shuffle_bytes(y_arr[offset:end]))
        cz = compress(shuffle_bytes(z_arr[offset:end])) if has_z else b""
        ci = compress(shuffle_bytes(indices[offset:end]))
        meta_entry = {
            "offset": offset,
            "count": end - offset,
            "x_len": len(cx),
            "y_len": len(cy),
            "idx_len": len(ci),
        }
        if has_z:
            meta_entry["z_len"] = len(cz)
        chunks_meta.append(meta_entry)
        chunks_data.append(cx + cy + cz + ci)

    header = json.dumps({
        "n": n_points,
        "chunk_size": chunk_size,
        "n_chunks": len(chunks_meta),
        "compression": compress_mode,
        "shuffle": True,
        "has_z": has_z,
        "clusters": list(clusters),
        "colors": [COLOR_PALETTE_HEX[i % len(COLOR_PALETTE_HEX)] for i, _ in enumerate(clusters)],
        "chunks": chunks_meta,
    }).encode()

    buf = io.BytesIO()
    buf.write(b"ZARR")
    buf.write(struct.pack("<I", len(header)))
    buf.write(header)
    for cd in chunks_data:
        buf.write(cd)

    return Response(
        content=buf.getvalue(),
        media_type="application/octet-stream",
        headers={
            "X-Point-Count": str(n_points),
            "X-Chunk-Count": str(len(chunks_meta)),
        },
    )


# ── CBOR endpoint ──────────────────────────────────────────────────────────

@app.get("/api/scatter.cbor")
def api_scatter_cbor(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """CBOR (RFC 8949) binary serialization — IETF standard alternative to JSON/MessagePack."""
    import cbor2

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
    payload = cbor2.dumps({
        "n": len(labels),
        "x": x_arr.tobytes(),
        "y": y_arr.tobytes(),
        "labels": labels,
        "colors": colors,
        "clusters": clusters,
    })

    return Response(content=payload, media_type="application/cbor", headers={
        "X-Point-Count": str(len(labels)),
    })


# ── Parquet endpoint ──────────────────────────────────────────────────────

@app.get("/api/scatter.parquet")
def api_scatter_parquet(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """Apache Parquet columnar format — widely used in bioinformatics/data science."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)

    table = pa.table({
        "x": pa.array(x_arr, type=pa.float32()),
        "y": pa.array(y_arr, type=pa.float32()),
        "label": pa.array(labels, type=pa.utf8()),
        "color": pa.array(colors, type=pa.utf8()),
    })

    sink = io.BytesIO()
    pq.write_table(table, sink, compression='snappy')
    parquet_bytes = sink.getvalue()

    return Response(content=parquet_bytes, media_type="application/vnd.apache.parquet", headers={
        "X-Point-Count": str(len(labels)),
    })


# ── Brotli-compressed Binary endpoint ────────────────────────────────────

@app.get("/api/scatter.br")
def api_scatter_brotli(
    n: int = Query(100_000, ge=1_000, le=2_000_000),
    dataset: str | None = Query(None),
):
    """
    Same binary format as REST Binary, but pre-compressed with Brotli.
    Browser decodes via Content-Encoding: br (native, no JS needed).
    """
    import brotli

    x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(n, dataset)
    n_points = len(labels)

    unique_clusters = sorted(set(labels))
    cluster_to_idx = {c: i for i, c in enumerate(unique_clusters)}
    color_palette = [
        [228, 26,  28,  200], [55, 126, 184, 200], [77, 175,  74, 200],
        [152, 78, 163, 200],  [255, 127,  0, 200],  [166, 86,  40, 200],
        [247, 129, 191, 200], [153, 153, 153, 200], [102, 194, 165, 200],
        [252, 141,  98, 200], [179, 222, 105, 200],  [128, 177, 211, 200],
    ]
    color_u32 = np.array([
        (color_palette[cluster_to_idx[c] % len(color_palette)][0]
         | (color_palette[cluster_to_idx[c] % len(color_palette)][1] << 8)
         | (color_palette[cluster_to_idx[c] % len(color_palette)][2] << 16)
         | (color_palette[cluster_to_idx[c] % len(color_palette)][3] << 24))
        for c in labels
    ], dtype=np.uint32)

    meta = json.dumps({
        "n": n_points,
        "clusters": unique_clusters,
        "hex_colors": [
            "#{:02x}{:02x}{:02x}".format(*color_palette[i % len(color_palette)][:3])
            for i in range(len(unique_clusters))
        ],
    }).encode()

    raw_body = (
        struct.pack("<I", n_points)
        + x_arr.tobytes()
        + y_arr.tobytes()
        + color_u32.tobytes()
        + b"\n"
        + meta
    )

    compressed = brotli.compress(raw_body, quality=4)

    return Response(
        content=compressed,
        media_type="application/octet-stream",
        headers={
            "Content-Encoding": "br",
            "X-Point-Count": str(n_points),
            "X-Raw-Size": str(len(raw_body)),
            "X-Compressed-Size": str(len(compressed)),
        },
    )


# ── Gene Expression API ─────────────────────────────────────────────────────
#
# Visualization-only design: during image build, build_viz_cache.py produces
# one pre-quantized binary file per gene under viz_cache/<dataset>/expr/.
# Each file is already subsampled to the display cell count and encoded as
# [u32 n_total][u32 nnz][u32 max*1e6][u32*nnz row_ids][u8*nnz quantized]
# so the runtime endpoint just streams the file bytes — no h5py, no numpy
# slicing, no decompression. Tens of microseconds per request.

VIZ_CACHE_DIR = Path(__file__).parent / "viz_cache"

# Per-dataset cache of (gene_name → safe_filename)
_GENE_NAME_MAP: dict[str, dict[str, str]] = {}


def _get_gene_name_map(dataset: str) -> dict[str, str]:
    if dataset in _GENE_NAME_MAP:
        return _GENE_NAME_MAP[dataset]
    genes_file = VIZ_CACHE_DIR / dataset / "genes.txt"
    if not genes_file.exists():
        _GENE_NAME_MAP[dataset] = {}
        return {}
    mapping: dict[str, str] = {}
    for line in genes_file.read_text().splitlines():
        if "\t" in line:
            name, safe = line.split("\t", 1)
            mapping[name] = safe
    _GENE_NAME_MAP[dataset] = mapping
    return mapping


@app.get("/api/expression")
def api_expression(
    gene: str = Query(..., description="Gene name (e.g. SFTPC)"),
    dataset: str | None = Query(None),
):
    """Serve a pre-built per-gene expression file.

    Binary payload (produced by build_viz_cache.py):
        [u32 n_total] [u32 nnz] [u32 max_raw * 1e6]
        [u32 * nnz row_ids] [u8 * nnz quantized values]

    Client dequantizes: value / 255 * (max_raw / 1e6).
    """
    if not dataset or dataset == "synthetic":
        return Response(content=b"", status_code=400)

    name_map = _get_gene_name_map(dataset)
    if not name_map:
        return Response(
            content=json.dumps({
                "error": f"Viz cache not built for '{dataset}'. Run build_viz_cache.py."
            }).encode(),
            status_code=503, media_type="application/json",
        )
    if gene not in name_map:
        return Response(
            content=json.dumps({"error": f"Gene '{gene}' not available"}).encode(),
            status_code=404, media_type="application/json",
        )

    path = VIZ_CACHE_DIR / dataset / "expr" / f"{name_map[gene]}.bin"
    if not path.exists():
        return Response(
            content=json.dumps({"error": f"Gene file missing on disk: {path.name}"}).encode(),
            status_code=404, media_type="application/json",
        )
    body = path.read_bytes()
    return Response(
        content=body, media_type="application/octet-stream",
        headers={
            "X-Gene": gene,
            # Browser-cacheable per-gene URL: lets the client skip re-fetching
            # the same gene across renders.
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


@app.get("/api/genes")
def api_genes(dataset: str = Query(...)):
    """Return the list of genes available in the viz cache for this dataset."""
    name_map = _get_gene_name_map(dataset)
    if not name_map:
        return Response(content=b"[]", media_type="application/json", status_code=404)
    return list(name_map.keys())


# ── gRPC native server (separate thread on port 50051) ──────────────────────

def start_grpc_server(port: int = 50051):
    """Runs a native gRPC server in a background thread."""
    try:
        import grpc
        import scatter_pb2
        import scatter_pb2_grpc

        class ScatterServicer(scatter_pb2_grpc.ScatterServiceServicer):
            def GetScatter(self, request, context):
                x_arr, y_arr, z_arr, labels, colors, clusters = query_scatter(request.n or 100_000)
                resp = scatter_pb2.ScatterResponse()
                resp.n = len(labels)
                resp.x.extend(x_arr.tolist())
                resp.y.extend(y_arr.tolist())
                resp.labels.extend(labels)
                resp.colors.extend(colors)
                resp.clusters.extend(clusters)
                return resp

        server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
        scatter_pb2_grpc.add_ScatterServiceServicer_to_server(ScatterServicer(), server)
        server.add_insecure_port(f"[::]:{port}")
        server.start()
        print(f"gRPC server running on port {port}")
        server.wait_for_termination()
    except Exception as e:
        print(f"gRPC server failed to start: {e}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--h5ad", help="Path to .h5ad file to parse and load into DB")
    parser.add_argument("--populate", type=int, metavar="N",
                        help="Populate DB with N synthetic cells (default 1M)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--grpc-port", type=int, default=50051)
    args = parser.parse_args()

    with sqlite3.connect(str(DB_PATH)) as conn:
        init_db(conn)
        n_existing = count_cells(conn)

        if args.h5ad:
            populate_db_h5ad(conn, args.h5ad)
        elif args.populate is not None or n_existing == 0:
            n = args.populate or 1_000_000
            populate_db_synthetic(conn, n)
        else:
            print(f"Using existing DB: {n_existing:,} cells")

    # Start gRPC server in background thread
    grpc_thread = threading.Thread(target=start_grpc_server, args=(args.grpc_port,), daemon=True)
    grpc_thread.start()

    print(f"\nBenchmark server running at http://{args.host}:{args.port}")
    print(f"  REST JSON  : GET  http://{args.host}:{args.port}/api/scatter.json?n=N")
    print(f"  REST Binary: GET  http://{args.host}:{args.port}/api/scatter?n=N")
    print(f"  WebSocket  : WS   ws://{args.host}:{args.port}/ws/scatter")
    print(f"  gRPC-Web   : POST http://{args.host}:{args.port}/grpc/scatter?n=N")
    print(f"  Zarr Chunked: GET  http://{args.host}:{args.port}/api/scatter.zarr?n=N")
    print(f"  CBOR       : GET  http://{args.host}:{args.port}/api/scatter.cbor?n=N")
    print(f"  Parquet    : GET  http://{args.host}:{args.port}/api/scatter.parquet?n=N")
    print(f"  Brotli Bin : GET  http://{args.host}:{args.port}/api/scatter.br?n=N")
    print(f"  gRPC native: grpc://localhost:{args.grpc_port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
