import * as THREE from 'three';

/**
 * Material editor panel.
 *
 * Binds to the editor's primary selected Mesh and exposes:
 *   - a per-slot list (when the mesh has an array of materials)
 *   - color, roughness, metalness, emissive color + intensity controls that
 *     write live to the active slot's MeshStandardMaterial
 *   - Make Unique (clone material instances so edits don't bleed across meshes)
 *   - Add Slot For Selected Faces (only enabled with a face component selection)
 *
 * The panel is render-on-demand: every selection change or external mutation
 * calls render(); inputs write back via direct material property edits.
 */

export interface MaterialPanelHooks {
  /** Get the Mesh whose material the panel currently displays, or null. */
  getActiveMesh: () => THREE.Mesh | null;
  /** True if there is a non-empty face component selection. */
  hasFaceSelection: () => boolean;
  /** Clone all materials on the primary mesh; returns true if anything happened. */
  onMakeUnique: () => boolean;
  /** Append a new material slot to the active mesh covering selected faces. */
  onAddSlotForFaces: () => boolean;
}

export class MaterialPanel {
  private activeSlot = 0;
  /** Last mesh we rendered for, so we can reset slot index on switch. */
  private lastMesh: THREE.Mesh | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: MaterialPanelHooks,
  ) {
    this.render();
  }

  render(): void {
    const mesh = this.hooks.getActiveMesh();
    if (!mesh) {
      this.host.innerHTML = '<em class="empty">No mesh selected.</em>';
      this.lastMesh = null;
      return;
    }

    if (mesh !== this.lastMesh) {
      this.activeSlot = 0;
      this.lastMesh = mesh;
    }

    this.host.innerHTML = '';

    const matsArr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slot = Math.min(this.activeSlot, matsArr.length - 1);
    this.activeSlot = slot;

    if (matsArr.length > 1) {
      this.host.appendChild(this.renderSlotList(matsArr));
    }

    const mat = matsArr[slot];
    if (!mat) {
      const note = document.createElement('em');
      note.className = 'empty';
      note.textContent = 'Slot has no material.';
      this.host.appendChild(note);
    } else {
      this.host.appendChild(this.renderControlsFor(mat));
    }

    this.host.appendChild(this.renderActions());
  }

  private renderSlotList(mats: THREE.Material[]): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'mat-slots';
    for (let i = 0; i < mats.length; i++) {
      const li = document.createElement('li');
      li.className = 'mat-slot' + (i === this.activeSlot ? ' active' : '');
      li.textContent = `[${i}] ${mats[i]!.name || mats[i]!.type}`;
      li.addEventListener('click', () => {
        this.activeSlot = i;
        this.render();
      });
      list.appendChild(li);
    }
    return list;
  }

  private renderControlsFor(mat: THREE.Material): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mat-controls';

    const std = mat as THREE.MeshStandardMaterial;
    const isPBR = std.isMeshStandardMaterial === true;

    if (!isPBR) {
      const note = document.createElement('em');
      note.className = 'empty';
      note.textContent = `Slot is ${mat.type}; only color is editable. Use "Make Unique" then "Add Slot For Selected Faces" to assign a fresh PBR material.`;
      wrap.appendChild(note);
    }

    // Base color (always editable; works for any material with a color).
    const colorRow = makeRow('Base color');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = colorOfMat(mat);
    colorInput.addEventListener('input', () => {
      const c = colorInput.value;
      const target = mat as unknown as { color?: THREE.Color };
      if (target.color) target.color.set(c);
    });
    colorRow.appendChild(colorInput);
    wrap.appendChild(colorRow);

    if (!isPBR) return wrap;

    // Roughness
    wrap.appendChild(makeSliderRow(
      'Roughness',
      std.roughness ?? 1,
      (v) => { std.roughness = v; },
    ));

    // Metalness
    wrap.appendChild(makeSliderRow(
      'Metalness',
      std.metalness ?? 0,
      (v) => { std.metalness = v; },
    ));

    // Emissive color + intensity
    const emRow = makeRow('Emissive');
    const emColor = document.createElement('input');
    emColor.type = 'color';
    emColor.value = '#' + std.emissive.getHexString();
    emColor.addEventListener('input', () => std.emissive.set(emColor.value));
    emRow.appendChild(emColor);
    wrap.appendChild(emRow);

    wrap.appendChild(makeSliderRow(
      'Emissive intensity',
      std.emissiveIntensity ?? 0,
      (v) => { std.emissiveIntensity = v; },
      0,
      4,
    ));

    return wrap;
  }

  private renderActions(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mat-actions';

    const uniqueBtn = document.createElement('button');
    uniqueBtn.className = 'btn';
    uniqueBtn.textContent = 'Make Unique';
    uniqueBtn.title = 'Clone material instances so edits do not affect other meshes';
    uniqueBtn.addEventListener('click', () => {
      if (this.hooks.onMakeUnique()) this.render();
    });
    row.appendChild(uniqueBtn);

    const addSlotBtn = document.createElement('button');
    addSlotBtn.className = 'btn';
    addSlotBtn.textContent = 'Add Slot For Selected Faces';
    addSlotBtn.title = 'Append a new material slot covering the face selection';
    addSlotBtn.disabled = !this.hooks.hasFaceSelection();
    addSlotBtn.addEventListener('click', () => {
      if (this.hooks.onAddSlotForFaces()) {
        // Switch focus to the freshly added (last) slot.
        const mesh = this.hooks.getActiveMesh();
        if (mesh) {
          const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          this.activeSlot = arr.length - 1;
        }
        this.render();
      }
    });
    row.appendChild(addSlotBtn);

    return row;
  }
}

function makeRow(label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mat-row';
  const lab = document.createElement('span');
  lab.className = 'mat-label';
  lab.textContent = label;
  row.appendChild(lab);
  return row;
}

function makeSliderRow(
  label: string,
  initial: number,
  onChange: (v: number) => void,
  min = 0,
  max = 1,
): HTMLElement {
  const row = makeRow(label);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = '0.01';
  slider.value = String(initial);
  const num = document.createElement('span');
  num.className = 'mat-num';
  num.textContent = initial.toFixed(2);
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    num.textContent = v.toFixed(2);
    onChange(v);
  });
  row.appendChild(slider);
  row.appendChild(num);
  return row;
}

function colorOfMat(mat: THREE.Material): string {
  const c = (mat as unknown as { color?: THREE.Color }).color;
  return c ? '#' + c.getHexString() : '#cccccc';
}
