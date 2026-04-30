# 3DChanger — Technical Design Document

Status: draft 1, design pass only. No code changes yet.
Branch: `claude/3d-model-editor-XoVF1`

## 1. Goal

Build a faithful, web-based 3D model editor that:

- loads OBJ/MTL + textures, GLB/glTF, STL, and (eventually) 3DS, FBX, DAE, PLY, 3MF, STEP, IGES, IFC, etc.
- preserves geometry, hard edges, UVs, materials, textures, object hierarchy, and scene structure on import.
- never silently remeshes / welds / triangulates / recomputes normals on import.
- offers scene-tree object editing first, then mesh-component editing, then sculpting as a clearly-flagged destructive mode.
- exports primarily as GLB/glTF, with OBJ/MTL and STL as secondary outputs.

This document compares two foundations and recommends the path forward.

---

## 2. Option A — Continue inside SculptGL

### What SculptGL is

SculptGL ([github.com/stephomi/sculptgl](https://github.com/stephomi/sculptgl)) is an in-browser sculpting app. As of Jan 2026 the upstream repo is **archived** ("DEVELOPMENT STOPPED — I'm now working on Nomad Sculpt instead"). It has its own custom WebGL renderer (not three.js) and its own mesh data structures optimized for dynamic-topology sculpting.

Top-level `src/` layout:

```
src/
  drawables/      custom WebGL drawables
  editing/        Gizmo, HoleFilling, MarchingCubes, Remesh,
                  Reversion, SculptManager, Subdivision, SurfaceNets
  editing/tools/  Brush, Crease, Drag, Flatten, Inflate, LocalScale,
                  Masking, Move, Paint, Pinch, SculptBase, Smooth,
                  Tools, Transform, Twist
  files/          format readers/writers
  gui/            UI
  math3d/         math
  mesh/           Mesh, MeshDynamic, vertex/face buffers
  misc/           utilities
  render/         custom renderer
  states/         undo/redo
  worker/         remesh / decimation workers
  Scene.js
  SculptGL.js
```

### Why it is a poor *foundation* for this project

1. **Archived upstream.** No new fixes will land. Maintenance is on us.
2. **Custom renderer, not three.js.** Every new format we want to load (GLTF + Draco/KTX2, FBX, STEP via OCCT) requires bridging into a renderer that was not designed for arbitrary scene graphs.
3. **Mesh model is sculpt-shaped.** SculptGL's mesh stores per-vertex data tuned for dynamic topology / voxel remesh. UVs and multi-material assignments are second-class. Many operations (DynTopo, voxel remesh, subdivision) **destroy UVs**, which directly conflicts with goal #3 (preserve textures).
4. **No real scene hierarchy.** SculptGL is a single-mesh-at-a-time tool. Multi-object scenes from GLTF/OBJ would have to be flattened to fit, defeating goal #1.
5. **Limited import/export breadth.** OBJ/PLY/STL/SGL only. No GLTF, FBX, STEP, IFC, etc.
6. **No glTF-PBR material model.** Adding metallic-roughness + normal/occlusion/emissive maps + KTX2/Draco would mean rewriting the material and renderer layers.

### What SculptGL *is* good for

It is an excellent **reference implementation of brush behavior** and topology operators. The brush math (per-vertex falloff, symmetry, mask, smooth post-pass, undo states) is well-isolated and portable.

---

## 3. Option B — New three.js / Online3DViewer-style editor (RECOMMENDED)

### Foundation

- **Renderer + scene graph:** [three.js](https://threejs.org).
- **Format coverage:** [Online3DViewer](https://github.com/kovacsv/Online3DViewer) (npm `online-3d-viewer`) as the import/export reference. It already wraps three.js and supports import of `3dm, 3ds, 3mf, amf, bim, brep, dae, fbx, fcstd, gltf, ifc, iges, step, stl, obj, off, ply, wrl` and export of `3dm, bim, gltf, obj, off, stl, ply`. It already integrates `three.js, fflate, draco, rhino3dm, web-ifc, occt-import-js`.
- **glTF cleanup/optimization:** [`@gltf-transform/core`](https://github.com/donmccurdy/glTF-Transform) + `@gltf-transform/functions` (dedup, prune, draco, meshopt, KTX2 textures, validation).
- **Sculpt brushes (later):** ported and rewritten on top of three.js `BufferGeometry`, behavior referenced from SculptGL's `src/editing/tools/*.js`.

### Online3DViewer engine layout (the part we care about)

```
source/engine/
  core/         engine glue
  import/       importerbase.js, importer.js, importerfiles.js,
                importerutils.js,
                importergltf.js, importerobj.js, importerstl.js,
                importerply.js, importeroff.js, importer3ds.js,
                importer3dm.js, importersvg.js, importerifc.js,
                importerbim.js, importerfcstd.js, importerocct.js,
                importerthree.js
  export/       exporterbase.js, exporter.js, exportermodel.js,
                exportergltf.js, exporterobj.js, exporterstl.js,
                exporterply.js, exporteroff.js, exporter3dm.js,
                exporterbim.js
  geometry/     geom utils
  io/           buffer / file IO
  model/        Model, Node, Mesh, Material, Texture (format-neutral
                intermediate representation)
  parameters/   import/export options
  threejs/      three.js conversion layer
  viewer/       embeddable viewer
  main.js
```

The crucial design point: O3DV maintains its own **format-neutral `Model`** between importer and three.js conversion. That intermediate is exactly what we want for "preserve source data first" — it lets us keep raw geometry, hard edges, materials, and textures unmolested, and only convert to `THREE.Object3D` for display.

### Why Option B fits the requirements

| Requirement | How B satisfies it |
|---|---|
| Faithful import of OBJ/MTL, GLB/glTF, STL | `THREE.GLTFLoader`, `OBJLoader+MTLLoader`, `STLLoader` directly; O3DV importers for everything else |
| Preserve hierarchy, UVs, materials, textures | `GLTFLoader` returns a `THREE.Group` scene with materials + textures + skins + animations intact; OBJ keeps multi-object groups and material assignments via MTL |
| Scene tree, object selection, hide/lock/duplicate | three.js `Object3D` already has the tree; we just bind UI to it |
| Mesh component selection (face/edge/vertex/island/by-material) | Operate on `BufferGeometry` index buffer with three.js `Raycaster` for picking |
| Material editing (PBR) | `MeshStandardMaterial` is glTF's PBR model 1:1; no impedance mismatch |
| Sculpt later | Drop SculptGL-style brushes onto `BufferGeometry.attributes.position` |
| GLB primary export | three.js `GLTFExporter` + `@gltf-transform/core` validation pass |
| OBJ/STL export | three.js `OBJExporter`, `STLExporter`, or O3DV's exporters |

### Risks and mitigations

- **Bundle size.** Full O3DV pulls in occt-import-js, web-ifc, rhino3dm. Mitigation: lazy-load each importer only when its file extension appears.
- **GLTFExporter is not perfectly lossless.** Mitigation: post-process with `@gltf-transform/core` (dedup, prune, validate); keep an "export raw" path that bypasses the optimizer.
- **OBJ → GLB round-trip** can lose smoothing groups. Mitigation: don't auto-recompute normals on import; preserve as-imported normals; only smooth on explicit user request.

---

## 4. Recommendation

**Go with Option B.** Reasons:

1. SculptGL upstream is dead and its data model fights goal #1 (preserve UVs / textures / hierarchy).
2. three.js + Online3DViewer already solve the import/export breadth problem; we'd otherwise reinvent it.
3. glTF as the internal preferred format aligns 1:1 with `MeshStandardMaterial` and `GLTFLoader`/`GLTFExporter`.
4. SculptGL's brush logic is portable to three.js geometry buffers without dragging the rest of SculptGL with it.

There is no strong technical reason to stay inside SculptGL.

---

## 5. What to borrow from SculptGL (brushes only)

Port the math/behavior of these files; **do not** port the renderer, mesh class, or DynTopo/remesh paths.

| Tool | SculptGL file | Notes for port |
|---|---|---|
| Common brush base | `src/editing/tools/SculptBase.js` | Falloff curve, radius, strength, symmetry, mask read |
| Generic brush (push along normal) | `src/editing/tools/Brush.js` | Maps to "Standard" brush |
| Grab / move verts with cursor | `src/editing/tools/Move.js` | Uses screen-space drag delta |
| Drag (sticky stroke) | `src/editing/tools/Drag.js` | |
| Inflate along normal | `src/editing/tools/Inflate.js` | |
| Smooth (Laplacian) | `src/editing/tools/Smooth.js` | Used both as a brush and as a post-pass after others |
| Flatten to plane | `src/editing/tools/Flatten.js` | Plane fit from selection |
| Pinch toward stroke center | `src/editing/tools/Pinch.js` | |
| Crease (sharp inward) | `src/editing/tools/Crease.js` | |
| Twist around stroke axis | `src/editing/tools/Twist.js` | |
| Local scale | `src/editing/tools/LocalScale.js` | |
| Mask paint / protect | `src/editing/tools/Masking.js` | Per-vertex mask scalar; multiply into all brush deltas |
| Vertex paint | `src/editing/tools/Paint.js` | Writes vertex colors |
| Tool registry | `src/editing/tools/Tools.js` | Pattern only |

Explicitly **do not borrow**:

- `src/editing/Remesh.js`, `MarchingCubes.js`, `SurfaceNets.js`, `Subdivision.js` — they discard UVs.
- `src/mesh/*` — replace with three.js `BufferGeometry`.
- `src/render/*`, `src/drawables/*` — replace with three.js renderer.
- `src/states/*` — replace with our own undo system that snapshots `position`/`normal`/`color` attributes.

---

## 6. First prototype — the loading/export path to build

The first vertical slice should prove "import → diagnostics → export round-trips faithfully" before any selection/edit tools.

### 6.1 Imports

1. **GLB/glTF** — `THREE.GLTFLoader` with `DRACOLoader` and `KTX2Loader` configured. Returns a `gltf.scene` (`THREE.Group`). Preserves hierarchy, materials (`MeshStandardMaterial` + maps), UVs, normals, vertex colors, morph targets, skins, animations.
2. **OBJ + MTL + textures** — `THREE.OBJLoader` with `MTLLoader.preload()`. Multi-object OBJ becomes a `Group` of `Mesh` children. Materials become `MeshPhongMaterial` (we'll convert to `MeshStandardMaterial` on a flag, off by default to stay faithful).
3. **STL** — `THREE.STLLoader` → single `BufferGeometry` (no materials, no UVs, normals only).

All three loaders ship with three.js examples (`three/examples/jsm/loaders/...`). No external dependency for the first slice.

### 6.2 Diagnostics panel

After import, walk the loaded `THREE.Object3D` tree once and report:

- vertex count = sum of `geometry.attributes.position.count`
- face/triangle count = sum of `geometry.index ? index.count/3 : position.count/3`
- object count = number of `Mesh` descendants
- material count = unique `material.uuid` set size
- texture count = unique `texture.uuid` set size across all material map slots
- UVs present = any `geometry.attributes.uv`?
- normals present = any `geometry.attributes.normal`?
- vertex colors present = any `geometry.attributes.color`?
- animations present = `gltf.animations.length > 0`
- skeletons/bones present = any `SkinnedMesh` descendant?

This is a single read-only traversal. No mutations.

### 6.3 Exports

1. **GLB (primary)** — `THREE.GLTFExporter` with `binary: true`. Pipe the resulting ArrayBuffer through `@gltf-transform/core` `read → prune → dedup → validate → write` for cleanup. Keep a "raw export" toggle that skips the optimizer.
2. **glTF folder/zip** — same exporter with `binary: false`, then `fflate` to zip the JSON + `.bin` + textures.
3. **OBJ + MTL** — `OBJExporter` (geometry only out of the box; we'll add a small MTL writer + texture copy step).
4. **STL** — `STLExporter` (binary).

### 6.4 Suggested initial repo skeleton

```
3DChanger/
  index.html
  package.json
  vite.config.js
  src/
    app/
      main.ts                   bootstraps renderer, scene, UI
      Editor.ts                 owns scene, selection, undo
    io/
      import/
        loadGLTF.ts             wraps GLTFLoader (+ Draco, KTX2)
        loadOBJ.ts              wraps OBJLoader + MTLLoader
        loadSTL.ts              wraps STLLoader
        index.ts                dispatch by extension
      export/
        exportGLB.ts            GLTFExporter + gltf-transform pass
        exportGLTF.ts
        exportOBJ.ts
        exportSTL.ts
    diagnostics/
      diagnose.ts               traversal -> stats object
      DiagnosticsPanel.ts       UI binding
    scene/
      SceneTree.ts              UI for Object3D hierarchy
      Selection.ts              object-level selection model
    sculpt/                     (later, port from SculptGL)
      brushes/
        SculptBase.ts
        Standard.ts
        Smooth.ts
        ...
  vendor/
    sculptgl-reference/         read-only mirror of the brush files we
                                ported from, kept for diffing
  DESIGN.md                     this file
  README.md
```

### 6.5 Dependencies for the first slice

```json
{
  "dependencies": {
    "three": "^0.16x",
    "@gltf-transform/core": "^4.x",
    "@gltf-transform/functions": "^4.x",
    "fflate": "^0.8.x"
  },
  "devDependencies": {
    "vite": "^5.x",
    "typescript": "^5.x"
  }
}
```

`online-3d-viewer` itself is **not** added in slice 1. We add it in slice 2 when we extend coverage to FBX / STEP / IFC / 3DS / PLY / OFF, either by depending on the npm package or by porting individual `importerXXX.js` files behind our own dispatcher. This keeps the initial bundle small and the data path fully under our control.

---

## 7. Execution order (post-design)

1. **Slice 1 — Import/diagnose/export round-trip** (sections 6.1–6.3). No editing.
2. **Slice 2 — Scene tree + object-level ops** (select, hide, isolate, lock, duplicate, transform).
3. **Slice 3 — Mesh component selection** (face/edge/vertex/island/by-material/by-normal-angle).
4. **Slice 4 — Edit actions** (delete faces, separate, detach by material, fill holes, recompute normals on request).
5. **Slice 5 — Material editing** on `MeshStandardMaterial`.
6. **Slice 6 — Extended format coverage** via Online3DViewer importers/exporters.
7. **Slice 7 — Sculpt mode** as an opt-in, with a UV-preservation warning before any destructive operation. Brushes ported from SculptGL `src/editing/tools/*` per section 5.

Each slice is shippable on its own and never breaks the "preserve source data first" invariant.

---

## 8. Status

| Slice | Scope | Status |
|---|---|---|
| 1 | Vite + TS scaffold; GLTF/OBJ+MTL/STL import; diagnostics traversal; GLB / glTF-zip / OBJ / STL export | **Done** (merged) |
| 2 | Scene tree, object selection, hide/show, isolate, lock, duplicate, transform gizmo (move/rotate/scale) | **Done** (PR #3) |
| 3 | Mesh component selection: face / edge / vertex modes; actions: connected, by material, by object, by normal angle | **Done** (PR #4) |
| 4 | Edit actions: delete faces, keep / delete unselected, separate, detach by material, detach by component, fill boundary loops, recompute normals on request | **Done** (this PR) |
| 5 | Material editing on `MeshStandardMaterial`: assign new material, change base color / roughness / metalness, preserve UVs unless user opts in to a destructive op | Not started |
| 6 | Extended format coverage via Online3DViewer importers/exporters (FBX, STEP, IFC, 3DS, PLY, OFF, …) | Not started |
| 7 | Sculpt mode — opt-in, UV-preservation warning, brushes ported from SculptGL `src/editing/tools/*` (Brush, Smooth, Inflate, Flatten, Pinch, Crease, Move, Drag, Twist, Masking, Paint, LocalScale) | Not started |

