import type { SculptMode } from '../scene/sculpt/SculptMode.js';
import type { BrushKind } from '../scene/sculpt/types.js';

const BRUSH_LABELS: Array<[BrushKind, string]> = [
  ['inflate', 'Inflate'],
  ['smooth',  'Smooth'],
  ['flatten', 'Flatten'],
  ['pinch',   'Pinch'],
  ['grab',    'Grab'],
  ['mask',    'Mask'],
];

/**
 * Sculpt mode UI: brush picker, radius / strength sliders, mask toggles,
 * and a one-time UV-preservation warning shown the first time the user
 * enters sculpt mode in a session.
 */
export class SculptPanel {
  private warningShown = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly sculpt: SculptMode,
  ) {
    sculpt.on(() => this.render());
    this.render();
  }

  showWarningOnce(): void {
    if (this.warningShown) return;
    this.warningShown = true;
    this.render();
  }

  private render(): void {
    if (!this.sculpt.enabled) {
      this.host.innerHTML = '<em class="empty">Switch Mode to Sculpt to enable brushes.</em>';
      return;
    }
    this.host.innerHTML = '';

    if (!this.warningShown) {
      const warn = document.createElement('div');
      warn.className = 'sculpt-warning';
      warn.innerHTML =
        '<strong>Heads up:</strong> Sculpt brushes move vertex positions only — UVs stay attached, ' +
        'but heavy deformation can stretch UV-mapped textures noticeably. Export a copy of the model ' +
        'before extensive sculpting.';
      const dismiss = document.createElement('button');
      dismiss.className = 'btn';
      dismiss.textContent = 'Got it';
      dismiss.addEventListener('click', () => { this.warningShown = true; this.render(); });
      warn.appendChild(dismiss);
      this.host.appendChild(warn);
    }

    const brushRow = document.createElement('div');
    brushRow.className = 'brush-row';
    const active = this.sculpt.getBrush();
    for (const [kind, label] of BRUSH_LABELS) {
      const btn = document.createElement('button');
      btn.className = 'btn brush-btn' + (kind === active ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => this.sculpt.setBrush(kind));
      brushRow.appendChild(btn);
    }
    this.host.appendChild(brushRow);

    this.host.appendChild(makeSliderRow(
      'Radius',
      this.sculpt.params.radius,
      (v) => this.sculpt.setRadius(v),
      0.001, 5, 0.001,
    ));
    this.host.appendChild(makeSliderRow(
      'Strength',
      this.sculpt.params.strength,
      (v) => this.sculpt.setStrength(v),
      0, 1, 0.01,
    ));

    if (active === 'mask') {
      this.host.appendChild(makeCheckboxRow(
        'Erase mask (instead of paint)',
        false,
        (v) => this.sculpt.setInvertMask(v),
      ));
      const clr = document.createElement('button');
      clr.className = 'btn';
      clr.textContent = 'Clear mask';
      clr.addEventListener('click', () => this.sculpt.clearMask());
      this.host.appendChild(clr);
    }

    this.host.appendChild(makeCheckboxRow(
      'Recompute normals after stroke',
      this.sculpt.recomputeNormalsAfterStroke,
      (v) => { this.sculpt.recomputeNormalsAfterStroke = v; },
    ));
  }
}

function makeSliderRow(
  label: string,
  initial: number,
  onChange: (v: number) => void,
  min: number, max: number, step: number,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sculpt-row';
  const lab = document.createElement('span');
  lab.className = 'sculpt-label';
  lab.textContent = label;
  row.appendChild(lab);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(initial);
  const num = document.createElement('span');
  num.className = 'sculpt-num';
  num.textContent = formatNumber(initial);
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    num.textContent = formatNumber(v);
    onChange(v);
  });
  row.appendChild(slider);
  row.appendChild(num);
  return row;
}

function makeCheckboxRow(label: string, initial: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'sculpt-row sculpt-checkbox';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = initial;
  cb.addEventListener('change', () => onChange(cb.checked));
  row.appendChild(cb);
  const lab = document.createElement('span');
  lab.textContent = ` ${label}`;
  row.appendChild(lab);
  return row;
}

function formatNumber(v: number): string {
  if (Math.abs(v) < 0.01) return v.toExponential(1);
  return v.toFixed(v < 1 ? 3 : 2);
}
