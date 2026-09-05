/**
 * Dependency-free code editor: a textarea for input with a syntax-highlighted mirror behind it,
 * a line-number gutter, indentation helpers and an error-line marker. Good enough for strategy
 * scripts without pulling in Monaco.
 */
import { el } from '../util/dom';
import { escapeHtml } from './components';

export interface CodeEditor {
  el: HTMLElement;
  getValue(): string;
  setValue(v: string): void;
  /** highlight a line (1-based) and show a message in the gutter tooltip; null clears */
  setError(line: number | null, message?: string): void;
  focus(): void;
  destroy(): void;
}

export interface CodeEditorOptions {
  value?: string;
  onChange?: (value: string) => void;
  /** Cmd/Ctrl+Enter */
  onRun?: () => void;
  /** Cmd/Ctrl+S */
  onSave?: () => void;
  readOnly?: boolean;
  placeholder?: string;
}

const KEYWORDS = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const API = new Set('strategy ta input plot plotshape plotchar plotarrow hline bgcolor fill alert alertcondition log runtime str math color shape location size open high low close volume time hl2 hlc3 ohlc4 hlcc4 bar_index last_bar_index na nz fixnan barstate syminfo timeframe year month dayofmonth hour minute second dayofweek print len range int float bool abs min max round sum any all'.split(' '));

const TOKEN_RE = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?''')|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(@\w+)|(\b[A-Za-z_]\w*\b)/g;

/** Python syntax highlighting as HTML spans (line structure preserved). */
export function highlightPython(src: string): string {
  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    const [tok, comment, tstr, str, num, deco, ident] = m;
    let cls = '';
    if (comment) cls = 'vc-hl-comment';
    else if (tstr || str) cls = 'vc-hl-string';
    else if (num) cls = 'vc-hl-number';
    else if (deco) cls = 'vc-hl-decorator';
    else if (ident) {
      if (KEYWORDS.has(ident)) cls = 'vc-hl-keyword';
      else if (API.has(ident)) cls = 'vc-hl-api';
      else if (src[m.index + tok.length] === '(') cls = 'vc-hl-call';
      else if (src.slice(Math.max(0, m.index - 4), m.index) === 'def ') cls = 'vc-hl-def';
    }
    out += cls ? `<span class="${cls}">${escapeHtml(tok)}</span>` : escapeHtml(tok);
    last = m.index + tok.length;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

export function createCodeEditor(opts: CodeEditorOptions = {}): CodeEditor {
  const root = el('div', { class: 'vc-editor' });
  const gutter = el('div', { class: 'vc-editor-gutter' });
  const scroll = el('div', { class: 'vc-editor-scroll' });
  const pre = el('pre', { class: 'vc-editor-hl', 'aria-hidden': 'true' });
  const code = el('code');
  pre.appendChild(code);
  const errLine = el('div', { class: 'vc-editor-errline', hidden: true });
  const ta = el('textarea', { class: 'vc-editor-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', placeholder: opts.placeholder ?? '' });
  if (opts.readOnly) ta.readOnly = true;
  ta.value = opts.value ?? '';
  scroll.appendChild(errLine);
  scroll.appendChild(pre);
  scroll.appendChild(ta);
  root.appendChild(gutter);
  root.appendChild(scroll);

  let errorLine: number | null = null;
  let errorMsg = '';

  function render(): void {
    const v = ta.value;
    // trailing newline keeps the pre's height equal to the textarea's
    code.innerHTML = `${highlightPython(v)}\n`;
    const lines = v.split('\n').length;
    let g = '';
    for (let i = 1; i <= lines; i++) g += `<div class="vc-editor-ln${i === errorLine ? ' vc-error' : ''}"${i === errorLine ? ` title="${escapeHtml(errorMsg)}"` : ''}>${i}</div>`;
    gutter.innerHTML = g;
    if (errorLine !== null && errorLine >= 1 && errorLine <= lines) {
      errLine.hidden = false;
      errLine.style.top = `${(errorLine - 1) * lineHeight()}px`;
      errLine.style.height = `${lineHeight()}px`;
    } else errLine.hidden = true;
    syncScroll();
  }

  let _lh = 0;
  function lineHeight(): number {
    if (_lh) return _lh;
    const cs = getComputedStyle(ta);
    _lh = parseFloat(cs.lineHeight) || 18;
    return _lh;
  }

  function syncScroll(): void {
    pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    errLine.style.transform = `translate(0, ${-ta.scrollTop}px)`;
    gutter.style.transform = `translateY(${-ta.scrollTop}px)`;
  }

  function setValueKeepCursor(v: string, start: number, end = start): void {
    ta.value = v;
    ta.selectionStart = start;
    ta.selectionEnd = end;
    onInput();
  }

  function onInput(): void {
    render();
    opts.onChange?.(ta.value);
  }

  ta.addEventListener('input', onInput);
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation(); // chart shortcuts must not fire while typing code
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); opts.onRun?.(); return; }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); opts.onSave?.(); return; }
    if (ta.readOnly) return;
    const v = ta.value;
    const s = ta.selectionStart, en = ta.selectionEnd;
    if (mod && e.key === '/') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const le = v.indexOf('\n', en) === -1 ? v.length : v.indexOf('\n', en);
      const block = v.slice(ls, le).split('\n');
      const allCommented = block.every((l) => /^\s*#/.test(l) || !l.trim());
      const out = block.map((l) => (allCommented ? l.replace(/^(\s*)# ?/, '$1') : l.trim() ? l.replace(/^(\s*)/, '$1# ') : l)).join('\n');
      setValueKeepCursor(v.slice(0, ls) + out + v.slice(le), ls, ls + out.length);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (s !== en && v.slice(s, en).includes('\n')) {
        // indent / dedent the selected lines
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const le = v.indexOf('\n', en) === -1 ? v.length : v.indexOf('\n', en);
        const block = v.slice(ls, le).split('\n');
        const out = block.map((l) => (e.shiftKey ? l.replace(/^ {1,4}/, '') : l.length ? `    ${l}` : l)).join('\n');
        setValueKeepCursor(v.slice(0, ls) + out + v.slice(le), ls, ls + out.length);
      } else if (e.shiftKey) {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const m = /^ {1,4}/.exec(v.slice(ls));
        if (m) setValueKeepCursor(v.slice(0, ls) + v.slice(ls + m[0].length), Math.max(ls, s - m[0].length));
      } else {
        setValueKeepCursor(`${v.slice(0, s)}    ${v.slice(en)}`, s + 4);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(ls, s);
      const indent = (/^\s*/.exec(line)?.[0] ?? '') + (/:\s*(#.*)?$/.test(line) ? '    ' : '');
      setValueKeepCursor(`${v.slice(0, s)}\n${indent}${v.slice(en)}`, s + 1 + indent.length);
      return;
    }
    if (e.key === 'Backspace' && s === en) {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const before = v.slice(ls, s);
      if (before.length && /^ +$/.test(before) && before.length % 4 === 0) {
        e.preventDefault();
        setValueKeepCursor(v.slice(0, s - 4) + v.slice(s), s - 4);
      }
    }
  });
  ta.addEventListener('mousedown', (e) => e.stopPropagation());

  render();
  return {
    el: root,
    getValue: () => ta.value,
    setValue(v) { ta.value = v; render(); },
    setError(line, message = '') { errorLine = line; errorMsg = message; render(); },
    focus: () => ta.focus(),
    destroy() { root.remove(); },
  };
}
