import { GatingPlot } from '@seegak/analysis';

export function initGatingDemo(container: HTMLElement): void {
  container.innerHTML = `
    <div style="height:100%">
      <h3>Cell Gating (FACS-style) — Draw lasso to create gates</h3>
      <div id="gating-container" style="height:calc(100% - 60px)"></div>
      <div id="gate-summary" style="padding:8px;font-size:12px;color:#666"></div>
    </div>
  `;

  // Generate synthetic FSC/SSC scatter data
  const n = 5000;
  const x = new Float32Array(n).map(() => Math.random() * 1000);
  const y = new Float32Array(n).map(() => Math.random() * 1000);

  const gatingPlot = new GatingPlot(
    document.getElementById('gating-container')!,
    {
      onGateCreated: (gate) => {
        gatingPlot.gateManager.computeMembers(gate.id, x, y).then((members) => {
          document.getElementById('gate-summary')!.textContent =
            `Gate "${gate.name}": ${members.length} cells (${(members.length/n*100).toFixed(1)}%)`;
        });
      }
    }
  );
  gatingPlot.update({ x, y, xLabel: 'FSC-A', yLabel: 'SSC-A' });
}
