import * as THREE from 'three';

export interface Diagnostics {
  vertexCount: number;
  triangleCount: number;
  objectCount: number;
  materialCount: number;
  textureCount: number;
  hasUVs: boolean;
  hasNormals: boolean;
  hasVertexColors: boolean;
  hasAnimations: boolean;
  hasSkeletons: boolean;
}

const TEXTURE_MAP_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'lightMap',
  'specularMap',
  'envMap',
  'gradientMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'specularIntensityMap',
  'specularColorMap',
] as const;

/**
 * Read-only traversal. Counts geometry/objects/materials/textures and detects
 * the presence of various attributes. Does not mutate the scene.
 */
export function diagnose(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[] = [],
): Diagnostics {
  let vertexCount = 0;
  let triangleCount = 0;
  let objectCount = 0;
  let hasUVs = false;
  let hasNormals = false;
  let hasVertexColors = false;
  let hasSkeletons = false;

  const materials = new Set<string>();
  const textures = new Set<string>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;

    objectCount++;
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) hasSkeletons = true;

    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    if (g) {
      const pos = g.attributes.position;
      if (pos) vertexCount += pos.count;
      if (g.index) triangleCount += g.index.count / 3;
      else if (pos) triangleCount += pos.count / 3;
      if (g.attributes.uv) hasUVs = true;
      if (g.attributes.normal) hasNormals = true;
      if (g.attributes.color) hasVertexColors = true;
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      materials.add(m.uuid);
      const rec = m as unknown as Record<string, unknown>;
      for (const key of TEXTURE_MAP_KEYS) {
        const t = rec[key] as THREE.Texture | null | undefined;
        if (t && (t as unknown as { isTexture?: boolean }).isTexture) {
          textures.add(t.uuid);
        }
      }
    }
  });

  return {
    vertexCount,
    triangleCount: Math.round(triangleCount),
    objectCount,
    materialCount: materials.size,
    textureCount: textures.size,
    hasUVs,
    hasNormals,
    hasVertexColors,
    hasAnimations: animations.length > 0,
    hasSkeletons,
  };
}
