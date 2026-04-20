/**
 * Fetch available datasets and load scatter data from the benchmark server.
 * Uses the Zarr Chunked binary format for optimal transfer speed.
 */

const API_BASE = `http://${window.location.hostname}:5001`;

export interface DatasetInfo {
  id: string;
  name: string;
  cells: number;
  source: string;
  clusters?: number;
}

export interface LoadedScatterData {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array | null;
  colors: string[];
  labels: string[];
  clusters: string[];
  clusterColors: Record<string, string>;
}

/** Fetch the list of available datasets from the server */
export async function fetchDatasets(): Promise<DatasetInfo[]> {
  const res = await fetch(`${API_BASE}/api/datasets`);
  if (!res.ok) throw new Error(`Failed to fetch datasets: ${res.status}`);
  return res.json();
}

/** Fetch dataset info (cell count, clusters) */
export async function fetchDatasetInfo(datasetId: string): Promise<{
  total_cells: number;
  clusters: string[];
  dataset: string;
}> {
  const res = await fetch(`${API_BASE}/api/info?dataset=${encodeURIComponent(datasetId)}`);
  if (!res.ok) throw new Error(`Failed to fetch info: ${res.status}`);
  return res.json();
}

// ─── Decompression helpers ───

import { decompress as zstdDecompress } from 'fzstd';

async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // TS's DOM lib narrows BufferSource to strictly ArrayBuffer-backed views;
  // Uint8Array<ArrayBufferLike> may wrap SharedArrayBuffer in theory. Copy into a
  // fresh ArrayBuffer-backed view to satisfy the type checker.
  const buf = new Uint8Array(data.byteLength);
  buf.set(data);
  writer.write(buf);
  writer.close();
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function decompressChunk(data: Uint8Array, codec: string): Promise<Uint8Array> {
  if (codec === 'zstd') return zstdDecompress(data);
  if (codec === 'deflate') return decompressDeflate(data);
  return data; // assume raw
}

/**
 * Inverse of server-side byte-shuffle filter.
 * Ungroups (byte0|byte1|...) back into original element-major layout.
 * Input length must be a multiple of itemsize.
 */
function unshuffleBytes(data: Uint8Array, itemsize: number): Uint8Array {
  if (itemsize <= 1) return data;
  const n = (data.length / itemsize) | 0;
  const out = new Uint8Array(data.length);
  for (let b = 0; b < itemsize; b++) {
    const src = b * n;
    for (let i = 0; i < n; i++) out[i * itemsize + b] = data[src + i]!;
  }
  return out;
}

/**
 * Load scatter data using the Zarr Chunked binary format.
 *
 * Format:
 *   [4B "ZARR"] magic
 *   [4B] header_len (uint32 LE)
 *   [header_len B] JSON header: {n, chunk_size, n_chunks, compression, clusters, colors, chunks}
 *   For each chunk:
 *     [x_len B] compressed float32 x
 *     [y_len B] compressed float32 y
 *     [idx_len B] compressed uint16 cluster indices
 */
export async function loadScatterData(
  datasetId: string,
  nPoints?: number,
): Promise<LoadedScatterData> {
  const params = new URLSearchParams();
  if (nPoints) params.set('n', String(nPoints));
  if (datasetId !== 'synthetic') params.set('dataset', datasetId);

  const res = await fetch(`${API_BASE}/api/scatter.zarr?${params}`);
  if (!res.ok) throw new Error(`Failed to load scatter: ${res.status}`);

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // Verify magic
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== 'ZARR') throw new Error('Invalid Zarr response: bad magic');

  // Parse header
  const headerLen = view.getUint32(4, true);
  const headerStr = new TextDecoder().decode(bytes.slice(8, 8 + headerLen));
  const header = JSON.parse(headerStr) as {
    n: number;
    chunk_size: number;
    n_chunks: number;
    compression: string;
    shuffle?: boolean;
    has_z: boolean;
    clusters: string[];
    colors: string[];
    chunks: Array<{ offset: number; count: number; x_len: number; y_len: number; z_len?: number; idx_len: number }>;
  };
  const codec = header.compression;
  const needsUnshuffle = header.shuffle === true;

  const n = header.n;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = header.has_z ? new Float32Array(n) : null;
  const clusterIndices = new Uint16Array(n);

  // Parse each chunk
  let dataOffset = 8 + headerLen;
  for (const chunk of header.chunks) {
    const xCompressed = bytes.slice(dataOffset, dataOffset + chunk.x_len);
    dataOffset += chunk.x_len;
    const yCompressed = bytes.slice(dataOffset, dataOffset + chunk.y_len);
    dataOffset += chunk.y_len;

    let zCompressed: Uint8Array | null = null;
    if (header.has_z && chunk.z_len) {
      zCompressed = bytes.slice(dataOffset, dataOffset + chunk.z_len);
      dataOffset += chunk.z_len;
    }

    const idxCompressed = bytes.slice(dataOffset, dataOffset + chunk.idx_len);
    dataOffset += chunk.idx_len;

    // Decompress → (optionally) unshuffle → typed view
    const xRaw = await decompressChunk(xCompressed, codec);
    const yRaw = await decompressChunk(yCompressed, codec);
    const idxRaw = await decompressChunk(idxCompressed, codec);

    const xBytes = needsUnshuffle ? unshuffleBytes(xRaw, 4) : xRaw;
    const yBytes = needsUnshuffle ? unshuffleBytes(yRaw, 4) : yRaw;
    const idxBytes = needsUnshuffle ? unshuffleBytes(idxRaw, 2) : idxRaw;

    x.set(new Float32Array(xBytes.buffer, xBytes.byteOffset, xBytes.byteLength / 4), chunk.offset);
    y.set(new Float32Array(yBytes.buffer, yBytes.byteOffset, yBytes.byteLength / 4), chunk.offset);
    clusterIndices.set(new Uint16Array(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength / 2), chunk.offset);

    if (z && zCompressed) {
      const zRaw = await decompressChunk(zCompressed, codec);
      const zBytes = needsUnshuffle ? unshuffleBytes(zRaw, 4) : zRaw;
      z.set(new Float32Array(zBytes.buffer, zBytes.byteOffset, zBytes.byteLength / 4), chunk.offset);
    }
  }

  // Build per-point labels and colors from cluster indices
  const labels: string[] = new Array(n);
  const colors: string[] = new Array(n);
  const clusterColors: Record<string, string> = {};

  for (let i = 0; i < header.clusters.length; i++) {
    clusterColors[header.clusters[i]!] = header.colors[i] ?? '#888';
  }

  for (let i = 0; i < n; i++) {
    const clusterName = header.clusters[clusterIndices[i]!] ?? 'Unknown';
    labels[i] = clusterName;
    colors[i] = clusterColors[clusterName] ?? '#888';
  }

  return {
    x,
    y,
    z,
    colors,
    labels,
    clusters: header.clusters,
    clusterColors,
  };
}

/**
 * Load expression values for a single gene from the server.
 * Returns Float32Array of normalized [0,1] values, one per cell.
 */
export async function loadGeneExpression(
  datasetId: string,
  gene: string,
): Promise<Float32Array> {
  // The server pre-builds one file per gene at a fixed subsample size, so
  // no `n` parameter is needed — the file IS the visualization payload.
  const params = new URLSearchParams({ gene, dataset: datasetId });

  const res = await fetch(`${API_BASE}/api/expression?${params}`);
  if (!res.ok) throw new Error(`Failed to load expression: ${res.status}`);

  // Per-gene file format (produced by benchmark-server/build_viz_cache.py):
  //   [u32 n_total] [u32 nnz] [u32 max_raw_encoded]
  //   [u32 * nnz row_ids] [u8 * nnz quantized_values]
  // Dequantize: value = quantized / 255 * (max_raw_encoded / 1e6)
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);

  const nTotal = view.getUint32(0, true);
  const nnz = view.getUint32(4, true);
  const maxEncoded = view.getUint32(8, true);
  const vmax = maxEncoded / 1e6;

  const rowIdsOffset = 12;
  const valuesOffset = rowIdsOffset + nnz * 4;
  const rowIds = new Uint32Array(buf, rowIdsOffset, nnz);
  const quantized = new Uint8Array(buf, valuesOffset, nnz);

  const scale = vmax / 255;
  const out = new Float32Array(nTotal); // zeros by default
  for (let i = 0; i < nnz; i++) out[rowIds[i]] = quantized[i] * scale;
  return out;
}

/**
 * Fetch list of available gene names for a dataset.
 */
export async function fetchGeneList(datasetId: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/genes?dataset=${encodeURIComponent(datasetId)}`);
  if (!res.ok) return [];
  return res.json();
}
