import type * as THREE from 'three';

import { Editor } from './Editor.js';
import { importFiles } from '../io/import/index.js';
import { diagnose } from '../diagnostics/diagnose.js';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel.js';
import { exportGLB } from '../io/export/exportGLB.js';
import { exportGLTFZip } from '../io/export/exportGLTF.js';
import { exportOBJ } from '../io/export/exportOBJ.js';
import { exportSTL } from '../io/export/exportSTL.js';
import { SceneTree } from '../scene/SceneTree.js';
import { pickObject } from '../scene/picking.js';
import type { TransformMode } from '../scene/TransformGizmo.js';
import { pickComponent } from '../scene/components/picking.js';
import type { ComponentMode } from '../scene/components/types.js';
import { MaterialPanel } from '../ui/MaterialPanel.js';
import { SculptPanel } from '../ui/SculptPanel.js';
import { setBusy, showToast } from '../ui/feedback.js';

const app = document.getElementById('app')!;
const viewport = document.getElementById('viewport')!;
const editor = new Editor(viewport);

const panel = new DiagnosticsPanel(document.getElementById('diagnostics-body')!);
panel.reset();

const sceneTree = new SceneTree(
  document.getElementById('scene-tree')!,
  editor.modelRoot,
  editor.selection,
);
sceneTree.onToggleVisibility = (obj) => editor.toggleVisibility(obj);
sceneTree.onToggleLock = (obj) => editor.toggleLock(obj);
sceneTree.onSelectRow = (obj, e) => {
  if (e.shiftKey || e.metaKey || e.ctrlKey) editor.selection.toggle(obj);
  else editor.selection.set(obj);
};
editor.onTreeChanged(() => sceneTree.refresh());

// ---- Material panel ----

function activeMaterialMesh(): THREE.Mesh | null {
  const primary = editor.selection.primary();
  if (primary && (primary as THREE.Mesh).isMesh) return primary as THREE.Mesh;
  // Fall back to component-selection seed mesh.
  const seed = editor.componentSelection.getSeed();
  return seed?.mesh ?? null;
}

const materialPanel = new MaterialPanel(
  document.getElementById('material-body')!,
  {
    getActiveMesh: () => activeMaterialMesh(),
    hasFaceSelection: () => {
      for (const [, s] of editor.componentSelection.states_()) {
        if (s.faces.size > 0) return true;
      }
      return false;
    },
    onMakeUnique: () => editor.makeMaterialsUnique(),
    onAddSlotForFaces: () => editor.addSlotForSelectedFaces(),
  },
);
editor.selection.on(() => materialPanel.render());
editor.componentSelection.on(() => materialPanel.render());
editor.onTreeChanged(() => materialPanel.render());

// ---- Sculpt panel ----

const sculptPanelEl = document.getElementById('sculpt-panel') as HTMLElement;
const sculptPanel = new SculptPanel(
  document.getElementById('sculpt-body')!,
  editor.sculpt,
);
editor.sculpt.on(() => {
  sculptPanelEl.hidden = !editor.sculpt.enabled;
});

const exportButtons = {
  glb: document.getElementById('export-glb') as HTMLButtonElement,
  gltf: document.getElementById('export-gltf') as HTMLButtonElement,
  obj: document.getElementById('export-obj') as HTMLButtonElement,
  stl: document.getElementById('export-stl') as HTMLButtonElement,
};
const opButtons = {
  isolate: document.getElementById('op-isolate') as HTMLButtonElement,
  duplicate: document.getElementById('op-duplicate') as HTMLButtonElement,
};
const toolButtons: Record<'select' | TransformMode, HTMLButtonElement> = {
  select:    document.getElementById('tool-select') as HTMLButtonElement,
  translate: document.getElementById('tool-translate') as HTMLButtonElement,
  rotate:    document.getElementById('tool-rotate') as HTMLButtonElement,
  scale:     document.getElementById('tool-scale') as HTMLButtonElement,
};

type SelMode = 'object' | ComponentMode | 'sculpt';
const modeButtons: Record<SelMode, HTMLButtonElement> = {
  object: document.getElementById('mode-object') as HTMLButtonElement,
  face:   document.getElementById('mode-face')   as HTMLButtonElement,
  edge:   document.getElementById('mode-edge')   as HTMLButtonElement,
  vertex: document.getElementById('mode-vertex') as HTMLButtonElement,
  sculpt: document.getElementById('mode-sculpt') as HTMLButtonElement,
};

const componentBar = document.getElementById('component-actions') as HTMLDivElement;
const caButtons = {
  byObject:   document.getElementById('ca-by-object')   as HTMLButtonElement,
  byMaterial: document.getElementById('ca-by-material') as HTMLButtonElement,
  connected:  document.getElementById('ca-connected')   as HTMLButtonElement,
  byAngle:    document.getElementById('ca-by-angle')    as HTMLButtonElement,
  clear:      document.getElementById('ca-clear')       as HTMLButtonElement,
};
const caAngleInput = document.getElementById('ca-angle-deg') as HTMLInputElement;

const edButtons = {
  deleteFaces:   document.getElementById('ed-delete')             as HTMLButtonElement,
  keepFaces:     document.getElementById('ed-keep')               as HTMLButtonElement,
  separate:      document.getElementById('ed-separate')           as HTMLButtonElement,
  detachMat:     document.getElementById('ed-detach-mat')         as HTMLButtonElement,
  detachComp:    document.getElementById('ed-detach-comp')        as HTMLButtonElement,
  fillHoles:     document.getElementById('ed-fill-holes')         as HTMLButtonElement,
  recomputeNorm: document.getElementById('ed-recompute-normals')  as HTMLButtonElement,
};

let lastBaseName = 'model';

function setExportEnabled(on: boolean) {
  for (const b of Object.values(exportButtons)) b.disabled = !on;
}

function refreshOpButtons() {
  const hasSel = editor.selection.size() > 0;
  opButtons.duplicate.disabled = !hasSel;
  // Allow Isolate to toggle off (exit) even with empty selection.
  opButtons.isolate.disabled = !hasSel && !editor.isolation.isActive();
  opButtons.isolate.textContent = editor.isolation.isActive() ? 'Exit Isolate' : 'Isolate';
}
editor.selection.on(refreshOpButtons);
editor.onTreeChanged(refreshOpButtons);

// ---- Tool mode ----

type Tool = 'select' | TransformMode;

const gizmoHelper = editor.gizmo.controls.getHelper();

function setTool(tool: Tool) {
  for (const [k, btn] of Object.entries(toolButtons)) {
    btn.classList.toggle('active', k === tool);
  }
  if (tool === 'select') {
    editor.gizmo.controls.enabled = false;
    gizmoHelper.visible = false;
  } else {
    editor.gizmo.controls.enabled = true;
    gizmoHelper.visible = true;
    editor.gizmo.setMode(tool);
  }
}
setTool('select');

toolButtons.select.addEventListener('click', () => setTool('select'));
toolButtons.translate.addEventListener('click', () => setTool('translate'));
toolButtons.rotate.addEventListener('click', () => setTool('rotate'));
toolButtons.scale.addEventListener('click', () => setTool('scale'));

opButtons.isolate.addEventListener('click', () => {
  if (editor.isolation.isActive()) editor.exitIsolate();
  else editor.isolateSelection();
});
opButtons.duplicate.addEventListener('click', () => editor.duplicateSelection());

// ---- Selection mode ----

let selMode: SelMode = 'object';

function setMode(m: SelMode) {
  selMode = m;
  for (const [k, btn] of Object.entries(modeButtons)) {
    btn.classList.toggle('active', k === m);
  }
  componentBar.hidden = (m === 'object' || m === 'sculpt');
  if (m === 'face' || m === 'edge' || m === 'vertex') {
    editor.componentSelection.setMode(m);
  }
  editor.sculpt.setEnabled(m === 'sculpt');
  if (m === 'sculpt') sculptPanel.showWarningOnce();
  refreshComponentButtons();
}
setMode('object');

modeButtons.object.addEventListener('click', () => setMode('object'));
modeButtons.face.addEventListener('click',   () => setMode('face'));
modeButtons.edge.addEventListener('click',   () => setMode('edge'));
modeButtons.vertex.addEventListener('click', () => setMode('vertex'));
modeButtons.sculpt.addEventListener('click', () => setMode('sculpt'));

function refreshComponentButtons() {
  const seed = editor.componentSelection.getSeed();
  const hasSeed = seed !== null;
  const hasAny = editor.componentSelection.size() > 0;
  caButtons.byObject.disabled = !hasSeed;
  caButtons.byMaterial.disabled = !hasSeed;
  caButtons.connected.disabled = !hasSeed;
  caButtons.byAngle.disabled = !hasSeed;
  caButtons.clear.disabled = !hasAny;
}
editor.componentSelection.on(refreshComponentButtons);

caButtons.byObject.addEventListener('click', () => editor.componentSelection.selectByObject());
caButtons.byMaterial.addEventListener('click', () => editor.componentSelection.selectByMaterial(editor.modelRoot));
caButtons.connected.addEventListener('click', () => editor.componentSelection.selectConnected());
caButtons.byAngle.addEventListener('click', () => {
  const deg = Number(caAngleInput.value);
  editor.componentSelection.selectByNormalAngle(Number.isFinite(deg) ? deg : 30);
});
caButtons.clear.addEventListener('click', () => editor.componentSelection.clear());

// ---- Edit actions (Slice 4) ----

function hasFaceSelection(): boolean {
  for (const [, s] of editor.componentSelection.states_()) {
    if (s.faces.size > 0) return true;
  }
  return false;
}

function hasMeshObjectSelection(): boolean {
  for (const obj of editor.selection.all()) {
    if ((obj as THREE.Mesh).isMesh) return true;
  }
  return false;
}

function refreshEditButtons() {
  const faces = hasFaceSelection();
  const meshes = hasMeshObjectSelection();
  edButtons.deleteFaces.disabled = !faces;
  edButtons.keepFaces.disabled = !faces;
  edButtons.separate.disabled = !faces;
  edButtons.detachMat.disabled = !meshes;
  edButtons.detachComp.disabled = !meshes;
  edButtons.fillHoles.disabled = !meshes;
  edButtons.recomputeNorm.disabled = !meshes;
}
editor.selection.on(refreshEditButtons);
editor.componentSelection.on(refreshEditButtons);
editor.onTreeChanged(refreshEditButtons);
refreshEditButtons();

edButtons.deleteFaces.addEventListener('click',   () => editor.deleteSelectedFaces());
edButtons.keepFaces.addEventListener('click',     () => editor.keepSelectedFaces());
edButtons.separate.addEventListener('click',      () => editor.separateSelectedFaces());
edButtons.detachMat.addEventListener('click',     () => editor.detachByMaterial());
edButtons.detachComp.addEventListener('click',    () => editor.detachByComponent());
edButtons.fillHoles.addEventListener('click',     () => editor.fillHoles());
edButtons.recomputeNorm.addEventListener('click', () => editor.recomputeNormals());

// ---- Viewport picking ----

let gizmoOwnedPointer = false;
const canvas = editor.renderer.domElement;

canvas.addEventListener('pointerdown', () => {
  // If the gizmo is hovered or already dragging when the pointer goes down,
  // treat the click as gizmo-owned and skip our pick.
  gizmoOwnedPointer = editor.gizmo.hoveredAxis() !== null || editor.gizmo.isDragging();
});

canvas.addEventListener('click', (e) => {
  if (gizmoOwnedPointer) { gizmoOwnedPointer = false; return; }
  if (editor.gizmo.isDragging()) return;
  // In Sculpt mode, the canvas drives strokes — selection clicks are off.
  if (selMode === 'sculpt') return;

  const additive = e.shiftKey || e.metaKey || e.ctrlKey;

  if (selMode === 'object') {
    const hit = pickObject(e, canvas, editor.camera, editor.modelRoot);
    if (!hit) {
      if (!additive) editor.selection.clear();
      return;
    }
    if (additive) editor.selection.toggle(hit);
    else editor.selection.set(hit);
    return;
  }

  // Component modes (face / edge / vertex).
  const cHit = pickComponent(e, canvas, editor.camera, editor.modelRoot);
  if (!cHit) {
    if (!additive) editor.componentSelection.clear();
    return;
  }
  if (selMode === 'face')   editor.componentSelection.toggleFace(cHit.mesh, cHit.faceIndex, additive);
  if (selMode === 'edge')   editor.componentSelection.toggleEdge(cHit.mesh, cHit.nearestEdge, additive);
  if (selMode === 'vertex') editor.componentSelection.toggleVertex(cHit.mesh, cHit.nearestVertex, additive);
});

// ---- Keyboard shortcuts ----

window.addEventListener('keydown', (e) => {
  if (isEditableTarget(e.target)) return;

  if (e.key === 'q' || e.key === 'Q') { setTool('select');    e.preventDefault(); return; }
  if (e.key === 'w' || e.key === 'W') { setTool('translate'); e.preventDefault(); return; }
  if (e.key === 'e' || e.key === 'E') { setTool('rotate');    e.preventDefault(); return; }
  if (e.key === 'r' || e.key === 'R') { setTool('scale');     e.preventDefault(); return; }

  if (e.key === '1') { setMode('object'); e.preventDefault(); return; }
  if (e.key === '2') { setMode('face');   e.preventDefault(); return; }
  if (e.key === '3') { setMode('edge');   e.preventDefault(); return; }
  if (e.key === '4') { setMode('vertex'); e.preventDefault(); return; }
  if (e.key === '5') { setMode('sculpt'); e.preventDefault(); return; }

  if (e.key === 'h' || e.key === 'H') {
    for (const obj of editor.selection.all()) editor.toggleVisibility(obj);
    e.preventDefault();
    return;
  }
  if (e.key === 'i' || e.key === 'I') {
    if (editor.isolation.isActive()) editor.exitIsolate();
    else editor.isolateSelection();
    e.preventDefault();
    return;
  }
  if ((e.key === 'd' || e.key === 'D') && e.shiftKey) {
    editor.duplicateSelection();
    e.preventDefault();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (hasFaceSelection()) {
      editor.deleteSelectedFaces();
      e.preventDefault();
    }
    return;
  }
  if (e.key === 'Escape') {
    if (editor.isolation.isActive()) editor.exitIsolate();
    else if (editor.componentSelection.size() > 0) editor.componentSelection.clear();
    else editor.selection.clear();
    e.preventDefault();
  }
});

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// ---- Import flow ----

const dropzoneHint = document.getElementById('dropzone-hint');

const SUPPORTED_RE = /\.(glb|gltf|obj|stl|fbx|3ds|ply|dae|wrl|3mf)$/i;
const IMPORT_TIMEOUT_MS = 60_000;

async function handleFiles(files: File[]) {
  if (files.length === 0) return;

  // Report what we received so silent failures are visible in DevTools.
  console.info('[import] dropped files:', files.map((f) => `${f.name} (${f.size} bytes)`));

  const primary = files.find((f) => SUPPORTED_RE.test(f.name));
  if (!primary) {
    const list = files.map((f) => f.name).join(', ');
    showToast(
      `No supported 3D file in drop (${list || 'empty'}). ` +
      'Supported: GLB, glTF, OBJ, STL, FBX, 3DS, PLY, DAE, VRML, 3MF.',
      'error',
      8000,
    );
    return;
  }

  setBusy(true, `Loading ${primary.name}…`);
  let timedOut = false;
  const watchdog = window.setTimeout(() => {
    timedOut = true;
    setBusy(false);
    showToast(
      `Import of ${primary.name} did not finish within ${IMPORT_TIMEOUT_MS / 1000}s. ` +
      'Check the DevTools console for fetch errors (Draco/KTX2 decoders, missing textures).',
      'error',
      9000,
    );
  }, IMPORT_TIMEOUT_MS);

  try {
    const { root, animations, format } = await importFiles(files, editor.renderer);
    if (timedOut) return; // user already saw the timeout toast; don't override.
    editor.setModel(root, animations);
    panel.render(diagnose(root, animations));
    sceneTree.refresh();
    lastBaseName = baseNameFromFiles(files);
    setExportEnabled(true);
    refreshOpButtons();
    if (dropzoneHint) dropzoneHint.classList.add('hidden');
    showToast(`Loaded ${primary.name} (${format.toUpperCase()})`, 'success', 2500);
  } catch (err) {
    if (timedOut) return;
    console.error('[import] failed:', err);
    showToast(`Import failed: ${(err as Error).message}`, 'error', 6000);
  } finally {
    window.clearTimeout(watchdog);
    if (!timedOut) setBusy(false);
  }
}

function baseNameFromFiles(files: File[]): string {
  const preferred =
    files.find((f) => /\.(glb|gltf|obj|stl|fbx|3ds|ply|dae|wrl|3mf)$/i.test(f.name)) ?? files[0];
  return preferred.name.replace(/\.[^.]+$/, '') || 'model';
}

const fileInput = document.getElementById('file-input') as HTMLInputElement;
fileInput.addEventListener('change', () => {
  if (fileInput.files) handleFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

// Drag and drop
['dragenter', 'dragover'].forEach((ev) => {
  app.addEventListener(ev, (e) => {
    e.preventDefault();
    app.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((ev) => {
  app.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop' || (e.target as HTMLElement) === app) {
      app.classList.remove('drag-over');
    }
  });
});
app.addEventListener('drop', async (e) => {
  const dt = (e as DragEvent).dataTransfer;
  if (!dt) return;
  const files = await readDataTransferFiles(dt);
  await handleFiles(files);
});

async function readDataTransferFiles(dt: DataTransfer): Promise<File[]> {
  const items = dt.items;
  if (items && items.length && typeof items[0]!.webkitGetAsEntry === 'function') {
    const out: File[] = [];
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]!.webkitGetAsEntry();
      if (entry) tasks.push(walkEntry(entry, '', out));
    }
    await Promise.all(tasks);
    if (out.length > 0) return out;
  }
  return Array.from(dt.files);
}

interface FSFileEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FSFileEntry[]) => void, err?: (e: unknown) => void) => void;
  };
}

async function walkEntry(entry: FSFileEntry, prefix: string, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((res, rej) => entry.file!(res, rej));
    Object.defineProperty(file, 'webkitRelativePath', {
      value: prefix + entry.name,
      configurable: true,
    });
    out.push(file);
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const entries = await new Promise<FSFileEntry[]>((res, rej) =>
      reader.readEntries(res, rej),
    );
    await Promise.all(entries.map((e) => walkEntry(e, prefix + entry.name + '/', out)));
  }
}

// ---- Export wiring ----

exportButtons.glb.addEventListener('click', async () => {
  await exportGLB(editor.modelRoot, `${lastBaseName}.glb`, {
    animations: editor.animations,
  });
});
exportButtons.gltf.addEventListener('click', async () => {
  await exportGLTFZip(editor.modelRoot, `${lastBaseName}.gltf.zip`, {
    animations: editor.animations,
  });
});
exportButtons.obj.addEventListener('click', () => {
  exportOBJ(editor.modelRoot, `${lastBaseName}.obj`);
});
exportButtons.stl.addEventListener('click', () => {
  exportSTL(editor.modelRoot, `${lastBaseName}.stl`);
});
