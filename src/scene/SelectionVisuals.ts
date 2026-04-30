import * as THREE from 'three';

import type { Selection } from './Selection.js';

const PRIMARY_COLOR = 0x4a82ff;
const SECONDARY_COLOR = 0x6a90c0;

/**
 * Draws a BoxHelper for each selected object so the user can see what is
 * selected without touching object materials. The primary selection is a
 * brighter color.
 */
export class SelectionVisuals {
  private readonly group = new THREE.Group();
  private helpers: Array<{ obj: THREE.Object3D; helper: THREE.BoxHelper }> = [];
  private readonly disposers: Array<() => void> = [];

  constructor(scene: THREE.Scene, private readonly selection: Selection) {
    this.group.name = 'editor:selectionHelpers';
    scene.add(this.group);
    this.disposers.push(selection.on(() => this.rebuild()));
  }

  /** Call when transform values change so wireframes follow the geometry. */
  refresh(): void {
    for (const { helper } of this.helpers) helper.update();
  }

  dispose(): void {
    for (const fn of this.disposers) fn();
    this.clear();
    this.group.parent?.remove(this.group);
  }

  private clear() {
    for (const { helper } of this.helpers) {
      this.group.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this.helpers = [];
  }

  private rebuild() {
    this.clear();
    const primary = this.selection.primary();
    for (const obj of this.selection.all()) {
      const color = obj === primary ? PRIMARY_COLOR : SECONDARY_COLOR;
      const helper = new THREE.BoxHelper(obj, color);
      // Selection helpers shouldn't intercept rays.
      helper.raycast = () => undefined;
      this.helpers.push({ obj, helper });
      this.group.add(helper);
    }
  }
}
