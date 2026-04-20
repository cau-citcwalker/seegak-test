/**
 * Mock biological data based on K-MAP single-cell dataset schema.
 * Simulates lung (right) snRNAseq UMAP clustering data.
 */

// Seeded random for reproducibility
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);

function randNormal(mean: number, std: number): number {
  const u = 1 - rng();
  const v = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Cell type definitions for lung tissue
const CELL_TYPES = [
  { name: 'AT1 (Alveolar Type 1)', color: '#e41a1c', cx: -5, cy: 3, sx: 1.2, sy: 1.0, count: 800 },
  { name: 'AT2 (Alveolar Type 2)', color: '#377eb8', cx: -3, cy: -4, sx: 1.0, sy: 1.3, count: 1200 },
  { name: 'Endothelial', color: '#4daf4a', cx: 4, cy: 2, sx: 1.5, sy: 1.1, count: 1500 },
  { name: 'Fibroblast', color: '#984ea3', cx: 6, cy: -3, sx: 1.1, sy: 1.4, count: 900 },
  { name: 'Macrophage', color: '#ff7f00', cx: -1, cy: 7, sx: 1.3, sy: 1.2, count: 700 },
  { name: 'T Cell', color: '#a65628', cx: 2, cy: -7, sx: 0.9, sy: 0.8, count: 600 },
  { name: 'B Cell', color: '#f781bf', cx: -7, cy: -1, sx: 0.8, sy: 0.9, count: 400 },
  { name: 'NK Cell', color: '#999999', cx: 3, cy: -5, sx: 0.7, sy: 0.7, count: 300 },
  { name: 'Ciliated', color: '#66c2a5', cx: -4, cy: 0, sx: 1.0, sy: 0.9, count: 500 },
  { name: 'Smooth Muscle', color: '#fc8d62', cx: 7, cy: 5, sx: 0.9, sy: 1.0, count: 350 },
] as const;

const TOTAL_CELLS = CELL_TYPES.reduce((s, c) => s + c.count, 0);

// Generate UMAP coordinates for scatter chart
export function generateUMAPData() {
  const x = new Float32Array(TOTAL_CELLS);
  const y = new Float32Array(TOTAL_CELLS);
  const z = new Float32Array(TOTAL_CELLS);
  const colors: string[] = [];
  const labels: string[] = [];

  let idx = 0;
  for (const ct of CELL_TYPES) {
    // Each cluster gets a different z center for 3D separation
    const cz = (CELL_TYPES.indexOf(ct) - CELL_TYPES.length / 2) * 1.5;
    for (let i = 0; i < ct.count; i++) {
      x[idx] = randNormal(ct.cx, ct.sx);
      y[idx] = randNormal(ct.cy, ct.sy);
      z[idx] = randNormal(cz, 0.8);
      colors[idx] = ct.color;
      labels[idx] = ct.name;
      idx++;
    }
  }

  return { x, y, z, colors, labels };
}

// Generate gene expression overlay on UMAP (FeaturePlot)
export function generateFeaturePlotData(geneName: string) {
  const base = generateUMAPData();
  const expression = new Float32Array(TOTAL_CELLS);

  // Different genes expressed in different cell types
  const geneProfiles: Record<string, number[]> = {
    'SFTPC': [0.1, 0.9, 0.05, 0.02, 0.05, 0.01, 0.01, 0.01, 0.05, 0.02], // AT2 marker
    'AGER': [0.85, 0.1, 0.05, 0.02, 0.03, 0.01, 0.01, 0.01, 0.03, 0.02],  // AT1 marker
    'PECAM1': [0.05, 0.05, 0.9, 0.1, 0.05, 0.03, 0.02, 0.03, 0.02, 0.05], // Endothelial marker
    'CD68': [0.02, 0.02, 0.03, 0.02, 0.88, 0.05, 0.05, 0.1, 0.02, 0.02],  // Macrophage marker
  };

  const profile = geneProfiles[geneName] ?? geneProfiles['SFTPC']!;
  let idx = 0;
  for (let ci = 0; ci < CELL_TYPES.length; ci++) {
    const ct = CELL_TYPES[ci]!;
    const baseLvl = profile[ci]!;
    for (let i = 0; i < ct.count; i++) {
      // Remap to [0.15, 1.0] so low-expression points are still visible on dark backgrounds
      const raw = Math.max(0, Math.min(1, baseLvl + randNormal(0, 0.15)));
      expression[idx] = 0.15 + raw * 0.85;
      idx++;
    }
  }

  return { x: base.x, y: base.y, expression, geneName };
}

// Gene expression distribution across cell types (BoxPlot)
export function generateBoxPlotData(geneName: string) {
  const geneProfiles: Record<string, number[]> = {
    'SFTPC': [0.3, 4.2, 0.1, 0.05, 0.15, 0.02, 0.03, 0.02, 0.1, 0.05],
    'AGER': [3.8, 0.4, 0.15, 0.08, 0.1, 0.05, 0.03, 0.04, 0.08, 0.06],
    'PECAM1': [0.2, 0.15, 4.5, 0.3, 0.12, 0.08, 0.05, 0.07, 0.06, 0.15],
  };

  const profile = geneProfiles[geneName] ?? geneProfiles['SFTPC']!;

  const groups = CELL_TYPES.map((ct, ci) => {
    const mean = profile[ci]!;
    const values: number[] = [];
    const n = Math.min(ct.count, 200); // Sample for performance
    for (let i = 0; i < n; i++) {
      values.push(Math.max(0, randNormal(mean, mean * 0.4 + 0.1)));
    }
    return { label: ct.name.split('(')[0]!.trim(), values, color: ct.color };
  });

  return {
    groups,
    title: `${geneName} Expression by Cell Type`,
    xLabel: 'Cell Type',
    yLabel: 'log2(Expression + 1)',
  };
}

// Cell count per cluster (BarChart)
export function generateCellCountData() {
  const groups = CELL_TYPES.map((ct) => ({
    label: ct.name.split('(')[0]!.trim(),
    value: ct.count,
    color: ct.color,
  }));

  return {
    groups,
    title: 'Cell Count per Type',
    xLabel: 'Cell Type',
    yLabel: 'Count',
  };
}

// Cell type proportion (PieChart)
export function generateCellTypeProportionData() {
  const slices = CELL_TYPES.map((ct) => ({
    label: ct.name.split('(')[0]!.trim(),
    value: ct.count,
    color: ct.color,
  }));

  return { slices };
}

// Human body map data (organ-level dataset counts from kmap)
export function generateBodyMapData(): Record<string, { datasetCount: number; cellCount: number; sampleCount: number }> {
  return {
    heart: { datasetCount: 2, cellCount: 45000, sampleCount: 12 },
    lung: { datasetCount: 14, cellCount: 128000, sampleCount: 48 },
    liver: { datasetCount: 3, cellCount: 62000, sampleCount: 15 },
    kidney: { datasetCount: 5, cellCount: 78000, sampleCount: 22 },
    brain: { datasetCount: 8, cellCount: 95000, sampleCount: 35 },
    stomach: { datasetCount: 1, cellCount: 18000, sampleCount: 6 },
    intestine: { datasetCount: 4, cellCount: 52000, sampleCount: 18 },
    spleen: { datasetCount: 2, cellCount: 31000, sampleCount: 9 },
    skin: { datasetCount: 3, cellCount: 41000, sampleCount: 14 },
    bladder: { datasetCount: 1, cellCount: 15000, sampleCount: 5 },
  };
}

// Marker gene dot plot: expression profile across cell types
export function generateDotPlotData() {
  // Representative marker genes per cluster
  const genes = [
    'AGER', 'PDPN',       // AT1
    'SFTPC', 'SFTPB',     // AT2
    'PECAM1', 'CDH5',     // Endothelial
    'COL1A1', 'DCN',      // Fibroblast
    'CD68', 'LYZ',        // Macrophage
    'CD3D', 'CD3E',       // T Cell
    'CD79A', 'MS4A1',     // B Cell
    'NKG7', 'GNLY',       // NK Cell
    'FOXJ1', 'PIFO',      // Ciliated
    'ACTA2', 'MYH11',     // Smooth Muscle
  ];

  const clusters = CELL_TYPES.map(ct => ct.name.split('(')[0]!.trim());
  const G = genes.length;
  const C = clusters.length;

  // Mean expression profile per cluster: [cluster][gene] row-major
  // Values represent log-normalized expression (0–5 range)
  const expressionProfiles: Record<string, Record<string, number>> = {
    'AT1':          { AGER: 4.1, PDPN: 3.8, SFTPC: 0.2, SFTPB: 0.1, PECAM1: 0.1, CDH5: 0.1, COL1A1: 0.1, DCN: 0.1, CD68: 0.1, LYZ: 0.1, CD3D: 0.1, CD3E: 0.1, CD79A: 0.1, MS4A1: 0.1, NKG7: 0.1, GNLY: 0.1, FOXJ1: 0.2, PIFO: 0.1, ACTA2: 0.2, MYH11: 0.1 },
    'AT2':          { AGER: 0.3, PDPN: 0.2, SFTPC: 4.5, SFTPB: 4.0, PECAM1: 0.1, CDH5: 0.1, COL1A1: 0.1, DCN: 0.1, CD68: 0.1, LYZ: 0.1, CD3D: 0.1, CD3E: 0.1, CD79A: 0.1, MS4A1: 0.1, NKG7: 0.1, GNLY: 0.1, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 0.2, MYH11: 0.1 },
    'Endothelial':  { AGER: 0.1, PDPN: 0.2, SFTPC: 0.1, SFTPB: 0.1, PECAM1: 4.8, CDH5: 4.2, COL1A1: 0.2, DCN: 0.1, CD68: 0.1, LYZ: 0.1, CD3D: 0.1, CD3E: 0.1, CD79A: 0.1, MS4A1: 0.1, NKG7: 0.1, GNLY: 0.1, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 0.3, MYH11: 0.1 },
    'Fibroblast':   { AGER: 0.1, PDPN: 0.1, SFTPC: 0.1, SFTPB: 0.1, PECAM1: 0.1, CDH5: 0.1, COL1A1: 4.3, DCN: 3.9, CD68: 0.1, LYZ: 0.2, CD3D: 0.1, CD3E: 0.1, CD79A: 0.1, MS4A1: 0.1, NKG7: 0.1, GNLY: 0.1, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 1.2, MYH11: 0.4 },
    'Macrophage':   { AGER: 0.2, PDPN: 0.1, SFTPC: 0.1, SFTPB: 0.1, PECAM1: 0.1, CDH5: 0.1, COL1A1: 0.1, DCN: 0.1, CD68: 4.1, LYZ: 3.8, CD3D: 0.3, CD3E: 0.2, CD79A: 0.1, MS4A1: 0.1, NKG7: 0.4, GNLY: 0.3, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 0.1, MYH11: 0.1 },
    'T Cell':       { AGER: 0.1, PDPN: 0.1, SFTPC: 0.1, SFTPB: 0.1, PECAM1: 0.1, CDH5: 0.1, COL1A1: 0.1, DCN: 0.1, CD68: 0.2, LYZ: 0.3, CD3D: 4.5, CD3E: 4.2, CD79A: 0.1, MS4A1: 0.1, NKG7: 1.2, GNLY: 0.8, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 0.1, MYH11: 0.1 },
    'B Cell':       { AGER: 0.1, PDPN: 0.1, SFTPC: 0.1, SFTPB: 0.1, PECAM1: 0.1, CDH5: 0.1, COL1A1: 0.1, DCN: 0.1, CD68: 0.1, LYZ: 0.4, CD3D: 0.1, CD3E: 0.1, CD79A: 4.7, MS4A1: 4.3, NKG7: 0.1, GNLY: 0.1, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 0.1, MYH11: 0.1 },
    'NK Cell':      { AGER: 0.1, PDPN: 0.1, SFTPC: 0.1, SFTPB: 0.1, PECAM1: 0.1, CDH5: 0.1, COL1A1: 0.1, DCN: 0.1, CD68: 0.1, LYZ: 0.2, CD3D: 0.4, CD3E: 0.3, CD79A: 0.1, MS4A1: 0.1, NKG7: 4.2, GNLY: 3.9, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 0.1, MYH11: 0.1 },
    'Ciliated':     { AGER: 0.1, PDPN: 0.1, SFTPC: 0.1, SFTPB: 0.2, PECAM1: 0.1, CDH5: 0.1, COL1A1: 0.1, DCN: 0.1, CD68: 0.1, LYZ: 0.1, CD3D: 0.1, CD3E: 0.1, CD79A: 0.1, MS4A1: 0.1, NKG7: 0.1, GNLY: 0.1, FOXJ1: 4.1, PIFO: 3.8, ACTA2: 0.1, MYH11: 0.1 },
    'Smooth Muscle':{ AGER: 0.1, PDPN: 0.1, SFTPC: 0.1, SFTPB: 0.1, PECAM1: 0.2, CDH5: 0.1, COL1A1: 0.8, DCN: 0.4, CD68: 0.1, LYZ: 0.1, CD3D: 0.1, CD3E: 0.1, CD79A: 0.1, MS4A1: 0.1, NKG7: 0.1, GNLY: 0.1, FOXJ1: 0.1, PIFO: 0.1, ACTA2: 4.4, MYH11: 4.0 },
  };

  // Fraction expressing: proportion of cluster cells with detectable expression
  const fractionProfiles: Record<string, Record<string, number>> = {
    'AT1':          { AGER: 0.92, PDPN: 0.85, SFTPC: 0.05, SFTPB: 0.04, PECAM1: 0.02, CDH5: 0.02, COL1A1: 0.03, DCN: 0.02, CD68: 0.02, LYZ: 0.03, CD3D: 0.01, CD3E: 0.01, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.02, GNLY: 0.01, FOXJ1: 0.04, PIFO: 0.02, ACTA2: 0.05, MYH11: 0.02 },
    'AT2':          { AGER: 0.08, PDPN: 0.06, SFTPC: 0.95, SFTPB: 0.90, PECAM1: 0.02, CDH5: 0.01, COL1A1: 0.03, DCN: 0.02, CD68: 0.02, LYZ: 0.03, CD3D: 0.01, CD3E: 0.01, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.02, GNLY: 0.01, FOXJ1: 0.02, PIFO: 0.01, ACTA2: 0.04, MYH11: 0.02 },
    'Endothelial':  { AGER: 0.03, PDPN: 0.05, SFTPC: 0.02, SFTPB: 0.01, PECAM1: 0.97, CDH5: 0.92, COL1A1: 0.04, DCN: 0.02, CD68: 0.02, LYZ: 0.03, CD3D: 0.01, CD3E: 0.01, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.02, GNLY: 0.01, FOXJ1: 0.02, PIFO: 0.01, ACTA2: 0.06, MYH11: 0.02 },
    'Fibroblast':   { AGER: 0.02, PDPN: 0.03, SFTPC: 0.01, SFTPB: 0.01, PECAM1: 0.02, CDH5: 0.02, COL1A1: 0.91, DCN: 0.88, CD68: 0.03, LYZ: 0.05, CD3D: 0.01, CD3E: 0.01, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.02, GNLY: 0.01, FOXJ1: 0.02, PIFO: 0.01, ACTA2: 0.28, MYH11: 0.10 },
    'Macrophage':   { AGER: 0.05, PDPN: 0.03, SFTPC: 0.02, SFTPB: 0.01, PECAM1: 0.02, CDH5: 0.01, COL1A1: 0.03, DCN: 0.02, CD68: 0.90, LYZ: 0.87, CD3D: 0.06, CD3E: 0.04, CD79A: 0.01, MS4A1: 0.02, NKG7: 0.09, GNLY: 0.07, FOXJ1: 0.01, PIFO: 0.01, ACTA2: 0.03, MYH11: 0.02 },
    'T Cell':       { AGER: 0.02, PDPN: 0.02, SFTPC: 0.01, SFTPB: 0.01, PECAM1: 0.02, CDH5: 0.01, COL1A1: 0.02, DCN: 0.01, CD68: 0.04, LYZ: 0.06, CD3D: 0.94, CD3E: 0.92, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.24, GNLY: 0.18, FOXJ1: 0.01, PIFO: 0.01, ACTA2: 0.02, MYH11: 0.01 },
    'B Cell':       { AGER: 0.01, PDPN: 0.02, SFTPC: 0.01, SFTPB: 0.01, PECAM1: 0.01, CDH5: 0.01, COL1A1: 0.02, DCN: 0.01, CD68: 0.02, LYZ: 0.08, CD3D: 0.02, CD3E: 0.02, CD79A: 0.96, MS4A1: 0.93, NKG7: 0.02, GNLY: 0.01, FOXJ1: 0.01, PIFO: 0.01, ACTA2: 0.02, MYH11: 0.01 },
    'NK Cell':      { AGER: 0.02, PDPN: 0.01, SFTPC: 0.01, SFTPB: 0.01, PECAM1: 0.01, CDH5: 0.01, COL1A1: 0.02, DCN: 0.01, CD68: 0.02, LYZ: 0.04, CD3D: 0.08, CD3E: 0.06, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.91, GNLY: 0.88, FOXJ1: 0.01, PIFO: 0.01, ACTA2: 0.02, MYH11: 0.01 },
    'Ciliated':     { AGER: 0.02, PDPN: 0.03, SFTPC: 0.03, SFTPB: 0.04, PECAM1: 0.01, CDH5: 0.01, COL1A1: 0.02, DCN: 0.01, CD68: 0.02, LYZ: 0.02, CD3D: 0.01, CD3E: 0.01, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.02, GNLY: 0.01, FOXJ1: 0.90, PIFO: 0.86, ACTA2: 0.02, MYH11: 0.01 },
    'Smooth Muscle':{ AGER: 0.02, PDPN: 0.02, SFTPC: 0.01, SFTPB: 0.01, PECAM1: 0.04, CDH5: 0.02, COL1A1: 0.18, DCN: 0.08, CD68: 0.02, LYZ: 0.02, CD3D: 0.01, CD3E: 0.01, CD79A: 0.01, MS4A1: 0.01, NKG7: 0.02, GNLY: 0.01, FOXJ1: 0.01, PIFO: 0.01, ACTA2: 0.93, MYH11: 0.89 },
  };

  const meanExpression = new Float32Array(C * G);
  const fractionExpressing = new Float32Array(C * G);

  for (let ci = 0; ci < C; ci++) {
    const clusterName = clusters[ci]!;
    const exprRow = expressionProfiles[clusterName] ?? {};
    const fracRow = fractionProfiles[clusterName] ?? {};
    for (let gi = 0; gi < G; gi++) {
      const gene = genes[gi]!;
      meanExpression[ci * G + gi] = (exprRow[gene] ?? 0) + randNormal(0, 0.05);
      fractionExpressing[ci * G + gi] = Math.max(0, Math.min(1, (fracRow[gene] ?? 0) + randNormal(0, 0.02)));
    }
  }

  return {
    genes,
    clusters,
    meanExpression,
    fractionExpressing,
    title: 'Marker Gene Expression — Lung snRNAseq',
  };
}

// Cell × gene heatmap (cells sorted by cluster)
export function generateHeatmapData() {
  // 20 marker genes (2 per cluster)
  const genes = [
    'AGER', 'PDPN',
    'SFTPC', 'SFTPB',
    'PECAM1', 'CDH5',
    'COL1A1', 'DCN',
    'CD68', 'LYZ',
    'CD3D', 'CD3E',
    'CD79A', 'MS4A1',
    'NKG7', 'GNLY',
    'FOXJ1', 'PIFO',
    'ACTA2', 'MYH11',
  ];

  // Per-gene, per-cluster base expression (log-normalized)
  const clusterGeneProfile: Record<string, number[]> = {
    'AT1':          [4.0, 3.6, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.1, 0.2, 0.1],
    'AT2':          [0.3, 0.2, 4.4, 3.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.1],
    'Endothelial':  [0.1, 0.2, 0.1, 0.1, 4.7, 4.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.1],
    'Fibroblast':   [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 4.2, 3.8, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 1.1, 0.4],
    'Macrophage':   [0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 4.0, 3.7, 0.3, 0.2, 0.1, 0.1, 0.4, 0.3, 0.1, 0.1, 0.1, 0.1],
    'T Cell':       [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 4.4, 4.1, 0.1, 0.1, 1.1, 0.8, 0.1, 0.1, 0.1, 0.1],
    'B Cell':       [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.4, 0.1, 0.1, 4.6, 4.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    'NK Cell':      [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.3, 0.1, 0.1, 4.1, 3.8, 0.1, 0.1, 0.1, 0.1],
    'Ciliated':     [0.1, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 4.0, 3.7, 0.1, 0.1],
    'Smooth Muscle':[0.1, 0.1, 0.1, 0.1, 0.2, 0.1, 0.7, 0.3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 4.3, 3.9],
  };

  const CELLS_PER_CLUSTER = 30;
  const clusterNames = CELL_TYPES.map(ct => ct.name.split('(')[0]!.trim());
  const clusterColors: Record<string, string> = Object.fromEntries(
    CELL_TYPES.map(ct => [ct.name.split('(')[0]!.trim(), ct.color]),
  );

  const rows: string[] = [];
  const rowClusters: string[] = [];

  for (const clusterName of clusterNames) {
    for (let i = 0; i < CELLS_PER_CLUSTER; i++) {
      rows.push(''); // Don't show individual cell labels (too many)
      rowClusters.push(clusterName);
    }
  }

  const R = rows.length;
  const G = genes.length;
  const expression = new Float32Array(R * G);

  let cellIdx = 0;
  for (const clusterName of clusterNames) {
    const profile = clusterGeneProfile[clusterName] ?? new Array(G).fill(0.1);
    for (let cell = 0; cell < CELLS_PER_CLUSTER; cell++) {
      for (let gi = 0; gi < G; gi++) {
        // Add per-cell noise on top of cluster profile
        const base = profile[gi]!;
        const noise = randNormal(0, base * 0.2 + 0.05);
        expression[cellIdx * G + gi] = Math.max(0, base + noise);
      }
      cellIdx++;
    }
  }

  return {
    genes,
    rows,
    expression,
    rowClusters,
    clusterColors,
    title: 'Single-Cell Expression Heatmap — Lung snRNAseq',
  };
}

// Violin plot: per-cell expression of a selected gene across cell types
export function generateViolinData(geneName: string = 'SFTPC') {
  const geneProfiles: Record<string, number[]> = {
    'SFTPC':  [0.3, 4.2, 0.1, 0.05, 0.15, 0.02, 0.03, 0.02, 0.1,  0.05],
    'AGER':   [3.8, 0.4, 0.15, 0.08, 0.1,  0.05, 0.03, 0.04, 0.08, 0.06],
    'PECAM1': [0.2, 0.15, 4.5, 0.3,  0.12, 0.08, 0.05, 0.07, 0.06, 0.15],
    'CD68':   [0.1, 0.1,  0.1, 0.1,  3.9,  0.1,  0.1,  0.2,  0.1,  0.1 ],
  };

  const profile = geneProfiles[geneName] ?? geneProfiles['SFTPC']!;
  const groups = CELL_TYPES.map((ct, ci) => {
    const mean = profile[ci]!;
    const values: number[] = [];
    const n = Math.min(ct.count, 300);
    for (let i = 0; i < n; i++) {
      // Mixture of zeros (dropout) + log-normal expression
      const dropout = rng() < (mean < 0.5 ? 0.7 : 0.1);
      values.push(dropout ? 0 : Math.max(0, randNormal(mean, mean * 0.35 + 0.08)));
    }
    return { label: ct.name.split('(')[0]!.trim(), values, color: ct.color };
  });

  return {
    groups,
    title: `${geneName} Expression by Cell Type`,
    xLabel: 'Cell Type',
    yLabel: 'log2(Expression + 1)',
  };
}

// Marker genes table data
export function generateMarkerGenes() {
  return [
    { cluster: 'AT1', gene: 'AGER', log2fc: 3.82, pval: 1.2e-45, rank: 1 },
    { cluster: 'AT1', gene: 'PDPN', log2fc: 3.15, pval: 4.5e-38, rank: 2 },
    { cluster: 'AT1', gene: 'CAV1', log2fc: 2.89, pval: 2.1e-32, rank: 3 },
    { cluster: 'AT2', gene: 'SFTPC', log2fc: 4.21, pval: 3.8e-52, rank: 1 },
    { cluster: 'AT2', gene: 'SFTPB', log2fc: 3.67, pval: 1.1e-44, rank: 2 },
    { cluster: 'AT2', gene: 'ABCA3', log2fc: 3.12, pval: 7.3e-36, rank: 3 },
    { cluster: 'Endothelial', gene: 'PECAM1', log2fc: 4.48, pval: 8.9e-58, rank: 1 },
    { cluster: 'Endothelial', gene: 'VWF', log2fc: 3.95, pval: 2.4e-49, rank: 2 },
    { cluster: 'Endothelial', gene: 'CDH5', log2fc: 3.41, pval: 5.7e-41, rank: 3 },
    { cluster: 'Fibroblast', gene: 'COL1A1', log2fc: 4.12, pval: 6.2e-50, rank: 1 },
    { cluster: 'Macrophage', gene: 'CD68', log2fc: 3.91, pval: 1.5e-47, rank: 1 },
    { cluster: 'T Cell', gene: 'CD3D', log2fc: 4.35, pval: 3.1e-55, rank: 1 },
    { cluster: 'B Cell', gene: 'CD79A', log2fc: 4.67, pval: 9.4e-61, rank: 1 },
    { cluster: 'NK Cell', gene: 'NKG7', log2fc: 3.78, pval: 7.8e-43, rank: 1 },
    { cluster: 'Ciliated', gene: 'FOXJ1', log2fc: 4.05, pval: 2.9e-48, rank: 1 },
    { cluster: 'Smooth Muscle', gene: 'ACTA2', log2fc: 3.56, pval: 4.2e-40, rank: 1 },
  ];
}
