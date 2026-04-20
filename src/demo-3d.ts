import { VolumeView, MeshView, Scatter3DView } from '@seegak/3d';

export function init3DDemo(container: HTMLElement): void {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div>
        <h3>3D UMAP Scatter — Left-drag: rotate, Right-drag: pan, Scroll: zoom, F: 2D/3D, R: reset</h3>
        <div id="scatter3d-container" style="height:500px;background:#0a0e17;border-radius:8px;border:1px solid #1e2a3a;overflow:hidden"></div>
        <div id="scatter3d-legend" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <h3>Volume Rendering (Ray Marching)</h3>
          <div style="margin-bottom:8px">
            <label>Mode:
              <select id="vol-mode">
                <option value="mip">MIP</option>
                <option value="xray">X-Ray</option>
                <option value="iso">ISO Surface</option>
              </select>
            </label>
          </div>
          <div id="volume-container" style="height:380px"></div>
        </div>
        <div>
          <h3>Mesh Rendering (Phong Lighting)</h3>
          <div style="margin-bottom:8px">
            <label><input type="checkbox" id="wireframe-toggle"> Wireframe</label>
          </div>
          <div id="mesh-container" style="height:380px"></div>
        </div>
      </div>
    </div>
  `;

  // ── 3D UMAP Scatter ──
  const nPoints = 3000;
  const clusters = ['T-cell', 'B-cell', 'Macrophage', 'Endothelial', 'Fibroblast', 'AT1', 'AT2', 'Pericyte'];
  const x = new Float32Array(nPoints);
  const y = new Float32Array(nPoints);
  const z = new Float32Array(nPoints);
  const labels: string[] = [];

  for (let i = 0; i < nPoints; i++) {
    const cluster = clusters[Math.floor(Math.random() * clusters.length)]!;
    const ci = clusters.indexOf(cluster);
    // Generate clustered 3D coordinates
    const cx = ((ci % 4) - 1.5) * 8 + (Math.random() - 0.5) * 4;
    const cy = (Math.floor(ci / 4) - 0.5) * 8 + (Math.random() - 0.5) * 4;
    const cz = ((ci * 1.7) % 3 - 1) * 4 + (Math.random() - 0.5) * 3;
    x[i] = cx;
    y[i] = cy;
    z[i] = cz;
    labels.push(cluster);
  }

  const scatterView = new Scatter3DView(
    document.getElementById('scatter3d-container')!,
    { pointSize: 4, opacity: 0.85 },
  );
  scatterView.setData({ x, y, z, labels });

  // Render legend
  const legendEl = document.getElementById('scatter3d-legend')!;
  const labelColors = scatterView.getLabelColors();
  for (const { label, color } of labelColors) {
    const item = document.createElement('span');
    item.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:#c0cade';
    item.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>${label}`;
    legendEl.appendChild(item);
  }

  // Toolbar is built into Scatter3DView — no manual controls needed

  // ── Volume ──
  const size = 64;
  const buf = new Uint8Array(size * size * size);
  const center = size / 2;
  for (let vz = 0; vz < size; vz++) {
    for (let vy = 0; vy < size; vy++) {
      for (let vx = 0; vx < size; vx++) {
        const dist = Math.sqrt((vx-center)**2 + (vy-center)**2 + (vz-center)**2);
        const val = Math.max(0, 255 * Math.exp(-dist * dist / (size * size * 0.05)));
        buf[vz * size * size + vy * size + vx] = val;
      }
    }
  }

  const volumeView = new VolumeView(document.getElementById('volume-container')!, { renderMode: 'mip' });
  volumeView.setData({ buffer: buf.buffer, width: size, height: size, depth: size, dtype: 'uint8' });

  document.getElementById('vol-mode')!.addEventListener('change', (e) => {
    volumeView.setRenderMode((e.target as HTMLSelectElement).value as 'mip' | 'xray' | 'iso');
  });

  // ── Mesh ──
  const meshView = new MeshView(document.getElementById('mesh-container')!, { lighting: true });
  const vertices: number[] = [], indices: number[] = [];
  const latDivs = 32, lonDivs = 32;
  for (let i = 0; i <= latDivs; i++) {
    const phi = Math.PI * i / latDivs;
    for (let j = 0; j <= lonDivs; j++) {
      const theta = 2 * Math.PI * j / lonDivs;
      vertices.push(Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta));
    }
  }
  for (let i = 0; i < latDivs; i++) {
    for (let j = 0; j < lonDivs; j++) {
      const a = i*(lonDivs+1)+j, b = a+lonDivs+1;
      indices.push(a, b, a+1, b, b+1, a+1);
    }
  }
  meshView.setData({ vertices: new Float32Array(vertices), indices: new Uint32Array(indices) });

  document.getElementById('wireframe-toggle')!.addEventListener('change', (e) => {
    meshView.setWireframe((e.target as HTMLInputElement).checked);
  });
}
