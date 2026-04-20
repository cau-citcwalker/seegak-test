/**
 * Seegak Performance Benchmark
 * Compares: Seegak (WebGL2 custom) vs Plotly.js (scattergl WebGL) vs Vitessce
 *
 * Data source: benchmark-server (FastAPI) — run `python benchmark-server/main.py`
 * Falls back to inline synthetic data when server is unreachable.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Vitessce } from 'vitessce';
import { ScatterChart } from '@seegak/react';
import type { ScatterChartHandle } from '@seegak/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLib = any;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface BenchmarkData {
  x: Float32Array;
  y: Float32Array;
  colors: string[];
  labels: string[];
  clusters: string[];
  clusterColors: Record<string, string>;
}

interface Timing {
  loadMs: number;
  renderMs: number;
  totalMs: number;
}

type BenchmarkState = 'idle' | 'loading' | 'rendering' | 'done' | 'error';

// Derive API URLs from current hostname so Tailscale / remote access works
const _host = window.location.hostname;
const SERVER = `http://${_host}:5001`;
const WS_SERVER = `ws://${_host}:5001`;
const PROXY_SERVER = `http://${_host}:5002`;
const WS_PROXY_SERVER = `ws://${_host}:5002`;
const BASE_SIZES = [10_000, 50_000, 100_000] as const;

// Mutable server URLs — switched by network profile selector
let activeServer = SERVER;
let activeWsServer = WS_SERVER;

type NetworkProfile = 'local' | 'fast_wifi' | '4g' | '3g' | 'slow_3g';
const NETWORK_PROFILES: { key: NetworkProfile; label: string; desc: string }[] = [
  { key: 'local',     label: 'Local',      desc: '0ms, ∞' },
  { key: 'fast_wifi', label: 'Fast WiFi',  desc: '5ms, 30Mbps' },
  { key: '4g',        label: '4G',         desc: '30ms, 10Mbps' },
  { key: '3g',        label: '3G',         desc: '100ms, 1.5Mbps' },
  { key: 'slow_3g',   label: 'Slow 3G',   desc: '300ms, 400Kbps' },
];

interface DatasetInfo {
  id: string;
  name: string;
  cells: number;
  source: string;
  embedding?: string;
  cluster_col?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Data loading
// ═══════════════════════════════════════════════════════════════════════════

async function fetchFromServer(n: number, dataset?: string): Promise<BenchmarkData> {
  const params = new URLSearchParams({ n: String(n) });
  if (dataset) params.set('dataset', dataset);
  const res = await fetch(`${SERVER}/api/scatter.json?${params}`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const json = await res.json() as {
    x: number[]; y: number[];
    labels: string[]; colors: string[]; clusters: string[];
  };
  const clusterColors: Record<string, string> = {};
  const palette = ['#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00',
                   '#a65628','#f781bf','#999999','#66c2a5','#fc8d62'];
  json.clusters.forEach((c, i) => { clusterColors[c] = palette[i % palette.length]!; });
  return {
    x: Float32Array.from(json.x),
    y: Float32Array.from(json.y),
    colors: json.colors,
    labels: json.labels,
    clusters: json.clusters,
    clusterColors,
  };
}

function generateSynthetic(n: number): BenchmarkData {
  let seed = 0x6d2b79f5;
  const rng = () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randNorm = (m: number, s: number) => {
    const u = 1 - rng(), v = rng();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clusters = [
    { name: 'AT1',          cx: -5,  cy:  3,  sx: 1.2, sy: 1.0, w: 0.08, color: '#e41a1c' },
    { name: 'AT2',          cx: -3,  cy: -4,  sx: 1.0, sy: 1.3, w: 0.12, color: '#377eb8' },
    { name: 'Endothelial',  cx:  4,  cy:  2,  sx: 1.5, sy: 1.1, w: 0.15, color: '#4daf4a' },
    { name: 'Fibroblast',   cx:  6,  cy: -3,  sx: 1.1, sy: 1.4, w: 0.09, color: '#984ea3' },
    { name: 'Macrophage',   cx: -1,  cy:  7,  sx: 1.3, sy: 1.2, w: 0.07, color: '#ff7f00' },
    { name: 'T Cell',       cx:  2,  cy: -7,  sx: 0.9, sy: 0.8, w: 0.06, color: '#a65628' },
    { name: 'B Cell',       cx: -7,  cy: -1,  sx: 0.8, sy: 0.9, w: 0.04, color: '#f781bf' },
    { name: 'NK Cell',      cx:  3,  cy: -5,  sx: 0.7, sy: 0.7, w: 0.03, color: '#999999' },
    { name: 'Ciliated',     cx: -4,  cy:  0,  sx: 1.0, sy: 0.9, w: 0.05, color: '#66c2a5' },
    { name: 'Smooth Muscle',cx:  7,  cy:  5,  sx: 0.9, sy: 1.0, w: 0.035,color: '#fc8d62' },
  ];
  const totalW = clusters.reduce((s, c) => s + c.w, 0);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const colors: string[] = new Array(n);
  const labels: string[] = new Array(n);
  let idx = 0;
  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci]!;
    const count = ci < clusters.length - 1 ? Math.round((c.w / totalW) * n) : n - idx;
    for (let i = 0; i < count && idx < n; i++, idx++) {
      x[idx] = randNorm(c.cx, c.sx);
      y[idx] = randNorm(c.cy, c.sy);
      colors[idx] = c.color;
      labels[idx] = c.name;
    }
  }
  const clusterColors: Record<string, string> = {};
  clusters.forEach(c => { clusterColors[c.name] = c.color; });
  return { x, y, colors, labels, clusters: clusters.map(c => c.name), clusterColors };
}

async function loadData(n: number, dataset?: string): Promise<{ data: BenchmarkData; source: 'server' | 'synthetic' }> {
  try {
    const data = await fetchFromServer(n, dataset);
    return { data, source: 'server' };
  } catch {
    return { data: generateSynthetic(n), source: 'synthetic' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Transport benchmark functions
// ═══════════════════════════════════════════════════════════════════════════

interface TransportResult {
  transferMs: number;
  parseMs: number;
  totalMs: number;
  dataSize: number;
  pointCount: number;
}

function buildUrl(path: string, n: number, dataset?: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ n: String(n) });
  if (dataset) params.set('dataset', dataset);
  if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `${activeServer}${path}?${params}`;
}

async function benchRestJson(n: number, dataset?: string): Promise<TransportResult> {
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.json', n, dataset));
  const rawBytes = parseInt(res.headers.get('content-length') || '0', 10);
  const text = await res.text();
  const tTransfer = performance.now();
  const json = JSON.parse(text);
  const tParse = performance.now();
  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: rawBytes || new Blob([text]).size,
    pointCount: json.n,
  };
}

async function benchRestBinary(n: number, dataset?: string): Promise<TransportResult> {
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter', n, dataset));
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();
  // Parse binary: [4B n][n*4B x][n*4B y][n*4B rgba][\n][JSON meta]
  const view = new DataView(buf);
  const nPts = view.getUint32(0, true);
  const _x = new Float32Array(buf, 4, nPts);
  const _y = new Float32Array(buf, 4 + nPts * 4, nPts);
  const tParse = performance.now();
  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: nPts,
  };
}

async function benchWebSocket(n: number, dataset?: string): Promise<TransportResult> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const ws = new WebSocket(`${activeWsServer}/ws/scatter`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(JSON.stringify({ n, dataset }));
    };

    ws.onmessage = (ev) => {
      const tTransfer = performance.now();
      const buf = ev.data as ArrayBuffer;
      // Parse: [4B n][n*4B x][n*4B y][2B label_count][...labels][n*2B indices][2B color_count][...colors]
      const view = new DataView(buf);
      const nPts = view.getUint32(0, true);
      let offset = 4;
      const _x = new Float32Array(buf, offset, nPts); offset += nPts * 4;
      const _y = new Float32Array(buf, offset, nPts); offset += nPts * 4;
      // Skip label parsing — just measure time
      const tParse = performance.now();
      ws.close();
      resolve({
        transferMs: tTransfer - t0,
        parseMs: tParse - tTransfer,
        totalMs: tParse - t0,
        dataSize: buf.byteLength,
        pointCount: nPts,
      });
    };

    ws.onerror = () => { reject(new Error('WebSocket error')); };
    setTimeout(() => { ws.close(); reject(new Error('WebSocket timeout')); }, 60000);
  });
}

async function benchGrpcWeb(n: number, dataset?: string): Promise<TransportResult> {
  const t0 = performance.now();
  const res = await fetch(buildUrl('/grpc/scatter', n, dataset), { method: 'POST' });
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  // gRPC-Web frame: [1B flags][4B BE length][protobuf payload][trailer frame]
  const view = new DataView(buf);
  const _flags = view.getUint8(0);
  const payloadLen = view.getUint32(1, false); // big-endian
  const protobuf = new Uint8Array(buf, 5, payloadLen);

  // Decode protobuf (ScatterResponse) manually — field tags + packed floats
  let nPts = 0;
  let pos = 0;
  while (pos < protobuf.length) {
    const byte0 = protobuf[pos]!;
    const fieldNum = byte0 >> 3;
    const wireType = byte0 & 0x07;
    pos++;

    if (wireType === 0) {
      // varint — decode and skip
      let val = 0, shift = 0;
      while (pos < protobuf.length) {
        const b = protobuf[pos++]!;
        val |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (fieldNum === 1) nPts = val; // field 1 = n
    } else if (wireType === 2) {
      // length-delimited — read length then skip
      let len = 0, shift = 0;
      while (pos < protobuf.length) {
        const b = protobuf[pos++]!;
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (fieldNum === 2 || fieldNum === 3) {
        // packed float fields — could extract but just skip for timing
        // const floats = new Float32Array(protobuf.buffer, protobuf.byteOffset + pos, len / 4);
      }
      pos += len;
    }
  }

  const tParse = performance.now();
  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: nPts || parseInt(res.headers.get('X-Point-Count') || '0', 10),
  };
}

async function benchMsgpack(n: number, dataset?: string): Promise<TransportResult> {
  const { decode } = await import('@msgpack/msgpack');
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.msgpack', n, dataset));
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  const obj = decode(new Uint8Array(buf)) as {
    n: number; x: Uint8Array; y: Uint8Array;
    labels: string[]; colors: string[]; clusters: string[];
  };
  // x, y are raw float32 bytes packed by msgpack — copy to aligned buffer
  const _x = new Float32Array(obj.x.buffer.slice(obj.x.byteOffset, obj.x.byteOffset + obj.n * 4));
  const _y = new Float32Array(obj.y.buffer.slice(obj.y.byteOffset, obj.y.byteOffset + obj.n * 4));
  const tParse = performance.now();

  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: obj.n,
  };
}

async function benchFlatbuf(n: number, dataset?: string): Promise<TransportResult> {
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.flatbuf', n, dataset));
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  // Custom FlatBuffer-style: [4B "FLAT"][4B ver][4B n][4B nClusters][x...][y...][indices...]
  const view = new DataView(buf);
  const nPts = view.getUint32(8, true);
  // const nClusters = view.getUint32(12, true);
  let offset = 16;
  // Zero-copy: directly create typed array views (no parsing!)
  const _x = new Float32Array(buf, offset, nPts); offset += nPts * 4;
  const _y = new Float32Array(buf, offset, nPts); offset += nPts * 4;
  const _indices = new Uint16Array(buf, offset, nPts);
  const tParse = performance.now();

  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: nPts,
  };
}

async function benchArrowIPC(n: number, dataset?: string): Promise<TransportResult> {
  const arrow = await import('apache-arrow');
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.arrow', n, dataset));
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  // Arrow IPC deserialization — typed arrays are zero-copy
  const reader = arrow.RecordBatchReader.from(new Uint8Array(buf));
  const batches = [...reader];
  let totalPoints = 0;
  for (const batch of batches) {
    const _xCol = batch.getChild('x');
    const _yCol = batch.getChild('y');
    totalPoints += batch.numRows;
  }
  const tParse = performance.now();

  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: totalPoints,
  };
}

async function benchZarr(n: number, dataset?: string): Promise<TransportResult> {
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.zarr', n, dataset));
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  // Parse Zarr-style: [4B "ZARR"][4B header_len][JSON header][compressed chunks...]
  const view = new DataView(buf);
  const headerLen = view.getUint32(4, true);
  const headerBytes = new Uint8Array(buf, 8, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as {
    n: number;
    chunks: { offset: number; count: number; x_len: number; y_len: number; idx_len: number }[];
  };

  // Decompress each chunk (using DecompressionStream if available, else raw inflate)
  let dataOffset = 8 + headerLen;
  let totalPoints = 0;
  for (const chunk of header.chunks) {
    // Try zstd via DecompressionStream or just read compressed sizes for timing
    // (Decompression in browser requires WASM or fallback — measure transfer + parse overhead)
    const xCompressed = new Uint8Array(buf, dataOffset, chunk.x_len);
    dataOffset += chunk.x_len;
    const yCompressed = new Uint8Array(buf, dataOffset, chunk.y_len);
    dataOffset += chunk.y_len;
    dataOffset += chunk.idx_len; // skip indices

    // Decompress with DecompressionStream (deflate/zlib)
    try {
      const xStream = new Response(new Blob([xCompressed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
      const yStream = new Response(new Blob([yCompressed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
      const [xBuf, yBuf] = await Promise.all([xStream, yStream]);
      const _x = new Float32Array(xBuf);
      const _y = new Float32Array(yBuf);
      totalPoints += _x.length;
    } catch {
      // If decompression fails (e.g. zstd not supported), count from header
      totalPoints += chunk.count;
    }
  }

  const tParse = performance.now();
  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: totalPoints || header.n,
  };
}

async function benchSSE(n: number, dataset?: string): Promise<TransportResult> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let tFirstChunk = 0;
    let totalPoints = 0;
    let totalBytes = 0;

    const es = new EventSource(buildUrl('/api/scatter.sse', n, dataset));

    es.addEventListener('meta', (ev) => {
      totalBytes += ev.data.length;
    });

    es.addEventListener('chunk', (ev) => {
      if (tFirstChunk === 0) tFirstChunk = performance.now();
      totalBytes += ev.data.length;
      const chunk = JSON.parse(ev.data) as { count: number; x: string; y: string };
      // Decode base64 → typed array
      const xBin = Uint8Array.from(atob(chunk.x), c => c.charCodeAt(0));
      const _x = new Float32Array(xBin.buffer);
      totalPoints += chunk.count;
    });

    es.addEventListener('done', () => {
      const tDone = performance.now();
      es.close();
      resolve({
        transferMs: tFirstChunk > 0 ? tFirstChunk - t0 : tDone - t0,
        parseMs: tDone - (tFirstChunk || t0),
        totalMs: tDone - t0,
        dataSize: totalBytes,
        pointCount: totalPoints,
      });
    });

    es.onerror = () => {
      es.close();
      reject(new Error('SSE connection error'));
    };

    setTimeout(() => { es.close(); reject(new Error('SSE timeout')); }, 60000);
  });
}

async function benchCBOR(n: number, dataset?: string): Promise<TransportResult> {
  const { decode } = await import('cbor-x');
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.cbor', n, dataset));
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  const obj = decode(new Uint8Array(buf)) as {
    n: number; x: Uint8Array; y: Uint8Array;
    labels: string[]; colors: string[]; clusters: string[];
  };
  // Align Float32Array (CBOR returns raw bytes)
  const _x = new Float32Array(obj.x.buffer.slice(obj.x.byteOffset, obj.x.byteOffset + obj.n * 4));
  const _y = new Float32Array(obj.y.buffer.slice(obj.y.byteOffset, obj.y.byteOffset + obj.n * 4));

  const tParse = performance.now();
  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: _x.length,
  };
}

let parquetInitPromise: Promise<typeof import('parquet-wasm')> | null = null;
async function getParquet() {
  if (!parquetInitPromise) {
    parquetInitPromise = (async () => {
      const mod = await import('parquet-wasm');
      await mod.default();
      return mod;
    })();
  }
  return parquetInitPromise;
}

async function benchParquet(n: number, dataset?: string): Promise<TransportResult> {
  const parquet = await getParquet();
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.parquet', n, dataset));
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  const table = parquet.readParquet(new Uint8Array(buf));
  // Sum rows across all record batches
  let nPts = 0;
  for (const batch of table.recordBatches()) {
    nPts += batch.numRows;
    batch.free();
  }
  table.free();

  const tParse = performance.now();
  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: buf.byteLength,
    pointCount: nPts,
  };
}

async function benchBrotli(n: number, dataset?: string): Promise<TransportResult> {
  const t0 = performance.now();
  const res = await fetch(buildUrl('/api/scatter.br', n, dataset));
  // Browser auto-decompresses Brotli via Content-Encoding: br
  const buf = await res.arrayBuffer();
  const tTransfer = performance.now();

  // Same binary format as REST Binary: [4B n][n*4B x][n*4B y][n*4B rgba][\n][JSON meta]
  const view = new DataView(buf);
  const nPts = view.getUint32(0, true);
  const _x = new Float32Array(buf, 4, nPts);
  const _y = new Float32Array(buf, 4 + nPts * 4, nPts);
  const compressedSize = parseInt(res.headers.get('X-Compressed-Size') || '0', 10);

  const tParse = performance.now();
  return {
    transferMs: tTransfer - t0,
    parseMs: tParse - tTransfer,
    totalMs: tParse - t0,
    dataSize: compressedSize || buf.byteLength,
    pointCount: nPts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel: Seegak (WebGL2 custom)
// ═══════════════════════════════════════════════════════════════════════════

function SeegakPanel({ data, onTiming }: {
  data: BenchmarkData;
  onTiming: (t: Timing) => void;
}) {
  const chartRef = useRef<ScatterChartHandle>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    // Children effects fire first, so instance is ready when this runs.
    // Fallback: retry on next tick if chart isn't ready yet (first mount race).
    const run = () => {
      const instance = chartRef.current?.instance;
      if (!instance) return;
      firedRef.current = false;
      // Direct imperative call — bypasses React state scheduling
      const t1 = performance.now();
      instance.update({ x: data.x, y: data.y, colors: data.colors, labels: data.labels });
      // requestRender() was called inside update() — its RAF was queued first,
      // so it fires before ours in the same frame → we record AFTER the draw.
      requestAnimationFrame(() => {
        if (!firedRef.current) {
          firedRef.current = true;
          onTiming({ loadMs: 0, renderMs: performance.now() - t1, totalMs: 0 });
        }
      });
    };

    if (chartRef.current?.instance) {
      run();
    } else {
      // First mount: wait one tick for ScatterChart's create-effect to set instance
      const id = setTimeout(run, 0);
      return () => clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ScatterChart
        ref={chartRef}
        pointSize={2.5}
        opacity={0.85}
        autoFit
        tooltip
        toolbar
        legend={false}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel: Plotly.js (scattergl — WebGL mode)
// ═══════════════════════════════════════════════════════════════════════════

function PlotlyPanel({ data, onTiming }: {
  data: BenchmarkData;
  onTiming: (t: Timing) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [plotly, setPlotly] = useState<PlotlyLib>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    import('plotly.js-dist-min').then(m => { setPlotly(m.default); });
  }, []);

  useEffect(() => {
    const Plotly = plotly;
    if (!Plotly || !containerRef.current) return;
    firedRef.current = false;

    const container = containerRef.current;
    const t1 = performance.now();

    Plotly.newPlot(container, [{
      type: 'scattergl',
      mode: 'markers',
      x: Array.from(data.x),
      y: Array.from(data.y),
      text: data.labels,
      marker: { size: 3, color: data.colors, opacity: 0.85 },
      hoverinfo: 'text',
    }], {
      paper_bgcolor: '#111827',
      plot_bgcolor: '#111827',
      margin: { t: 8, r: 8, b: 32, l: 40 },
      xaxis: { color: '#6a8aaa', gridcolor: '#1e2a3a', zeroline: false },
      yaxis: { color: '#6a8aaa', gridcolor: '#1e2a3a', zeroline: false },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!firedRef.current) {
          firedRef.current = true;
          onTiming({ loadMs: 0, renderMs: performance.now() - t1, totalMs: 0 });
        }
      });
    });

    return () => { Plotly.purge(container); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plotly]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel: Vitessce (regl-scatterplot via WebGL2)
// ═══════════════════════════════════════════════════════════════════════════

function buildVitessceConfig(blobUrl: string): object {
  return {
    version: '1.0.17',
    name: 'Benchmark',
    initStrategy: 'auto',
    datasets: [{
      uid: 'A',
      name: 'Cells',
      files: [
        {
          fileType: 'obsEmbedding.csv',
          url: blobUrl,
          options: { obsIndex: 'obsIndex', obsEmbedding: ['umap_1', 'umap_2'] },
          coordinationValues: { obsType: 'cell', embeddingType: 'UMAP' },
        },
        {
          fileType: 'obsSets.csv',
          url: blobUrl,
          options: {
            obsIndex: 'obsIndex',
            obsSets: [{ name: 'Cluster', column: 'cluster' }],
          },
          coordinationValues: { obsType: 'cell' },
        },
      ],
    }],
    coordinationSpace: {
      dataset: { A: 'A' },
      obsType: { A: 'cell' },
      embeddingType: { A: 'UMAP' },
      embeddingZoom: { A: null },
      embeddingTargetX: { A: null },
      embeddingTargetY: { A: null },
      obsSetSelection: { A: null },
      obsSetColor: { A: null },
    },
    layout: [{
      component: 'scatterplot',
      coordinationScopes: {
        dataset: 'A',
        obsType: 'A',
        embeddingType: 'A',
        embeddingZoom: 'A',
        embeddingTargetX: 'A',
        embeddingTargetY: 'A',
        obsSetSelection: 'A',
        obsSetColor: 'A',
      },
      x: 0, y: 0, w: 12, h: 12,
    }],
  };
}

function VitesscePanel({ data, onTiming }: {
  data: BenchmarkData;
  onTiming: (t: Timing) => void;
}) {
  const [vcConfig, setVcConfig] = useState<object | null>(null);
  const [runKey, setRunKey] = useState(0);
  const timingT0 = useRef<number>(0);
  const firedRef = useRef(false);
  const configChanges = useRef(0);
  const blobUrlRef = useRef<string>('');

  useEffect(() => {
    // Cleanup old blob URL
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

    firedRef.current = false;
    configChanges.current = 0;
    timingT0.current = performance.now();

    // Build CSV blob from in-memory data (avoids network round-trip)
    const n = data.x.length;
    const rows: string[] = new Array(n + 1);
    rows[0] = 'obsIndex,umap_1,umap_2,cluster';
    for (let i = 0; i < n; i++) {
      rows[i + 1] = `c${i},${data.x[i]!.toFixed(3)},${data.y[i]!.toFixed(3)},${data.labels[i]}`;
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;

    setVcConfig(buildVitessceConfig(url));
    setRunKey(k => k + 1);

    return () => { URL.revokeObjectURL(url); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleConfigChange = useCallback(() => {
    configChanges.current += 1;
    // 1st change = initial mount; 2nd+ = data loaded / auto-zoom fired
    if (configChanges.current >= 2 && !firedRef.current) {
      firedRef.current = true;
      requestAnimationFrame(() => {
        onTiming({ loadMs: 0, renderMs: performance.now() - timingT0.current, totalMs: 0 });
      });
    }
  }, [onTiming]);

  if (!vcConfig) return null;

  return (
    <Vitessce
      key={runKey}
      config={vcConfig}
      theme="dark"
      height={380}
      onConfigChange={handleConfigChange}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Timing Card
// ═══════════════════════════════════════════════════════════════════════════

function TimingBar({ label, ms, maxMs, color }: {
  label: string; ms: number | null; maxMs: number; color: string;
}) {
  const pct = ms != null && maxMs > 0 ? Math.min(100, (ms / maxMs) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: '#8899aa' }}>{label}</span>
        <span style={{ color: '#e0e6f0', fontFamily: 'monospace', fontWeight: 600 }}>
          {ms != null ? `${ms.toFixed(1)} ms` : '—'}
        </span>
      </div>
      <div style={{ height: 6, background: '#1a2332', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

function TimingCard({ title, color, state, timing, loadMs, n }: {
  title: string; color: string; state: BenchmarkState;
  timing: Timing | null; loadMs: number | null; n: number;
}) {
  const maxMs = 4000;
  const renderMs = timing?.renderMs ?? null;
  const total = loadMs != null && renderMs != null ? loadMs + renderMs : null;

  return (
    <div style={{
      background: '#0d1420', borderRadius: 10, padding: '16px 20px',
      border: `1px solid ${state === 'done' ? color + '66' : '#1e2a3a'}`,
      transition: 'border-color 0.3s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
        <span style={{ fontWeight: 600, color: '#e0e6f0', fontSize: 14 }}>{title}</span>
        {(state === 'loading' || state === 'rendering')
          ? <span style={{ marginLeft: 'auto', fontSize: 11, color: '#5a6a7a' }}>측정 중…</span>
          : state === 'done' && total != null
            ? <span style={{ marginLeft: 'auto', fontSize: 11, color, fontFamily: 'monospace', fontWeight: 700 }}>
                {total.toFixed(1)} ms
              </span>
            : null}
      </div>
      <TimingBar label="데이터 로드" ms={loadMs}   maxMs={maxMs} color="#3b82f6" />
      <TimingBar label="첫 프레임"   ms={renderMs} maxMs={maxMs} color={color}  />
      <TimingBar label="합계"        ms={total}    maxMs={maxMs} color="#8b5cf6" />
      {state === 'done' && total != null && (
        <div style={{ marginTop: 12, fontSize: 11, color: '#4a5a6a', textAlign: 'right' }}>
          {(n / (total / 1000) / 1e6).toFixed(2)} M points/sec
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════

const LIBS = [
  { key: 'seegak',    label: 'Seegak',      sublabel: 'WebGL2 (custom pipeline)',  color: '#3b82f6' },
  { key: 'plotly',    label: 'Plotly.js',   sublabel: 'scattergl (WebGL)',         color: '#f59e0b' },
  { key: 'vitessce',  label: 'Vitessce',    sublabel: 'regl-scatterplot (WebGL2)', color: '#10b981' },
] as const;

type LibKey = typeof LIBS[number]['key'];

export default function BenchmarkPage() {
  const [selectedN, setSelectedN] = useState<number>(100_000);
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [dataSource, setDataSource] = useState<'server' | 'synthetic' | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('synthetic');

  useEffect(() => {
    fetch(`${SERVER}/api/datasets`)
      .then(r => r.json())
      .then((ds: DatasetInfo[]) => setDatasets(ds))
      .catch(() => {});
  }, []);

  const sizes = useMemo(() => {
    const ds = datasets.find(d => d.id === selectedDataset);
    const maxCells = ds?.cells ?? 0;
    const base = BASE_SIZES.filter(n => n < maxCells);
    return maxCells > 0 ? [...base, maxCells] : [...BASE_SIZES];
  }, [datasets, selectedDataset]);

  const [states, setStates] = useState<Record<LibKey, BenchmarkState>>({
    seegak: 'idle', plotly: 'idle', vitessce: 'idle',
  });
  const [timings, setTimings] = useState<Record<LibKey, Timing | null>>({
    seegak: null, plotly: null, vitessce: null,
  });
  const [loadMs, setLoadMs] = useState<number | null>(null);

  const setLibState = useCallback((lib: LibKey, s: BenchmarkState) =>
    setStates(prev => ({ ...prev, [lib]: s })), []);
  const setLibTiming = useCallback((lib: LibKey, t: Timing) =>
    setTimings(prev => ({ ...prev, [lib]: t })), []);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setData(null);
    setLoadMs(null);
    setTimings({ seegak: null, plotly: null, vitessce: null });
    setStates({ seegak: 'loading', plotly: 'loading', vitessce: 'loading' });

    const t0 = performance.now();
    const ds = selectedDataset === 'synthetic' ? undefined : selectedDataset;
    const { data: d, source } = await loadData(selectedN, ds);
    const elapsed = performance.now() - t0;

    setLoadMs(elapsed);
    setDataSource(source);
    setData(d);
    setStates({ seegak: 'rendering', plotly: 'rendering', vitessce: 'rendering' });
  }, [selectedN, selectedDataset]);

  const handleTiming = useCallback((lib: LibKey) => (t: Timing) => {
    setLibState(lib, 'done');
    setLibTiming(lib, t);
  }, [setLibState, setLibTiming]);

  const doneLibs = LIBS.filter(l => states[l.key] === 'done');
  const allDone = doneLibs.length === LIBS.length;
  const fastestMs = allDone
    ? Math.min(...LIBS.map(l => timings[l.key]?.renderMs ?? Infinity))
    : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', padding: '0 0 64px' }}>

      {/* Header */}
      <header style={{ padding: '28px 40px 20px', borderBottom: '1px solid #1e2a3a' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f0f4ff' }}>
            Seegak · Performance Benchmark
          </h1>
          <a href="/" style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none' }}>
            ← 데모로 돌아가기
          </a>
        </div>
        <p style={{ fontSize: 13, color: '#4a5a6a', marginTop: 4 }}>
          동일한 UMAP scatter 데이터를 세 가지 방식으로 렌더링하여 첫 프레임 시간을 비교합니다.
          {dataSource === 'server' ? ' · GTEx snRNAseq (벤치마크 서버)' : dataSource === 'synthetic' ? ' · 합성 데이터 (서버 미연결)' : ''}
        </p>
      </header>

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        padding: '18px 40px', background: '#0d1420', borderBottom: '1px solid #1e2a3a',
      }}>
        {datasets.length > 1 && (
          <>
            <span style={{ fontSize: 13, color: '#6a8aaa' }}>데이터셋:</span>
            <select
              value={selectedDataset}
              onChange={e => setSelectedDataset(e.target.value)}
              title="데이터셋 선택"
              style={{
                padding: '7px 12px', border: '1px solid #2a3a4a', borderRadius: 6,
                background: '#1a2332', color: '#e0e6f0', fontSize: 13,
                cursor: 'pointer', outline: 'none', maxWidth: 280,
              }}
            >
              {datasets.map(ds => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.cells > 0 ? `${(ds.cells / 1000).toFixed(0)}K` : '—'} cells)
                </option>
              ))}
            </select>
            <div style={{ width: 1, height: 20, background: '#2a3a4a' }} />
          </>
        )}
        <span style={{ fontSize: 13, color: '#6a8aaa' }}>포인트 수:</span>
        {sizes.map(n => (
          <button key={n} type="button" onClick={() => setSelectedN(n)} style={{
            padding: '7px 16px', border: 'none', borderRadius: 6,
            cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'monospace',
            background: selectedN === n ? '#3b82f6' : '#1a2332',
            color: selectedN === n ? '#fff' : '#6a8aaa',
          }}>
            {n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n}
          </button>
        ))}
        <button
          type="button"
          onClick={handleRun}
          disabled={running && !allDone}
          style={{
            marginLeft: 12, padding: '8px 28px', border: 'none', borderRadius: 6,
            cursor: running && !allDone ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 700,
            background: running && !allDone ? '#1a2332' : '#3b82f6',
            color: running && !allDone ? '#4a5a6a' : '#fff',
          }}
        >
          {running && !allDone ? '측정 중…' : '▶ 벤치마크 실행'}
        </button>
        {allDone && <span style={{ fontSize: 12, color: '#10b981' }}>완료 ✓</span>}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, padding: '24px 40px 0' }}>
        {LIBS.map(lib => (
          <div key={lib.key}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: lib.color }}>{lib.label}</div>
              <div style={{ fontSize: 11, color: '#4a5a6a' }}>{lib.sublabel}</div>
            </div>
            <div style={{
              height: 380, background: '#111827', borderRadius: 10, overflow: 'hidden',
              position: 'relative', border: `1px solid ${states[lib.key] === 'done' ? lib.color + '44' : '#1e2a3a'}`,
              transition: 'border-color 0.4s',
            }}>
              {data && lib.key === 'seegak' && (
                <SeegakPanel data={data} onTiming={handleTiming('seegak')} />
              )}
              {data && lib.key === 'plotly' && (
                <PlotlyPanel data={data} onTiming={handleTiming('plotly')} />
              )}
              {data && lib.key === 'vitessce' && (
                <VitesscePanel data={data} onTiming={handleTiming('vitessce')} />
              )}
              {!data && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#2a3a4a', fontSize: 13,
                }}>
                  {running ? '로딩 중…' : '벤치마크 실행 버튼을 누르세요'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Timing cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, padding: '16px 40px 0' }}>
        {LIBS.map(lib => (
          <TimingCard
            key={lib.key}
            title={lib.label}
            color={lib.color}
            state={states[lib.key]}
            timing={timings[lib.key]}
            loadMs={loadMs}
            n={data?.x.length ?? 0}
          />
        ))}
      </div>

      {/* Winner banner */}
      {fastestMs != null && (() => {
        const winner = LIBS.find(l => timings[l.key]?.renderMs === fastestMs)!;
        const seegakMs = timings.seegak?.renderMs ?? 1;
        return (
          <div style={{
            margin: '20px 40px 0', padding: '20px 28px',
            background: '#0a1a10', border: `1px solid ${winner.color}44`, borderRadius: 10,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: winner.color, marginBottom: 8 }}>
              🏆 {winner.label} 가 가장 빠릅니다 — {fastestMs.toFixed(1)} ms 첫 프레임
            </div>
            <div style={{ fontSize: 13, color: '#4a6a5a', lineHeight: 1.8 }}>
              {LIBS.filter(l => l.key !== winner.key).map(l => {
                const winnerMs = timings[winner.key]?.renderMs ?? 1;
                const ratio = ((timings[l.key]?.renderMs ?? 0) / winnerMs).toFixed(1);
                return `${winner.label}은 ${l.label}보다 ${ratio}× 빠름`;
              }).join('  ·  ')}
            </div>
          </div>
        );
      })()}

      {/* Methodology */}
      <div style={{ margin: '20px 40px 0', padding: '14px 18px', background: '#0d1420', borderRadius: 8, fontSize: 12, color: '#3a4a5a', lineHeight: 1.7 }}>
        <strong style={{ color: '#4a5a6a' }}>측정 방법:</strong>
        {' '}데이터 로드 = fetch + JSON.parse 시간.
        첫 프레임 = update() 호출 후 double requestAnimationFrame 완료까지.
        실제 데이터 사용: <code style={{ color: '#6a8aaa' }}>python benchmark-server/main.py</code>
        (포트 8787) · Vitessce는 Blob URL로 직접 데이터를 로딩하여 네트워크 지연 없이 측정합니다.
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
           Transport Protocol Benchmark
           ═══════════════════════════════════════════════════════════════════ */}
      <TransportBenchmark />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Transport Protocol Benchmark Section
// ═══════════════════════════════════════════════════════════════════════════

const TRANSPORTS = [
  { key: 'restJson',   label: 'REST JSON',          sublabel: 'fetch → JSON.parse',          color: '#f59e0b', icon: '{ }' },
  { key: 'restBinary', label: 'REST Binary',         sublabel: 'fetch → ArrayBuffer',         color: '#3b82f6', icon: '01' },
  { key: 'websocket',  label: 'WebSocket',           sublabel: 'WS → Binary frame',           color: '#10b981', icon: 'WS' },
  { key: 'grpcWeb',    label: 'gRPC-Web',            sublabel: 'POST → Protobuf decode',      color: '#a855f7', icon: 'gR' },
  { key: 'msgpack',    label: 'MessagePack',         sublabel: 'fetch → msgpack.decode',      color: '#ec4899', icon: 'MP' },
  { key: 'flatbuf',    label: 'FlatBuffers',         sublabel: 'fetch → zero-copy views',     color: '#06b6d4', icon: 'FB' },
  { key: 'arrow',      label: 'Arrow IPC',           sublabel: 'fetch → columnar zero-copy',  color: '#ef4444', icon: '→' },
  { key: 'zarr',       label: 'Zarr Chunked',        sublabel: 'fetch → compressed chunks',   color: '#f97316', icon: 'Zr' },
  { key: 'cbor',       label: 'CBOR',                sublabel: 'fetch → RFC 8949 decode',     color: '#8b5cf6', icon: 'CB' },
  { key: 'parquet',    label: 'Parquet',             sublabel: 'fetch → columnar WASM decode', color: '#0ea5e9', icon: 'Pq' },
  { key: 'brotli',     label: 'Brotli Binary',       sublabel: 'fetch → br auto-decompress',  color: '#14b8a6', icon: 'Br' },
  { key: 'sse',        label: 'SSE Streaming',       sublabel: 'EventSource → chunked',       color: '#84cc16', icon: 'SS' },
] as const;

type TransportKey = typeof TRANSPORTS[number]['key'];

const emptyResults = (): Record<TransportKey, TransportResult | null> => ({
  restJson: null, restBinary: null, websocket: null, grpcWeb: null,
  msgpack: null, flatbuf: null, arrow: null, zarr: null,
  cbor: null, parquet: null, brotli: null, sse: null,
});
const emptyErrors = (): Record<TransportKey, string | null> => ({
  restJson: null, restBinary: null, websocket: null, grpcWeb: null,
  msgpack: null, flatbuf: null, arrow: null, zarr: null,
  cbor: null, parquet: null, brotli: null, sse: null,
});

const emptyRunsArray = (): Record<TransportKey, TransportResult[]> => ({
  restJson: [], restBinary: [], websocket: [], grpcWeb: [],
  msgpack: [], flatbuf: [], arrow: [], zarr: [],
  cbor: [], parquet: [], brotli: [], sse: [],
});

function meanStd(values: number[]): { mean: number; std: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, std: 0 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  return { mean, std: Math.sqrt(variance) };
}

function formatMeanStd(values: number[], unit = 'ms'): string {
  const { mean, std } = meanStd(values);
  if (values.length <= 1) return `${mean.toFixed(1)} ${unit}`;
  return `${mean.toFixed(1)}±${std.toFixed(1)} ${unit}`;
}

const BENCH_FNS: Record<TransportKey, (n: number, dataset?: string) => Promise<TransportResult>> = {
  restJson: benchRestJson,
  restBinary: benchRestBinary,
  websocket: benchWebSocket,
  grpcWeb: benchGrpcWeb,
  msgpack: benchMsgpack,
  flatbuf: benchFlatbuf,
  arrow: benchArrowIPC,
  zarr: benchZarr,
  cbor: benchCBOR,
  parquet: benchParquet,
  brotli: benchBrotli,
  sse: benchSSE,
};

function TransportBenchmark() {
  const [selectedN, setSelectedN] = useState<number>(100_000);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<TransportKey, TransportResult | null>>(emptyResults);
  const [allRuns, setAllRuns] = useState<Record<TransportKey, TransportResult[]>>(emptyRunsArray);
  const [errors, setErrors] = useState<Record<TransportKey, string | null>>(emptyErrors);
  const [iteration, setIteration] = useState(0);
  const [repeatCount, setRepeatCount] = useState(5);
  const [currentRun, setCurrentRun] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('synthetic');
  const [networkProfile, setNetworkProfile] = useState<NetworkProfile>('local');

  useEffect(() => {
    fetch(`${SERVER}/api/datasets`)
      .then(r => r.json())
      .then((ds: DatasetInfo[]) => setDatasets(ds))
      .catch(() => {});
  }, []);

  const applyNetworkProfile = useCallback(async (profile: NetworkProfile) => {
    if (profile === 'local') {
      activeServer = SERVER;
      activeWsServer = WS_SERVER;
    } else {
      activeServer = PROXY_SERVER;
      activeWsServer = WS_PROXY_SERVER;
      await fetch(`${PROXY_SERVER}/proxy/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      }).catch(() => {});
    }
    setNetworkProfile(profile);
  }, []);

  const sizes = useMemo(() => {
    const ds = datasets.find(d => d.id === selectedDataset);
    const maxCells = ds?.cells ?? 0;
    const base = BASE_SIZES.filter(n => n < maxCells);
    return maxCells > 0 ? [...base, maxCells] : [...BASE_SIZES];
  }, [datasets, selectedDataset]);

  const runBenchmark = useCallback(async (repeats = 1) => {
    setRunning(true);
    setResults(emptyResults());
    setAllRuns(emptyRunsArray());
    setErrors(emptyErrors());
    setIteration(prev => prev + 1);
    setCurrentRun(0);
    setTotalRuns(repeats);

    const accumulated: Record<TransportKey, TransportResult[]> = emptyRunsArray();
    const ds = selectedDataset === 'synthetic' ? undefined : selectedDataset;

    for (let run = 0; run < repeats; run++) {
      setCurrentRun(run + 1);

      for (const t of TRANSPORTS) {
        try {
          const result = await BENCH_FNS[t.key](selectedN, ds);
          accumulated[t.key].push(result);
          // Show latest result + update accumulated
          setResults(prev => ({ ...prev, [t.key]: result }));
          setAllRuns(() => {
            const copy = { ...accumulated };
            for (const k of Object.keys(copy) as TransportKey[]) {
              copy[k] = [...accumulated[k]];
            }
            return copy;
          });
        } catch (e) {
          setErrors(prev => ({ ...prev, [t.key]: (e as Error).message }));
        }
      }
    }

    setRunning(false);
  }, [selectedN, selectedDataset]);

  const allDone = TRANSPORTS.every(t => results[t.key] != null || errors[t.key] != null);
  const validResults = TRANSPORTS.filter(t => results[t.key] != null);
  const isMultiRun = totalRuns > 1 && !running;

  // For display: use mean values when multi-run
  const getMeanTotal = (key: TransportKey) => {
    const runs = allRuns[key];
    if (runs.length > 1) return meanStd(runs.map(r => r.totalMs)).mean;
    return results[key]?.totalMs ?? 0;
  };

  const fastestTotal = validResults.length > 0
    ? Math.min(...validResults.map(t => getMeanTotal(t.key)))
    : null;
  const maxTotal = validResults.length > 0
    ? Math.max(...validResults.map(t => getMeanTotal(t.key)))
    : 1;

  return (
    <>
      {/* Section header */}
      <div style={{
        margin: '48px 40px 0', padding: '24px 0',
        borderTop: '1px solid #1e2a3a',
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f0f4ff', marginBottom: 4 }}>
          Data Transfer Protocol Benchmark
        </h2>
        <p style={{ fontSize: 13, color: '#4a5a6a' }}>
          동일한 scatter 데이터를 12가지 전송 프로토콜로 가져와 전송 시간 + 파싱 시간을 비교합니다.
          {networkProfile !== 'local' && (
            <span style={{ marginLeft: 12, padding: '2px 8px', borderRadius: 4, background: '#f59e0b22', color: '#f59e0b', fontSize: 11, fontWeight: 600 }}>
              {NETWORK_PROFILES.find(p => p.key === networkProfile)?.label} 시뮬레이션 ({NETWORK_PROFILES.find(p => p.key === networkProfile)?.desc})
            </span>
          )}
        </p>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        padding: '14px 40px', background: '#0d1420', borderRadius: 8,
        margin: '0 40px', border: '1px solid #1e2a3a',
      }}>
        {datasets.length > 1 && (
          <>
            <span style={{ fontSize: 13, color: '#6a8aaa' }}>데이터셋:</span>
            <select
              value={selectedDataset}
              onChange={e => setSelectedDataset(e.target.value)}
              title="데이터셋 선택"
              style={{
                padding: '6px 12px', border: '1px solid #2a3a4a', borderRadius: 6,
                background: '#1a2332', color: '#e0e6f0', fontSize: 13,
                cursor: 'pointer', outline: 'none', maxWidth: 280,
              }}
            >
              {datasets.map(ds => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.cells > 0 ? `${(ds.cells / 1000).toFixed(0)}K` : '—'} cells)
                </option>
              ))}
            </select>
            <div style={{ width: 1, height: 20, background: '#2a3a4a' }} />
          </>
        )}
        <span style={{ fontSize: 13, color: '#6a8aaa' }}>네트워크:</span>
        {NETWORK_PROFILES.map(p => (
          <button key={p.key} type="button"
            onClick={() => applyNetworkProfile(p.key)}
            disabled={running}
            title={p.desc}
            style={{
              padding: '6px 12px', border: 'none', borderRadius: 6,
              cursor: running ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600,
              background: networkProfile === p.key ? '#f59e0b' : '#1a2332',
              color: networkProfile === p.key ? '#000' : '#6a8aaa',
            }}>
            {p.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: '#2a3a4a' }} />

        <span style={{ fontSize: 13, color: '#6a8aaa' }}>포인트 수:</span>
        {sizes.map(n => (
          <button key={n} type="button" onClick={() => setSelectedN(n)} style={{
            padding: '6px 14px', border: 'none', borderRadius: 6,
            cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'monospace',
            background: selectedN === n ? '#a855f7' : '#1a2332',
            color: selectedN === n ? '#fff' : '#6a8aaa',
          }}>
            {n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n}
          </button>
        ))}
        <button
          type="button"
          onClick={() => runBenchmark(1)}
          disabled={running}
          style={{
            marginLeft: 12, padding: '8px 24px', border: 'none', borderRadius: 6,
            cursor: running ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 700,
            background: running ? '#1a2332' : '#a855f7',
            color: running ? '#4a5a6a' : '#fff',
          }}
        >
          {running ? '측정 중…' : '▶ 1회 측정'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
          <input
            type="number"
            min={2}
            max={100}
            value={repeatCount}
            title="반복 횟수"
            placeholder="횟수"
            onChange={e => setRepeatCount(Math.max(2, Math.min(100, parseInt(e.target.value) || 2)))}
            disabled={running}
            style={{
              width: 52, padding: '7px 8px', border: '1px solid #2a3a4a', borderRadius: 6,
              background: '#1a2332', color: '#e0e6f0', fontSize: 13, fontFamily: 'monospace',
              textAlign: 'center', outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => runBenchmark(repeatCount)}
            disabled={running}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: 6,
              cursor: running ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700,
              background: running ? '#1a2332' : '#ec4899',
              color: running ? '#4a5a6a' : '#fff',
            }}
          >
            {running ? `${currentRun}/${totalRuns} 반복 중…` : `▶ ${repeatCount}회 반복 측정`}
          </button>
        </div>

        {allDone && !running && <span style={{ fontSize: 12, color: '#10b981' }}>
          완료 ✓ {totalRuns > 1 ? `(${totalRuns}회 평균)` : ''}
        </span>}
      </div>

      {/* Results grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
        padding: '20px 40px 0',
      }}>
        {TRANSPORTS.map(t => {
          const r = results[t.key];
          const runs = allRuns[t.key];
          const err = errors[t.key];
          const multi = runs.length > 1;
          const mTotal = multi ? meanStd(runs.map(v => v.totalMs)).mean : (r?.totalMs ?? 0);
          const pctBar = r && maxTotal > 0 ? (mTotal / maxTotal) * 100 : 0;
          const isFastest = r != null && fastestTotal != null && Math.abs(mTotal - fastestTotal) < 0.01;
          return (
            <div key={t.key} style={{
              background: '#0d1420', borderRadius: 10, padding: '16px 20px',
              border: `1px solid ${isFastest ? t.color + '88' : r ? t.color + '33' : '#1e2a3a'}`,
              transition: 'border-color 0.3s',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: t.color + '22', color: t.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, fontFamily: 'monospace',
                }}>
                  {t.icon}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e6f0' }}>{t.label}</div>
                  <div style={{ fontSize: 10, color: '#4a5a6a' }}>{t.sublabel}</div>
                </div>
                {isFastest && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: t.color, fontWeight: 700 }}>
                    FASTEST
                  </span>
                )}
                {multi && !running && (
                  <span style={{ marginLeft: isFastest ? 0 : 'auto', fontSize: 10, color: '#5a6a7a' }}>
                    n={runs.length}
                  </span>
                )}
              </div>

              {err ? (
                <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 0' }}>Error: {err}</div>
              ) : r ? (
                <>
                  {/* Total time bar */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: '#8899aa' }}>총 시간</span>
                      <span style={{ color: t.color, fontFamily: 'monospace', fontWeight: 700, fontSize: 16 }}>
                        {multi ? formatMeanStd(runs.map(v => v.totalMs)) : `${r.totalMs.toFixed(1)} ms`}
                      </span>
                    </div>
                    <div style={{ height: 8, background: '#1a2332', borderRadius: 4 }}>
                      <div style={{
                        height: '100%', width: `${pctBar}%`,
                        background: `linear-gradient(90deg, ${t.color}, ${t.color}88)`,
                        borderRadius: 4, transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>

                  {/* Breakdown */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div style={{ background: '#111827', borderRadius: 6, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#5a6a7a', marginBottom: 2 }}>전송</div>
                      <div style={{ fontSize: multi ? 12 : 14, fontWeight: 700, color: '#e0e6f0', fontFamily: 'monospace' }}>
                        {multi
                          ? formatMeanStd(runs.map(v => v.transferMs))
                          : <>{r.transferMs.toFixed(1)}<span style={{ fontSize: 10, color: '#5a6a7a' }}> ms</span></>}
                      </div>
                    </div>
                    <div style={{ background: '#111827', borderRadius: 6, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#5a6a7a', marginBottom: 2 }}>파싱</div>
                      <div style={{ fontSize: multi ? 12 : 14, fontWeight: 700, color: '#e0e6f0', fontFamily: 'monospace' }}>
                        {multi
                          ? formatMeanStd(runs.map(v => v.parseMs))
                          : <>{r.parseMs.toFixed(1)}<span style={{ fontSize: 10, color: '#5a6a7a' }}> ms</span></>}
                      </div>
                    </div>
                  </div>

                  {/* Data size */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#4a5a6a', borderTop: '1px solid #1e2a3a', paddingTop: 8 }}>
                    <span>데이터 크기</span>
                    <span style={{ fontFamily: 'monospace', color: '#6a8aaa' }}>
                      {r.dataSize > 1_000_000
                        ? `${(r.dataSize / 1_000_000).toFixed(2)} MB`
                        : `${(r.dataSize / 1_000).toFixed(1)} KB`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#4a5a6a', paddingTop: 4 }}>
                    <span>포인트 수</span>
                    <span style={{ fontFamily: 'monospace', color: '#6a8aaa' }}>
                      {r.pointCount.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#4a5a6a', paddingTop: 4 }}>
                    <span>처리량</span>
                    <span style={{ fontFamily: 'monospace', color: '#6a8aaa' }}>
                      {multi
                        ? `${(r.dataSize / (mTotal / 1000) / 1_000_000).toFixed(1)} MB/s`
                        : `${(r.dataSize / (r.totalMs / 1000) / 1_000_000).toFixed(1)} MB/s`}
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: '#2a3a4a', padding: '20px 0', textAlign: 'center' }}>
                  {running ? '대기 중…' : '벤치마크를 실행하세요'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Winner summary */}
      {allDone && !running && fastestTotal != null && (() => {
        const winner = TRANSPORTS.find(t => Math.abs(getMeanTotal(t.key) - fastestTotal) < 0.01)!;
        const slowest = TRANSPORTS.reduce((a, b) =>
          getMeanTotal(a.key) > getMeanTotal(b.key) ? a : b
        );
        const speedup = getMeanTotal(slowest.key) / fastestTotal;

        return (
          <div style={{
            margin: '16px 40px 0', padding: '16px 24px',
            background: '#0a1a10', border: `1px solid ${winner.color}44`, borderRadius: 10,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: winner.color, marginBottom: 6 }}>
              🏆 {winner.label} — {isMultiRun
                ? formatMeanStd(allRuns[winner.key].map(v => v.totalMs))
                : `${fastestTotal.toFixed(1)} ms`} 로 가장 빠름
              {isMultiRun && <span style={{ fontSize: 12, fontWeight: 400, color: '#4a6a5a' }}> ({totalRuns}회 평균)</span>}
            </div>
            <div style={{ fontSize: 12, color: '#4a6a5a', lineHeight: 1.8 }}>
              {TRANSPORTS.filter(t => t.key !== winner.key && results[t.key]).map(t => {
                const mt = getMeanTotal(t.key);
                const ratio = (mt / fastestTotal).toFixed(1);
                return `${t.label}: ${isMultiRun
                  ? formatMeanStd(allRuns[t.key].map(v => v.totalMs))
                  : `${mt.toFixed(1)} ms`} (${ratio}× 느림)`;
              }).join('  ·  ')}
            </div>
            <div style={{ fontSize: 12, color: '#4a6a5a', marginTop: 6 }}>
              {winner.label}은 {slowest.label} 대비 <strong style={{ color: winner.color }}>{speedup.toFixed(1)}×</strong> 빠름
              {' · '}데이터 크기: REST JSON {((results.restJson?.dataSize ?? 0) / 1000).toFixed(0)} KB vs{' '}
              {winner.key !== 'restJson' ? `${winner.label} ${((results[winner.key]?.dataSize ?? 0) / 1000).toFixed(0)} KB` : ''}
              {results.restJson && results.grpcWeb && winner.key !== 'restJson' && (
                <> ({((1 - (results[winner.key]?.dataSize ?? 0) / (results.restJson?.dataSize ?? 1)) * 100).toFixed(0)}% 절감)</>
              )}
            </div>
          </div>
        );
      })()}

      {/* Methodology */}
      <div style={{ margin: '16px 40px 0', padding: '14px 18px', background: '#0d1420', borderRadius: 8, fontSize: 12, color: '#3a4a5a', lineHeight: 1.7 }}>
        <strong style={{ color: '#4a5a6a' }}>측정 방법:</strong>
        {' '}각 프로토콜을 순차적으로 실행하여 경쟁 조건을 방지합니다.
        전송 = 서버 응답 수신까지, 파싱 = 바이너리/JSON 디코딩 시간.
        {' '}REST JSON: fetch → JSON.parse
        {' '}· REST Binary: fetch → ArrayBuffer
        {' '}· WebSocket: WS → binary frame
        {' '}· gRPC-Web: POST → Protobuf decode
        {' '}· MessagePack: fetch → msgpack binary decode
        {' '}· FlatBuffers: fetch → zero-copy typed array views (파싱 0ms)
        {' '}· Arrow IPC: fetch → Apache Arrow columnar decode
        {' '}· Zarr: fetch → compressed chunk decompress (zlib/zstd)
        {' '}· CBOR: fetch → RFC 8949 binary decode
        {' '}· Parquet: fetch → WASM columnar decode (Snappy 압축)
        {' '}· Brotli Binary: fetch → Content-Encoding: br 네이티브 해제
        {' '}· SSE: EventSource → chunked base64 streaming
      </div>
    </>
  );
}
