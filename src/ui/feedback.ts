/**
 * Lightweight UI feedback: a busy overlay you can show during long-running
 * work, and stackable non-blocking toasts. Kept dependency-free so it can
 * be imported from anywhere without forming a UI framework dependency.
 */

const overlay = (): HTMLElement => document.getElementById('busy-overlay')!;
const overlayText = (): HTMLElement => document.getElementById('busy-text')!;
const toastHost = (): HTMLElement => document.getElementById('toast-host')!;

export function setBusy(active: boolean, message = 'Loading…'): void {
  const el = overlay();
  if (!el) return;
  if (active) {
    overlayText().textContent = message;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

export type ToastKind = 'info' | 'error' | 'success';

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 4500): void {
  const host = toastHost();
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  // Auto-dismiss; click also dismisses.
  const dismiss = () => { el.remove(); };
  el.addEventListener('click', dismiss);
  setTimeout(dismiss, durationMs);
}
