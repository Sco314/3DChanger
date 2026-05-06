/**
 * In-app debug console. Captures console.log/info/warn/error/debug into a
 * ring buffer and renders them in a togglable panel. Useful when DevTools
 * is unavailable (locked-down workstations, customer support, mobile).
 *
 * Activates by hooking the console methods at module load and forwarding to
 * the original implementation as well, so the standard browser console still
 * sees everything when DevTools is open.
 */

type Severity = 'log' | 'info' | 'warn' | 'error' | 'debug';

interface Entry {
  ts: number;
  sev: Severity;
  text: string;
}

const MAX = 400;
const buffer: Entry[] = [];
const listeners = new Set<() => void>();

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    })
    .join(' ');
}

function push(sev: Severity, args: unknown[]): void {
  buffer.push({ ts: Date.now(), sev, text: fmt(args) });
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  for (const fn of listeners) fn();
}

const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

console.log   = (...a: unknown[]) => { push('log',   a); original.log(...a); };
console.info  = (...a: unknown[]) => { push('info',  a); original.info(...a); };
console.warn  = (...a: unknown[]) => { push('warn',  a); original.warn(...a); };
console.error = (...a: unknown[]) => { push('error', a); original.error(...a); };
console.debug = (...a: unknown[]) => { push('debug', a); original.debug(...a); };

window.addEventListener('error', (e) => {
  push('error', [`window.error: ${e.message}`, `at ${e.filename}:${e.lineno}:${e.colno}`]);
});
window.addEventListener('unhandledrejection', (e) => {
  push('error', ['unhandledrejection:', (e as PromiseRejectionEvent).reason]);
});

// ---- UI ----

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export class DebugConsole {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private visible = false;

  constructor() {
    const panel = document.createElement('div');
    panel.id = 'debug-console';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="dbg-head">
        <strong>Debug log</strong>
        <span class="dbg-count">0</span>
        <span class="dbg-spacer"></span>
        <button class="btn" data-action="copy">Copy</button>
        <button class="btn" data-action="clear">Clear</button>
        <button class="btn" data-action="close" aria-label="Close">×</button>
      </div>
      <div class="dbg-body" id="debug-body"></div>
    `;
    document.body.appendChild(panel);
    this.panel = panel;
    this.body = panel.querySelector('#debug-body') as HTMLElement;

    panel.querySelector('[data-action="close"]')!.addEventListener('click', () => this.hide());
    panel.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
      buffer.length = 0;
      this.render();
    });
    panel.querySelector('[data-action="copy"]')!.addEventListener('click', async () => {
      const text = buffer.map((e) => `[${fmtTime(e.ts)}] ${e.sev.toUpperCase()}  ${e.text}`).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        push('info', ['debug log copied to clipboard']);
      } catch {
        // Fallback: select-and-prompt.
        window.prompt('Copy debug log:', text);
      }
    });

    // Toolbar toggle button.
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.id = 'debug-toggle';
    btn.title = 'Show / hide in-app debug log';
    btn.textContent = 'Debug log';
    this.toggleBtn = btn;
    btn.addEventListener('click', () => this.toggle());

    listeners.add(() => this.render());
    this.render();
  }

  /** Append the toggle button to the existing toolbar. */
  attachToggle(host: HTMLElement): void {
    host.appendChild(this.toggleBtn);
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }
  show(): void { this.visible = true; this.panel.hidden = false; this.render(); }
  hide(): void { this.visible = false; this.panel.hidden = true; }

  private render(): void {
    const count = this.panel.querySelector('.dbg-count') as HTMLElement;
    if (count) count.textContent = String(buffer.length);

    // Update the toggle button badge so the user notices new errors even
    // while the panel is closed.
    const errs = buffer.filter((e) => e.sev === 'error').length;
    this.toggleBtn.classList.toggle('has-errors', errs > 0);
    this.toggleBtn.textContent = errs > 0 ? `Debug log (${errs} err)` : 'Debug log';

    if (!this.visible) return;
    // Render the last ~150 entries (full buffer is fine for typical use).
    const tail = buffer.slice(-150);
    this.body.innerHTML = tail
      .map((e) => {
        const safe = escapeHtml(e.text);
        return `<div class="dbg-row dbg-${e.sev}"><span class="dbg-ts">${fmtTime(e.ts)}</span><span class="dbg-sev">${e.sev}</span><span class="dbg-msg">${safe}</span></div>`;
      })
      .join('');
    this.body.scrollTop = this.body.scrollHeight;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]!);
}
