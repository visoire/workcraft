// Small Markdown to HTML converter without DOM (exports, docs). Escapes all HTML in the source.

export const escHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function inlineMd(s: string): string {
  let out = escHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, a: string, u: string) => (/^(https?:|data:image\/|[\w./-]+$)/.test(u) && !/^javascript:/i.test(u) ? `<img src="${u}" alt="${a}" loading="lazy">` : a));
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => (/^(https?:|mailto:|#|[\w./-]+$)/.test(u) && !/^javascript:/i.test(u) ? `<a href="${u}">${t}</a>` : t));
  return out;
}

export function mdToHtml(md: string): string {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const slug = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  while (i < lines.length) {
    const ln = lines[i]!;
    if (/^```/.test(ln)) {
      const lang = ln.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) buf.push(lines[i++]!);
      i++;
      out.push(`<pre><code${lang ? ` class="lang-${escHtml(lang)}"` : ''}>${escHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const hm = ln.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = hm[1]!.length;
      out.push(`<h${lvl} id="${slug(hm[2]!)}">${inlineMd(hm[2]!)}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(ln)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\|.*\|\s*$/.test(ln) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const cells = (l: string) => l.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const head = cells(ln);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(ln)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) {
      const ordered = /^\s*\d+[.)]\s+/.test(ln);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inlineMd(x.replace(/^\[( |x)\]\s*/i, (_m, c: string) => (c.trim() ? '☑ ' : '☐ ')))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!ln.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+|\|.*\|\s*$)/.test(lines[i]!)) buf.push(lines[i++]!);
    if (!buf.length) buf.push(lines[i++]!);
    out.push(`<p>${buf.map(inlineMd).join('<br>')}</p>`);
  }
  return out.join('\n');
}
