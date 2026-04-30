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

  const hit = pickObject(e, canvas, editor.camera, editor.modelRoot);
  if (!hit) {
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) editor.selection.clear();
    return;
  }
  if (e.shiftKey || e.metaKey || e.ctrlKey) editor.selection.toggle(hit);
  else editor.selection.set(hit);
});

// ---- Keyboard shortcuts ----

window.addEventListener('keydown', (e) => {
  if (isEditableTarget(e.target)) return;

  if (e.key === 'q' || e.key === 'Q') { setTool('select');    e.preventDefault(); return; }
  if (e.key === 'w' || e.key === 'W') { setTool('translate'); e.preventDefault(); return; }
  if (e.key === 'e' || e.key === 'E') { setTool('rotate');    e.preventDefault(); return; }
  if (e.key === 'r' || e.key === 'R') { setTool('scale');     e.preventDefault(); return; }

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
  if (e.key === 'Escape') {
    if (editor.isolation.isActive()) editor.exitIsolate();
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

async function handleFiles(files: File[]) {
  if (files.length === 0) return;
  try {
    const { root, animations } = await importFiles(files, editor.renderer);
    editor.setModel(root, animations);
    panel.render(diagnose(root, animations));
    sceneTree.refresh();
    lastBaseName = baseNameFromFiles(files);
    setExportEnabled(true);
    refreshOpButtons();
  } catch (err) {
    console.error(err);
    alert(`Import failed: ${(err as Error).message}`);
  }
}

function baseNameFromFiles(files: File[]): string {
  const preferred =
    files.find((f) => /\.(glb|gltf|obj|stl)$/i.test(f.name)) ?? files[0];
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
