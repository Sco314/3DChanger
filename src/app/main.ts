import { Editor } from './Editor.js';
import { importFiles } from '../io/import/index.js';
import { diagnose } from '../diagnostics/diagnose.js';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel.js';
import { exportGLB } from '../io/export/exportGLB.js';
import { exportGLTFZip } from '../io/export/exportGLTF.js';
import { exportOBJ } from '../io/export/exportOBJ.js';
import { exportSTL } from '../io/export/exportSTL.js';

const app = document.getElementById('app')!;
const viewport = document.getElementById('viewport')!;
const editor = new Editor(viewport);

const panel = new DiagnosticsPanel(document.getElementById('diagnostics-body')!);
panel.reset();

const exportButtons = {
  glb: document.getElementById('export-glb') as HTMLButtonElement,
  gltf: document.getElementById('export-gltf') as HTMLButtonElement,
  obj: document.getElementById('export-obj') as HTMLButtonElement,
  stl: document.getElementById('export-stl') as HTMLButtonElement,
};

let lastBaseName = 'model';

function setExportEnabled(on: boolean) {
  for (const b of Object.values(exportButtons)) b.disabled = !on;
}

async function handleFiles(files: File[]) {
  if (files.length === 0) return;
  try {
    const { root, animations } = await importFiles(files, editor.renderer);
    editor.setModel(root, animations);
    panel.render(diagnose(root, animations));
    lastBaseName = baseNameFromFiles(files);
    setExportEnabled(true);
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

// File picker
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

// Read files including any from a folder drop, when supported.
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
    // Preserve relative path so MTL/textures resolve by path or basename.
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

// Export wiring
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
