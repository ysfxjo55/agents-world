import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Images the user pastes into the chat are saved here (git-ignored, private) so the agent can open them with its Read tool.
export const UPLOADS = process.env.AGENT_WORLD_UPLOADS || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'uploads');
const ID = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

// Documents for the Research Lab: a PDF or a plain-text file (checked by content, not by name).
const DOC = /^doc-[0-9a-f-]{36}\.(pdf|txt)$/;
export function docType(b) {
  if (b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (b.length && b.length <= 5 * 1024 * 1024 && !b.includes(0)) { try { new TextDecoder('utf-8', { fatal: true }).decode(b); return 'txt'; } catch { return null; } }
  return null;
}
export function saveDoc(buf) {
  const ext = docType(buf); if (!ext) return null;
  fs.mkdirSync(UPLOADS, { recursive: true });
  const id = `doc-${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, id), buf); return id;
}
export function docPath(id) {
  if (typeof id !== 'string' || !DOC.test(id)) return null;
  const p = path.join(UPLOADS, id); return fs.existsSync(p) ? p : null;
}

// Word documents (.docx, .doc) and RTF are turned into plain text with macOS's own textutil, so the agent can read them. Checked by content.
export function wordToText(buf) {
  const head = buf.subarray(0, 8).toString('latin1');
  const kind = head.startsWith('PK\x03\x04') && buf.includes('word/document.xml') ? 'docx' : head.startsWith('{\\rtf') ? 'rtf' : buf.subarray(0, 4).toString('hex') === 'd0cf11e0' ? 'doc' : null;
  if (!kind) return null;
  fs.mkdirSync(UPLOADS, { recursive: true });
  const base = path.join(UPLOADS, `tmp-${crypto.randomUUID()}`), src = `${base}.${kind}`;
  try {
    fs.writeFileSync(src, buf);
    const out = execFileSync('textutil', ['-convert', 'txt', '-stdout', src], { maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
    if (out.length && out.length <= 5 * 1024 * 1024) { return Object.assign(out, { kind }); } return null;
  } catch { return null; } finally { try { fs.rmSync(src, { force: true }); } catch { /* ignore */ } }
}
// PowerPoint (.pptx) and Excel (.xlsx) are zip files of XML: pull out the text (slide text and notes; cell texts). Pictures and charts are not read.
const xmlText = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g'))].map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')).filter(Boolean);
export function officeToText(buf) {
  if (buf.subarray(0, 4).toString('latin1') !== 'PK\x03\x04') return null;
  const kind = buf.includes('ppt/slides/') ? 'pptx' : buf.includes('xl/workbook.xml') ? 'xlsx' : null;
  if (!kind) return null;
  fs.mkdirSync(UPLOADS, { recursive: true });
  const src = path.join(UPLOADS, `tmp-${crypto.randomUUID()}.${kind}`);
  const unzip = (p) => { try { return execFileSync('unzip', ['-p', src, p], { maxBuffer: 30 * 1024 * 1024, timeout: 30_000 }).toString('utf8'); } catch { return ''; } };
  try {
    fs.writeFileSync(src, buf);
    const names = execFileSync('unzip', ['-Z1', src], { maxBuffer: 5 * 1024 * 1024, timeout: 30_000 }).toString().split('\n');
    const num = (n) => Number((n.match(/(\d+)\.xml$/) || [])[1] || 0);
    let out = '';
    if (kind === 'pptx') {
      for (const n of names.filter(x => /^ppt\/slides\/slide\d+\.xml$/.test(x)).sort((a, b) => num(a) - num(b))) {
        out += `## Slide ${num(n)}\n${xmlText(unzip(n), 'a:t').join('\n')}\n`;
        const notes = names.find(x => x === `ppt/notesSlides/notesSlide${num(n)}.xml`); if (notes) { const t = xmlText(unzip(notes), 'a:t').join(' '); if (t) out += `(speaker notes) ${t}\n`; }
        out += '\n';
      }
    } else {
      const strings = xmlText(unzip('xl/sharedStrings.xml'), 't');
      out = `## Texts in the workbook (cell values; numbers and formulas are not included)\n${strings.join('\n')}\n`;
    }
    out = out.trim(); const b = Buffer.from(out, 'utf8');
    if (b.length && b.length <= 5 * 1024 * 1024) { return Object.assign(b, { kind }); } return null;
  } catch { return null; } finally { try { fs.rmSync(src, { force: true }); } catch { /* ignore */ } }
}
// Office files are kept as they are next to their extracted text (<id>.orig.<ext>), so an agent can EDIT the real file, not just read its text.
function keepOriginal(id, text, original) { try { if (text.kind) fs.writeFileSync(path.join(UPLOADS, id.replace(/\.txt$/, `.orig.${text.kind}`)), original); } catch { /* optional */ } return id; }
export const originalOf = (p) => { try { const base = p.replace(/\.txt$/, ''); return fs.readdirSync(path.dirname(p)).map(f => path.join(path.dirname(p), f)).find(f => f.startsWith(base + '.orig.')) || null; } catch { return null; } };
// any attachment: an image, a PDF, a text-like file or a Word document -> { id, kind }
export function saveAny(buf) {
  const img = saveUpload(buf); if (img) return { id: img, kind: 'image' };
  const office = officeToText(buf); if (office) { const id = saveDoc(office); return id ? { id: keepOriginal(id, office, buf), kind: 'file' } : null; }
  const word = wordToText(buf); if (word) { const id = saveDoc(word); return id ? { id: keepOriginal(id, word, buf), kind: 'file' } : null; }
  const doc = saveDoc(buf); return doc ? { id: doc, kind: 'file' } : null;
}

// real image type from the first bytes (never trust the file name or Content-Type)
export function imageType(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
export function saveUpload(buf) {
  const ext = imageType(buf); if (!ext) return null;
  fs.mkdirSync(UPLOADS, { recursive: true });
  const id = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, id), buf);
  return id;
}
// id -> absolute path, or null if the id is not a file we saved
export function uploadPath(id) {
  if (typeof id !== 'string' || !(ID.test(id) || DOC.test(id))) return null;
  const p = path.join(UPLOADS, id); return fs.existsSync(p) ? p : null;
}
// remove uploads older than maxAgeMs (they can contain private screenshots)
export function cleanUploads(maxAgeMs = 7 * 86400_000) {
  let n = 0;
  try { for (const f of fs.readdirSync(UPLOADS)) { const p = path.join(UPLOADS, f); if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p); n++; } } } catch { /* no uploads yet */ }
  return n;
}
