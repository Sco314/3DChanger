import type { Diagnostics } from './diagnose.js';

const ROWS: Array<[string, (d: Diagnostics) => string]> = [
  ['Vertices',       (d) => d.vertexCount.toLocaleString()],
  ['Triangles',      (d) => d.triangleCount.toLocaleString()],
  ['Objects',        (d) => d.objectCount.toLocaleString()],
  ['Materials',      (d) => d.materialCount.toLocaleString()],
  ['Textures',       (d) => d.textureCount.toLocaleString()],
  ['UVs',            (d) => yn(d.hasUVs)],
  ['Normals',        (d) => yn(d.hasNormals)],
  ['Vertex colors',  (d) => yn(d.hasVertexColors)],
  ['Animations',     (d) => yn(d.hasAnimations)],
  ['Skeletons',      (d) => yn(d.hasSkeletons)],
];

function yn(v: boolean): string { return v ? 'yes' : 'no'; }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  } as Record<string, string>)[c]!);
}

export class DiagnosticsPanel {
  constructor(private readonly body: HTMLElement) {}

  reset() {
    this.body.innerHTML = '<em>No model loaded.</em>';
  }

  render(d: Diagnostics) {
    const rows = ROWS.map(([k, get]) => {
      return `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(get(d))}</td></tr>`;
    }).join('');
    this.body.innerHTML = `<table>${rows}</table>`;
  }
}
