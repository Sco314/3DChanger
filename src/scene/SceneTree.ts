import type * as THREE from 'three';

import type { Selection } from './Selection.js';
import { isLocked } from './objectMeta.js';

/**
 * A simple, full-rebuild DOM tree view of an Object3D hierarchy. Re-renders
 * whole on `refresh()` calls and on selection changes. For typical model
 * sizes that's plenty fast; if it ever isn't, switch to incremental row diff.
 */
export class SceneTree {
  private rowsByObj = new Map<THREE.Object3D, HTMLElement>();
  private collapsed = new WeakSet<THREE.Object3D>();
  /** Disposer for the selection subscription. */
  private readonly disposeSelectionSub: () => void;

  /** Called when the user toggles a row's visibility eye. */
  onToggleVisibility?: (obj: THREE.Object3D) => void;
  /** Called when the user toggles a row's lock icon. */
  onToggleLock?: (obj: THREE.Object3D) => void;
  /** Called when the user clicks a row label. (event for shift/meta state). */
  onSelectRow?: (obj: THREE.Object3D, e: MouseEvent) => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly modelRoot: THREE.Object3D,
    private readonly selection: Selection,
  ) {
    this.disposeSelectionSub = selection.on(() => this.refreshSelectionHighlight());
  }

  dispose() {
    this.disposeSelectionSub();
    this.host.innerHTML = '';
    this.rowsByObj.clear();
  }

  /** Full rebuild. Call after import / duplicate / delete / lock toggles. */
  refresh() {
    this.host.innerHTML = '';
    this.rowsByObj.clear();

    if (this.modelRoot.children.length === 0) {
      this.host.innerHTML = '<em class="empty">No model loaded.</em>';
      return;
    }

    const list = document.createElement('ul');
    list.className = 'tree';
    this.host.appendChild(list);

    for (const child of this.modelRoot.children) {
      list.appendChild(this.renderNode(child, 0));
    }

    this.refreshSelectionHighlight();
  }

  private renderNode(obj: THREE.Object3D, depth: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'tree-node';

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = `${depth * 14 + 4}px`;

    const hasChildren = obj.children.length > 0;
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = hasChildren ? (this.collapsed.has(obj) ? '▶' : '▼') : '·';
    if (hasChildren) {
      chev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.collapsed.has(obj)) this.collapsed.delete(obj);
        else this.collapsed.add(obj);
        this.refresh();
      });
    }
    row.appendChild(chev);

    const eye = document.createElement('span');
    eye.className = 'icon eye';
    eye.textContent = obj.visible ? '◉' : '◌';
    eye.title = obj.visible ? 'Visible (click to hide)' : 'Hidden (click to show)';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onToggleVisibility?.(obj);
    });
    row.appendChild(eye);

    const lock = document.createElement('span');
    lock.className = 'icon lock';
    const locked = isLocked(obj);
    lock.textContent = locked ? '🔒' : '🔓';
    lock.title = locked ? 'Locked (click to unlock)' : 'Unlocked (click to lock)';
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onToggleLock?.(obj);
    });
    row.appendChild(lock);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = displayName(obj);
    row.appendChild(label);

    row.addEventListener('click', (e) => {
      this.onSelectRow?.(obj, e);
    });

    li.appendChild(row);
    this.rowsByObj.set(obj, row);

    if (hasChildren && !this.collapsed.has(obj)) {
      const ul = document.createElement('ul');
      ul.className = 'tree-children';
      for (const child of obj.children) {
        ul.appendChild(this.renderNode(child, depth + 1));
      }
      li.appendChild(ul);
    }
    return li;
  }

  private refreshSelectionHighlight() {
    const primary = this.selection.primary();
    for (const [obj, row] of this.rowsByObj) {
      const isSel = this.selection.has(obj);
      row.classList.toggle('selected', isSel);
      row.classList.toggle('primary', obj === primary);
    }
  }
}

function displayName(obj: THREE.Object3D): string {
  if (obj.name) return obj.name;
  return obj.type;
}
