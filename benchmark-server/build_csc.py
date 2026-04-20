"""Pre-convert h5ad sparse matrix (CSR) to CSC layout in a sidecar HDF5 file.

Run once per dataset:
    python build_csc.py h5ad/GTEx_8_tissues_snRNAseq_atlas_071421.public_obs.h5ad

Output: <input>.csc.h5 with datasets {data, indices, indptr, gene_names}.
Runtime endpoint slices a single gene column in O(nnz_column) without loading
the full matrix into memory.
"""
import sys
from pathlib import Path
import numpy as np
import h5py
import scipy.sparse as sp


def find_matrix(h5):
    for path in ["X", "layers/normalized", "layers/counts"]:
        if path in h5:
            g = h5[path]
            if hasattr(g, "keys") and "data" in g and "indices" in g and "indptr" in g:
                return g
    return None


def find_gene_names(h5):
    var = h5["var"]
    index_key = var.attrs.get("_index", "_index")
    if isinstance(index_key, bytes):
        index_key = index_key.decode()
    for key in ["gene_name", "feature_name", "Approved symbol", index_key]:
        if key in var:
            raw = var[key][:]
            return [v.decode() if isinstance(v, bytes) else str(v) for v in raw]
    raise RuntimeError("No gene name column found")


def convert(h5_path: Path) -> None:
    out_path = h5_path.with_suffix(".csc.h5")
    if out_path.exists():
        print(f"[skip] {out_path} already exists")
        return

    print(f"[load] {h5_path}")
    with h5py.File(str(h5_path), "r") as h5:
        X = find_matrix(h5)
        if X is None:
            raise RuntimeError(f"No sparse matrix in {h5_path}")
        shape = tuple(X.attrs["shape"])
        print(f"  shape={shape}, nnz={len(X['data'])}")

        print("  reading CSR arrays...")
        data = X["data"][:]
        indices = X["indices"][:]
        indptr = X["indptr"][:]
        gene_names = find_gene_names(h5)

    print("  CSR -> CSC conversion...")
    csr = sp.csr_matrix((data, indices, indptr), shape=shape)
    csc = csr.tocsc()
    del csr, data, indices, indptr

    print(f"[write] {out_path}")
    with h5py.File(str(out_path), "w") as out:
        out.create_dataset("data", data=csc.data, compression=None)
        out.create_dataset("indices", data=csc.indices, compression=None)
        out.create_dataset("indptr", data=csc.indptr, compression=None)
        dt = h5py.string_dtype(encoding="utf-8")
        out.create_dataset("gene_names", data=np.array(gene_names, dtype=object), dtype=dt)
        out.attrs["shape"] = np.array(shape, dtype=np.int64)
    print("  done")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Default: process every .h5ad in h5ad/ directory
        base = Path(__file__).parent / "h5ad"
        files = sorted(base.glob("*.h5ad"))
        if not files:
            print("Usage: python build_csc.py <file.h5ad> [more.h5ad ...]")
            sys.exit(1)
    else:
        files = [Path(a) for a in sys.argv[1:]]

    for f in files:
        convert(f)
