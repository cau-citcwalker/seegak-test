import { VolcanoPlotChart, EnrichmentPlotChart, GenomicProfileChart } from '@seegak/genomics';

export function initGenomicsDemo(container: HTMLElement): void {
  // Create a layout with 3 sections
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;height:100%">
      <div>
        <h3>Volcano Plot</h3>
        <div id="volcano-container" style="height:400px"></div>
      </div>
      <div>
        <h3>Enrichment Plot (GSEA)</h3>
        <div id="enrichment-container" style="height:400px"></div>
      </div>
      <div style="grid-column:1/-1">
        <h3>Genomic Profile</h3>
        <div id="genomic-container" style="height:200px"></div>
      </div>
    </div>
  `;

  // Generate synthetic volcano data (500 genes)
  const n = 500;
  const x = new Float32Array(n).map(() => (Math.random() - 0.5) * 8);   // log2FC
  const y = new Float32Array(n).map(() => Math.random() * 8);             // -log10p
  const geneIds = Array.from({length: n}, (_, i) => `Gene${i}`);

  const volcano = new VolcanoPlotChart(
    document.getElementById('volcano-container')!,
    { log2fcThreshold: 1.0, pvalThreshold: 0.05 }
  );
  volcano.update({ x, y, geneIds });

  // GSEA-style enrichment plot
  const nRanks = 1000;
  const nHits = 50;
  const runningScore = new Float32Array(nRanks);
  let score = 0;
  const step = 1 / nRanks;
  for (let i = 0; i < nRanks; i++) {
    score += (Math.random() > 0.9 ? 0.1 : -0.01);
    runningScore[i] = score;
  }
  const hitPositions = new Uint32Array(nHits).map(() => Math.floor(Math.random() * nRanks));
  hitPositions.sort();

  const enrichment = new EnrichmentPlotChart(
    document.getElementById('enrichment-container')!,
    { showStats: true }
  );
  enrichment.update({
    runningScore, hitPositions, totalGenes: nRanks,
    geneSetName: 'HALLMARK_INTERFERON_GAMMA_RESPONSE',
    es: 0.72, nes: 2.31, pval: 0.001, fdr: 0.05
  });

  // Genomic profile
  const nBins = 500;
  const values = new Float32Array(nBins).map(() => Math.random() * 100);
  const profile = new GenomicProfileChart(
    document.getElementById('genomic-container')!,
    {}
  );
  profile.update({
    chrom: 'chr1', start: 1000000, end: 2000000,
    values, binSize: 2000,
    tracks: [
      { label: 'BRCA1', regions: [{ start: 1200000, end: 1400000, strand: '+' }] },
      { label: 'TP53', regions: [{ start: 1600000, end: 1800000, strand: '-' }] }
    ]
  });
}
