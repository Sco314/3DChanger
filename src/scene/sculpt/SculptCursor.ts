import * as THREE from 'three';

/**
 * Hover ring drawn at the current brush position, oriented to the surface
 * normal. Sized to the brush radius. Hidden when the cursor isn't over a
 * sculptable surface.
 */
export class SculptCursor {
  private readonly group: THREE.Group;
  private readonly ring: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = 'editor:sculptCursor';
    this.group.visible = false;

    const geom = new THREE.RingGeometry(0.97, 1.0, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4a82ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(geom, mat);
    this.ring.raycast = () => undefined;
    this.ring.renderOrder = 999;

    this.group.add(this.ring);
    scene.add(this.group);
  }

  setVisible(v: boolean): void { this.group.visible = v; }

  /**
   * Place the cursor at `worldPosition` oriented to face along
   * `worldNormal`, scaled to `worldRadius`.
   */
  set(worldPosition: THREE.Vector3, worldNormal: THREE.Vector3, worldRadius: number): void {
    this.group.position.copy(worldPosition);
    // Build a quaternion that rotates +Z to the surface normal.
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      worldNormal.clone().normalize(),
    );
    this.group.quaternion.copy(q);
    this.group.scale.setScalar(worldRadius);
    this.group.visible = true;
  }

  dispose(): void {
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.group.parent?.remove(this.group);
  }
}
