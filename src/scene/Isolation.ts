import type * as THREE from 'three';

/**
 * Isolate-mode visibility manager. Snapshots the visibility flag of every
 * descendant of the editor's modelRoot when isolation begins, then sets only
 * the isolated objects (plus their ancestors and descendants) visible.
 * `exit()` restores the snapshot exactly.
 *
 * This deliberately ignores objects added to modelRoot AFTER isolate() begins
 * — they keep whatever visibility they were created with until exit() runs,
 * at which point they aren't in the snapshot and so aren't restored. That's
 * the intentional, easy-to-reason-about behavior; callers should exit
 * isolation before scene mutations.
 */
export class Isolation {
  private snapshot: Map<THREE.Object3D, boolean> | null = null;

  isActive(): boolean {
    return this.snapshot !== null;
  }

  enter(targets: ReadonlyArray<THREE.Object3D>, modelRoot: THREE.Object3D): void {
    if (targets.length === 0) return;

    if (!this.snapshot) {
      const snap = new Map<THREE.Object3D, boolean>();
      modelRoot.traverse((o) => snap.set(o, o.visible));
      this.snapshot = snap;
    }

    modelRoot.traverse((o) => { o.visible = false; });

    for (const target of targets) {
      // Walk ancestors up to (and including) modelRoot so the chain renders.
      let cur: THREE.Object3D | null = target;
      while (cur && cur !== modelRoot.parent) {
        cur.visible = true;
        cur = cur.parent;
      }
      // Show all descendants of the isolated target.
      target.traverse((o) => { o.visible = true; });
    }
  }

  exit(modelRoot: THREE.Object3D): void {
    if (!this.snapshot) return;
    const snap = this.snapshot;
    modelRoot.traverse((o) => {
      const v = snap.get(o);
      if (v !== undefined) o.visible = v;
    });
    this.snapshot = null;
  }
}
