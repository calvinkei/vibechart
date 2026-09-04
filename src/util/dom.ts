export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'style') node.setAttribute('style', String(v));
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k.startsWith('data-')) node.setAttribute(k, String(v));
    else if (k in node) (node as any)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function svgIcon(svg: string, size = 18): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'oc-icon';
  span.style.width = span.style.height = `${size}px`;
  span.innerHTML = svg;
  return span;
}

export function removeChildren(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setStyle(node: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(node.style, style);
}

export function getDpr(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
}

export function stopEvent(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

let styleInjected = false;
export function injectStyle(css: string, id = 'openchart-style'): void {
  if (typeof document === 'undefined') return;
  if (styleInjected || document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
  styleInjected = true;
}

/** Position a floating element near an anchor, keeping it inside the viewport/container. */
export function placeFloating(node: HTMLElement, x: number, y: number, container: HTMLElement): void {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  node.style.left = '0px';
  node.style.top = '0px';
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  let left = x;
  let top = y;
  if (left + w > cw - 4) left = Math.max(4, cw - w - 4);
  if (top + h > ch - 4) top = Math.max(4, ch - h - 4);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
