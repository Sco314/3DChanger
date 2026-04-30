import type * as THREE from 'three';

export type SelectionListener = (selection: Selection) => void;

/**
 * Object-level selection model. Order of insertion is preserved; the most
 * recently added object is the "primary" (used as the gizmo pivot).
 */
export class Selection {
  private readonly members = new Set<THREE.Object3D>();
  private readonly order: THREE.Object3D[] = [];
  private readonly listeners = new Set<SelectionListener>();

  on(fn: SelectionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this);
  }

  size(): number { return this.members.size; }
  has(obj: THREE.Object3D): boolean { return this.members.has(obj); }
  all(): readonly THREE.Object3D[] { return this.order; }

  /** Last-added selected object, or undefined if empty. */
  primary(): THREE.Object3D | undefined {
    return this.order.length ? this.order[this.order.length - 1] : undefined;
  }

  set(obj: THREE.Object3D | null) {
    this.order.length = 0;
    this.members.clear();
    if (obj) {
      this.order.push(obj);
      this.members.add(obj);
    }
    this.emit();
  }

  add(obj: THREE.Object3D) {
    if (this.members.has(obj)) return;
    this.members.add(obj);
    this.order.push(obj);
    this.emit();
  }

  remove(obj: THREE.Object3D) {
    if (!this.members.has(obj)) return;
    this.members.delete(obj);
    const i = this.order.indexOf(obj);
    if (i >= 0) this.order.splice(i, 1);
    this.emit();
  }

  toggle(obj: THREE.Object3D) {
    if (this.members.has(obj)) this.remove(obj);
    else this.add(obj);
  }

  clear() {
    if (!this.members.size) return;
    this.members.clear();
    this.order.length = 0;
    this.emit();
  }
}
