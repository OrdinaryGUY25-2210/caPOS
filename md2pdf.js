// md2pdf.js - markdown -> HTML -> PDF (Chrome headless)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const src = process.argv[2];
const outPdf = process.argv[3];
if (!src || !outPdf) {
  console.error('usage: node md2pdf.js <input.md> <output.pdf>');
  process.exit(1);
}

const md = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  let t = esc(text);
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000C${codes.length - 1}\u0000`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return t;
}

const lines = md.split('\n');
const html = [];
let i = 0;
let listStack = [];

function closeLists(toDepth) {
  while (listStack.length > toDepth) {
    html.push(`</${listStack.pop()}>`);
  }
}

function splitRow(row) {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < r.length; k++) {
    const ch = r[k];
    if (ch === '\\' && r[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s);

while (i < lines.length) {
  const line = lines[i];
  const trimmed = line.trim();

  // table
  if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
    closeLists(0);
    const head = splitRow(trimmed);
    i += 2;
    const body = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      body.push(splitRow(lines[i].trim()));
      i++;
    }
    html.push('<table>');
    html.push('<thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>');
    html.push('<tbody>');
    for (const row of body) {
      html.push('<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
    }
    html.push('</tbody></table>');
    continue;
  }

  // hr
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
    closeLists(0);
    html.push('<hr>');
    i++;
    continue;
  }

  // headings
  const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (h) {
    closeLists(0);
    const lvl = h[1].length;
    html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    i++;
    continue;
  }

  // blockquote
  if (/^>\s?/.test(trimmed)) {
    closeLists(0);
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
      buf.push(lines[i].trim().replace(/^>\s?/, ''));
      i++;
    }
    html.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
    continue;
  }

  // lists
  const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (li) {
    const indent = li[1].replace(/\t/g, '  ').length;
    const depth = Math.floor(indent / 2) + 1;
    const ordered = /\d/.test(li[2]);
    const tag = ordered ? 'ol' : 'ul';
    // adjust stack
    while (listStack.length > depth) html.push(`</${listStack.pop()}>`);
    if (listStack.length === depth && listStack[depth - 1] !== tag) {
      html.push(`</${listStack.pop()}>`);
    }
    while (listStack.length < depth) {
      html.push(`<${tag}>`);
      listStack.push(tag);
    }
    // continuation lines
    let text = li[3];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('|') &&
      !/^(-{3,})$/.test(lines[i].trim())
    ) {
      text += ' ' + lines[i].trim();
      i++;
    }
    html.push(`<li>${inline(text)}</li>`);
    continue;
  }

  // blank
  if (trimmed === '') {
    closeLists(0);
    i++;
    continue;
  }

  // paragraph
  closeLists(0);
  const buf = [trimmed];
  i++;
  while (
    i < lines.length &&
    lines[i].trim() !== '' &&
    !/^#{1,6}\s/.test(lines[i].trim()) &&
    !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
    !lines[i].trim().startsWith('|') &&
    !/^(-{3,})$/.test(lines[i].trim()) &&
    !/^>\s?/.test(lines[i].trim())
  ) {
    buf.push(lines[i].trim());
    i++;
  }
  html.push(`<p>${inline(buf.join(' '))}</p>`);
}
closeLists(0);

const title = path.basename(src, path.extname(src));

const doc = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page {
    size: A4;
    margin: 16mm 14mm 18mm 14mm;
    @bottom-center { content: counter(page); }
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Segoe UI Emoji", system-ui, sans-serif;
    font-size: 9.6pt;
    line-height: 1.5;
    color: #1a1a1a;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 {
    font-size: 20pt; color: #0f172a; margin: 0 0 4mm;
    padding-bottom: 3mm; border-bottom: 3px solid #0d9488;
    line-height: 1.25;
  }
  h2 {
    font-size: 13pt; color: #0f766e; margin: 8mm 0 3mm;
    padding: 2mm 0 2mm 3mm; border-left: 4px solid #0d9488;
    background: #f0fdfa; line-height: 1.3;
    break-after: avoid; page-break-after: avoid;
  }
  h3 {
    font-size: 10.5pt; color: #115e59; margin: 5mm 0 2mm;
    break-after: avoid; page-break-after: avoid;
  }
  p { margin: 0 0 2.2mm; text-align: justify; }
  strong { color: #0f172a; }
  code {
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 8.2pt;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 2px;
    padding: 0.2mm 1mm;
    color: #b91c1c;
    word-break: break-word;
  }
  a { color: #0f766e; text-decoration: none; }
  hr { border: none; border-top: 1px solid #cbd5e1; margin: 5mm 0; }
  blockquote {
    margin: 0 0 3mm; padding: 2mm 3mm;
    border-left: 3px solid #94a3b8; background: #f8fafc;
    color: #334155; font-size: 9pt;
  }
  ul, ol { margin: 0 0 2.5mm; padding-left: 5mm; }
  li { margin-bottom: 1.2mm; text-align: justify; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 4mm;
    font-size: 8.3pt;
    break-inside: auto;
  }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th {
    background: #0f766e;
    color: #fff;
    text-align: left;
    padding: 1.8mm 2mm;
    font-weight: 600;
    border: 1px solid #0f766e;
    line-height: 1.3;
  }
  td {
    padding: 1.6mm 2mm;
    border: 1px solid #d5dee5;
    vertical-align: top;
    line-height: 1.4;
  }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  table strong { color: #0f172a; }
  h2 + table { break-before: avoid; page-break-before: avoid; }
</style>
</head>
<body>
${html.join('\n')}
</body>
</html>`;

const htmlPath = path.join(path.dirname(path.resolve(outPdf)), '_tmp_' + title + '.html');
fs.writeFileSync(htmlPath, doc, 'utf8');

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome/Edge not found');

const absOut = path.resolve(outPdf);
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--virtual-time-budget=4000',
  '--run-all-compositor-stages-before-draw',
  `--print-to-pdf=${absOut}`,
  '--print-to-pdf-no-header',
  'file:///' + htmlPath.replace(/\\/g, '/').replace(/ /g, '%20'),
];

execFileSync(chrome, args, { stdio: 'pipe', timeout: 120000 });
if (process.env.KEEP_HTML === '1') console.log('HTML ' + htmlPath);
else fs.unlinkSync(htmlPath);

if (!fs.existsSync(absOut)) throw new Error('PDF was not produced');
console.log('OK ' + absOut + ' (' + fs.statSync(absOut).size + ' bytes)');
