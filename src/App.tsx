import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  ScatterChart,
  FeaturePlotChart,
  BoxPlotChart,
  BarChart,
  PieChart,
  HumanBodyMap,
  DotPlotChart,
  HeatmapChart,
  ViolinPlotChart,
} from '@seegak/react';
import type { ColorScale, ScatterSelectEvent, ScatterData } from '@seegak/react';
import type { BodyMapEvent } from '@seegak/human-body-map';
import { initGenomicsDemo } from './demo-genomics';
import { init3DDemo } from './demo-3d';
import { initGatingDemo } from './demo-gating';
import {
  generateUMAPData,
  generateFeaturePlotData,
  generateBoxPlotData,
  generateCellCountData,
  generateCellTypeProportionData,
  generateBodyMapData,
  generateMarkerGenes,
  generateDotPlotData,
  generateHeatmapData,
  generateViolinData,
} from './mock-data';
import { fetchDatasets, loadScatterData, loadGeneExpression, type DatasetInfo, type LoadedScatterData } from './dataset-loader';

// Custom color scale: visible on dark backgrounds
const EXPRESSION_SCALE: ColorScale = {
  stops: [
    { position: 0.0, color: { r: 0.6, g: 0.6, b: 0.65, a: 1 } },
    { position: 0.3, color: { r: 0.2, g: 0.4, b: 0.8,  a: 1 } },
    { position: 0.6, color: { r: 0.9, g: 0.2, b: 0.2,  a: 1 } },
    { position: 1.0, color: { r: 1.0, g: 0.95, b: 0.2, a: 1 } },
  ],
};

const umapData      = generateUMAPData();
const cellCountData = generateCellCountData();
const pieData       = generateCellTypeProportionData();
const bodyMapData   = generateBodyMapData();
const markerGenes   = generateMarkerGenes();
const dotPlotData   = generateDotPlotData();
const heatmapData   = generateHeatmapData();
const violinData    = generateViolinData('SFTPC');

const GENES = ['SFTPC', 'AGER', 'PECAM1', 'CD68'] as const;

/** Fixed-size chart container — prevents ResizeObserver feedback loops */
function ChartBox({
  label, children, lightBg,
}: {
  label?: string;
  children: ReactNode;
  lightBg?: boolean;
}) {
  return (
    <div style={{ ...chartCard, ...(lightBg ? { background: '#f5f5f8' } : {}) }}>
      {label && (
        <div style={{ ...chartLabel, ...(lightBg ? { color: '#444' } : {}) }}>
          {label}
        </div>
      )}
      <div style={{
        position: 'absolute',
        top: label ? 44 : 16,
        left: 16, right: 16, bottom: 16,
      }}>
        {children}
      </div>
    </div>
  );
}

type DemoTab = 'main' | 'genomics' | '3d' | 'gating';

function App() {
  const [activeTab, setActiveTab]           = useState<DemoTab>('main');
  const [selectedGene, setSelectedGene]     = useState<string>('SFTPC');
  const [selectedOrgan, setSelectedOrgan]   = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [selectedCells, setSelectedCells]   = useState<{ indices: number[]; type: string } | null>(null);

  // ─── Dataset Loading ───
  const [datasets, setDatasets]             = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('mock');
  const [serverData, setServerData]         = useState<LoadedScatterData | null>(null);
  const [dataLoading, setDataLoading]       = useState(false);
  const [dataError, setDataError]           = useState<string | null>(null);

  // Fetch dataset list on mount
  useEffect(() => {
    fetchDatasets()
      .then(ds => setDatasets(ds))
      .catch(() => setDatasets([])); // server may be offline
  }, []);

  // Load dataset when selection changes
  useEffect(() => {
    if (selectedDataset === 'mock') {
      setServerData(null);
      setDataError(null);
      return;
    }
    setDataLoading(true);
    setDataError(null);
    loadScatterData(selectedDataset)
      .then(data => { setServerData(data); setDataLoading(false); })
      .catch(err => { setDataError(String(err)); setDataLoading(false); });
  }, [selectedDataset]);

  const genomicsRef = useRef<HTMLDivElement>(null);
  const threeDRef   = useRef<HTMLDivElement>(null);
  const gatingRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'genomics' && genomicsRef.current && !genomicsRef.current.dataset.initialized) {
      genomicsRef.current.dataset.initialized = '1';
      initGenomicsDemo(genomicsRef.current);
    }
    if (activeTab === '3d' && threeDRef.current && !threeDRef.current.dataset.initialized) {
      threeDRef.current.dataset.initialized = '1';
      init3DDemo(threeDRef.current);
    }
    if (activeTab === 'gating' && gatingRef.current && !gatingRef.current.dataset.initialized) {
      gatingRef.current.dataset.initialized = '1';
      initGatingDemo(gatingRef.current);
    }
  }, [activeTab]);

  // ─── Gene Expression Loading ───
  const [expressionValues, setExpressionValues] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (!serverData || selectedDataset === 'mock') {
      setExpressionValues(null);
      return;
    }
    loadGeneExpression(selectedDataset, selectedGene)
      .then(v => setExpressionValues(v))
      .catch(() => setExpressionValues(null));
  }, [serverData, selectedGene, selectedDataset]);

  // Use server data if loaded, otherwise use mock data
  const featureValues = serverData ? expressionValues : generateFeaturePlotData(selectedGene).expression;
  const activeUmapData: ScatterData = serverData
    ? { x: serverData.x, y: serverData.y, colors: serverData.colors, labels: serverData.labels, values: featureValues ?? undefined }
    : { ...umapData, values: featureValues ?? undefined };
  const activeZData = serverData?.z ?? (serverData ? undefined : umapData.z);
  const activeCellCount = serverData
    ? (() => {
        const counts = new Map<string, number>();
        for (const l of serverData.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
        return {
          groups: Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => ({ label, value, color: serverData.clusterColors[label] })),
        };
      })()
    : cellCountData;
  const activePieData = serverData
    ? {
        slices: Array.from((() => {
          const counts = new Map<string, number>();
          for (const l of serverData.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
          return counts;
        })().entries())
          .sort((a, b) => b[1] - a[1])
          .map(([label, value]) => ({ label, value, color: serverData.clusterColors[label] })),
      }
    : pieData;
  const activeDatasetName = serverData
    ? datasets.find(d => d.id === selectedDataset)?.name ?? selectedDataset
    : 'Lung (Right) snRNAseq — Mock Data';

  const featureData = generateFeaturePlotData(selectedGene);
  const boxData     = generateBoxPlotData(selectedGene);

  const handleOrganClick = useCallback((e: BodyMapEvent) => {
    setSelectedOrgan(prev => (prev === e.organId ? null : e.organId));
  }, []);

  const handleSelectPoints = useCallback((e: ScatterSelectEvent) => {
    setSelectedCells({ indices: e.indices, type: e.type });
  }, []);

  return (
    <div style={{ background: '#0a0e17', color: '#e0e6f0', minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <header style={{ padding: '32px 48px 24px', borderBottom: '1px solid #1e2a3a', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#f0f4ff' }}>
            Seegak Visualization Demo
          </h1>
          <p style={{ margin: '8px 0 0', color: '#7a8ba8', fontSize: 14 }}>
            High-performance WebGL biology data visualization — {activeDatasetName}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <label style={{ fontSize: 12, color: '#6a8aaa', fontWeight: 500 }}>Dataset:</label>
          <select
            title="Select dataset"
            value={selectedDataset}
            onChange={(e) => setSelectedDataset(e.target.value)}
            style={{
              background: '#1a2332',
              border: '1px solid #2a3a4a',
              borderRadius: 6,
              color: '#c0cade',
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              outline: 'none',
              minWidth: 200,
            }}
          >
            <option value="mock">Mock Data (7,250 cells)</option>
            {datasets.map(ds => (
              <option key={ds.id} value={ds.id}>
                {ds.name} ({ds.cells > 0 ? ds.cells.toLocaleString() + ' cells' : 'generated'})
              </option>
            ))}
          </select>
          {dataLoading && <span style={{ fontSize: 12, color: '#3b82f6' }}>Loading...</span>}
          {dataError && <span style={{ fontSize: 12, color: '#ef4444' }}>Server offline</span>}
        </div>
      </header>

      {/* Tab Navigation */}
      <div style={{ padding: '0 48px', borderBottom: '1px solid #1e2a3a', display: 'flex', gap: 0 }}>
        {([ ['main', 'Single-Cell (snRNAseq)'], ['genomics', 'Genomics'], ['3d', '3D Visualization'], ['gating', 'Cell Gating (FACS)'] ] as [DemoTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab ? '#3b82f6' : '#6a7a8a',
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <main style={{ padding: '32px 48px', maxWidth: 1600, margin: '0 auto' }}>

        {/* ── New demo panels (imperative / canvas-based) ── */}
        <div ref={genomicsRef} style={{ display: activeTab === 'genomics' ? 'block' : 'none', minHeight: 700 }} />
        <div ref={threeDRef}   style={{ display: activeTab === '3d'       ? 'block' : 'none', minHeight: 500 }} />
        <div ref={gatingRef}   style={{ display: activeTab === 'gating'   ? 'block' : 'none', minHeight: 600 }} />

        {/* ── Existing main demo (shown only on 'main' tab) ── */}
        <div style={{ display: activeTab === 'main' ? 'block' : 'none' }}>

        {/* ── Section 1: UMAP Scatter (툴바 + 범례 + 툴팁 + 선택) ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Cell Type UMAP Clustering</h2>
          <p style={sectionDesc}>
            {serverData
              ? `${serverData.x.length.toLocaleString()} cells — ${serverData.clusters.length} clusters. Loaded from server.`
              : '7,250 cells from snRNAseq (SNARE-seq2) — 10 cell types identified via Leiden clustering.'}
            {' '}Use the toolbar to switch between pan / zoom / box select / lasso select. Toggle cell types in the legend on the right.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, marginBottom: 16 }}>
            {/* UMAP */}
            <div style={{ ...chartCard, height: 560, padding: 0 }}>
              <ScatterChart
                data={activeUmapData}
                z={activeZData}
                enable3D={!!activeZData}
                pointSize={3}
                opacity={0.85}
                autoFit
                tooltip
                toolbarPreset="full"
                legend
                legendTitle="Cell Types"
                legendPosition="right"
                onSelectPoints={handleSelectPoints}
              />
            </div>

            {/* 우측 — Pie + 선택 결과 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: 560 }}>
              <div style={{ ...chartCard, flex: '1 1 0', minHeight: 0 }}>
                <div style={{ position: 'absolute', inset: 0 }}>
                  <PieChart data={activePieData} showLabels showPercentage />
                </div>
              </div>

              {/* 선택된 셀 정보 패널 */}
              <div style={{
                ...chartCard,
                flex: '0 0 auto',
                padding: '16px 20px',
                minHeight: 90,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}>
                {selectedCells && selectedCells.indices.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, color: '#5a6a7a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      Selected Cells ({selectedCells.type === 'box' ? 'Box Select' : 'Lasso Select'})
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#3b82f6' }}>
                      {selectedCells.indices.length.toLocaleString()}
                      <span style={{ fontSize: 13, fontWeight: 400, color: '#6a8aaa', marginLeft: 6 }}>cells</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#4a6a8a', marginTop: 4 }}>
                      index {selectedCells.indices[0]}
                      {selectedCells.indices.length > 1 && ` ~ ${selectedCells.indices[selectedCells.indices.length - 1]}`}
                    </div>
                  </>
                ) : (
                  <p style={{ color: '#3a4a5a', fontSize: 13, margin: 0, textAlign: 'center' }}>
                    Use Box Select or Lasso Select from the toolbar<br />to select cells — results will appear here
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 2: Feature Plot + Box Plot ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Gene Expression Analysis</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {GENES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setSelectedGene(g)}
                style={{
                  padding: '8px 20px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  background: selectedGene === g ? '#3b82f6' : '#1a2332',
                  color: selectedGene === g ? '#fff' : '#8899aa',
                  transition: 'all 0.15s',
                }}
              >
                {g}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: 500 }}>
            <ChartBox label={`Feature Plot — ${selectedGene}`} lightBg>
              <FeaturePlotChart data={featureData} pointSize={3} opacity={0.9} colorScale={EXPRESSION_SCALE} autoFit />
            </ChartBox>
            <ChartBox label={`Expression Distribution — ${selectedGene}`}>
              <BoxPlotChart data={{ ...boxData, xLabel: 'Cell Type', yLabel: 'Expression (log2)' }} showOutliers outlierSize={2} />
            </ChartBox>
          </div>
        </section>

        {/* ── Section 3: Bar Chart + Marker Genes Table ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Cluster Statistics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: 420 }}>
            <ChartBox label="Cell Count by Type">
              <BarChart data={{ ...activeCellCount, xLabel: 'Cell Type', yLabel: 'Cell Count' }} defaultColor="#3b82f6" />
            </ChartBox>
            <div style={{ ...chartCard, overflow: 'auto' }}>
              <div style={chartLabel}>Top Marker Genes per Cluster</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #1e2a3a', textAlign: 'left' }}>
                    <th style={th}>Cluster</th>
                    <th style={th}>Gene</th>
                    <th style={{ ...th, textAlign: 'right' }}>log2FC</th>
                    <th style={{ ...th, textAlign: 'right' }}>p-value</th>
                  </tr>
                </thead>
                <tbody>
                  {markerGenes.map((mg, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #141c28' }}>
                      <td style={td}>{mg.cluster}</td>
                      <td style={{ ...td, fontFamily: 'monospace', color: '#60a5fa' }}>{mg.gene}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{mg.log2fc.toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: '#6ee7b7' }}>
                        {mg.pval.toExponential(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Section 4: Dot Plot ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Marker Gene Dot Plot</h2>
          <p style={sectionDesc}>
            Marker gene expression profile per cell type. Dot size = fraction expressing, dot color = mean expression.
          </p>
          <div style={{ ...chartCard, height: 560 }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <DotPlotChart data={dotPlotData} maxRadius={14} />
            </div>
          </div>
        </section>

        {/* ── Section 5: Heatmap ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Single-Cell Expression Heatmap</h2>
          <p style={sectionDesc}>
            300 cells × 20 marker genes. Rows sorted by cluster, cluster color bar on the left.
            Color = expression level (VIRIDIS colorscale).
          </p>
          <div style={{ ...chartCard, height: 580 }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <HeatmapChart data={heatmapData} normalize="gene" />
            </div>
          </div>
        </section>

        {/* ── Section 6: Violin Plot ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Gene Expression Distribution — Violin Plot</h2>
          <p style={sectionDesc}>
            Per-cell SFTPC expression distribution by cell type. Density estimated via KDE shown as violin shape.
            White line = median, white box = Q1–Q3 range.
          </p>
          <div style={{ ...chartCard, height: 520 }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <ViolinPlotChart data={violinData} showBox />
            </div>
          </div>
        </section>

        {/* ── Section 7: Human Body Map ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Dataset Explorer — Human Body Map</h2>
          <p style={sectionDesc}>
            Filter by organ system, then click an organ to view datasets. Data from K-MAP Korean Human Biological Data Portal.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {(['respiratory','cardiovascular','digestive','urinary','nervous','endocrine','reproductive','lymphatic','musculoskeletal','integumentary'] as const).map(sys => {
              const active = selectedSystem === sys;
              return (
                <button
                  key={sys}
                  onClick={() => { setSelectedSystem(active ? null : sys); setSelectedOrgan(null); }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 999,
                    border: `1px solid ${active ? '#3b82f6' : '#2a3a4a'}`,
                    background: active ? '#1e3a8a' : '#0d1420',
                    color: active ? '#fff' : '#8a9aaa',
                    fontSize: 13,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {sys}
                </button>
              );
            })}
            {selectedSystem && (
              <button
                onClick={() => setSelectedSystem(null)}
                style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid #3a4a5a', background: 'transparent', color: '#6a7a8a', fontSize: 13, cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: 520 }}>
            <ChartBox>
              <HumanBodyMap
                data={bodyMapData}
                onOrganClick={handleOrganClick}
                systemFilter={selectedSystem}
                showLabels
                defaultColor="#1a2a3a"
                hoverColor="#2a4a6a"
                activeColor="#3b82f6"
              />
            </ChartBox>
            <div style={{ ...chartCard, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 32 }}>
              {selectedOrgan && bodyMapData[selectedOrgan] ? (
                <>
                  <h3 style={{ fontSize: 22, margin: '0 0 24px', textTransform: 'capitalize', color: '#f0f4ff' }}>
                    {selectedOrgan}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                    <StatCard label="Datasets" value={bodyMapData[selectedOrgan]!.datasetCount} />
                    <StatCard label="Cells" value={bodyMapData[selectedOrgan]!.cellCount.toLocaleString()} />
                    <StatCard label="Samples" value={bodyMapData[selectedOrgan]!.sampleCount} />
                  </div>
                </>
              ) : (
                <p style={{ color: '#4a5a6a', fontSize: 16, textAlign: 'center' }}>
                  Select an organ to view dataset information
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Dataset Metadata ── */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={sectionTitle}>Dataset Metadata</h2>
          <div style={{ ...chartCard, padding: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <MetaItem label="Public ID"        value="HBM826.BQLS.392" />
              <MetaItem label="Data Type"        value="snRNAseq (SNARE-seq2)" />
              <MetaItem label="Organ"            value="Lung (Right)" />
              <MetaItem label="Source"           value="UC San Diego TMC" />
              <MetaItem label="Status"           value="Published" />
              <MetaItem label="Publication Date" value="2025-08-24" />
            </div>
          </div>
        </section>
        </div>{/* end main tab wrapper */}
      </main>

      <footer style={{ padding: '24px 48px', borderTop: '1px solid #1e2a3a', textAlign: 'center', color: '#3a4a5a', fontSize: 12 }}>
        Powered by Seegak — WebGL2 High-Performance Biology Visualization
      </footer>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#0d1420', borderRadius: 8, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#3b82f6' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6a7a8a', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#5a6a7a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#c0cade' }}>{value}</div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 20, fontWeight: 600, margin: '0 0 8px', color: '#e0e8f4',
};

const sectionDesc: React.CSSProperties = {
  fontSize: 13, color: '#6a7a8a', margin: '0 0 16px',
};

const chartCard: React.CSSProperties = {
  background: '#111827',
  borderRadius: 12,
  border: '1px solid #1e2a3a',
  padding: 16,
  position: 'relative',
};

const chartLabel: React.CSSProperties = {
  fontSize: 12,
  color: '#6a8aaa',
  marginBottom: 8,
  fontWeight: 500,
  position: 'relative',
  zIndex: 1,
};

const th: React.CSSProperties = {
  padding: '10px 12px',
  color: '#6a8aaa',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 600,
};

const td: React.CSSProperties = {
  padding: '8px 12px',
  color: '#c0cade',
};

export default App;
