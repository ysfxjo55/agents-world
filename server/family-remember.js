// Decimal digit blocks contain ten ordered code points (some adjacent blocks).
function asciiDigits(text) {
  return text.normalize('NFKC').replace(/\p{Nd}/gu, digit => {
    const point = digit.codePointAt(0);
    let start = point;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((point - start) % 10);
  });
}
function arabicMatch(text, words) {
  const prefix = '(?:[وف]?(?:[بلك]?(?:ال)?|لل))';
  return new RegExp('(?<![\\p{L}\\p{N}_])' + prefix + '(?:' + words + ')(?:ي|ك|كم|كن|ه|ها|هم|هن|نا)?(?![\\p{L}\\p{N}_])', 'u').test(text);
}
// Pure rules: callers supply history and time; rejected text is never returned or logged.
export function rememberNote({ text = null, kind = 'observed', confirmed = false } = {}, { lines = [], times = [], now = Date.now() } = {}) {
  if (typeof text !== 'string') return { error: 'A note must be text.' };
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || [...text].length > 300) return { error: 'A note must contain 1 to 300 characters.' };
  if (!['said', 'observed'].includes(kind)) return { error: 'Kind must be said or observed.' };
  const secret = /sk-|ghp_|AKIA|\b(password|passwd|secret|token|Bearer)\b|-----BEGIN .*PRIVATE KEY|\b(?=[A-Za-z0-9_+/=-]{32,}\b)(?=[A-Za-z0-9_+/=-]*[a-zA-Z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]+/i;
  const randomToken = text.split(/\s+/).some(word => /^[A-Za-z0-9_+/=-]{32,}$/.test(word) && new Set(word).size >= 16);
  const normalized = asciiDigits(text);
  if (arabicMatch(normalized, 'كلمة المرور|رقم السري|رمز|مفتاح|توكن|باسورد') || secret.test(text) || randomToken) return { error: 'Refused: this looks like a secret or credential. Do not save secrets.' };
  const sensitive = /\b(health|medical|diagnos\w*|salary|bank|IBAN|national ID|passport|iqama|phone|address|diabetes|cancer|medication|depression|income|rent|savings|debt|treatment|disease|disorder)\b|(?:[$€£﷼]\s*\d|\d[\d,.]*\s*(?:USD|SAR|EUR|GBP|riyals?|dollars?))|\+?\d[\d ()-]{7,}\d/i;
  if ((arabicMatch(normalized, 'مرض|سكري|ضغط|سكر|علاج|دواء|تشخيص|أنسولين|حالة صحية|راتب|دخل|ريال|دين|قرض|بنك|حساب بنكي|آيبان|هوية|إقامة|جواز|رقم الجوال|عنوان') || sensitive.test(normalized)) && confirmed !== true) return { error: 'This may be sensitive personal data. Ask the user first, then retry with confirmed: true.' };
  if (lines.slice(-50).some(line => line.split(' | ').slice(2).join(' | ').toLowerCase() === text.toLowerCase())) return { error: 'This note is already in the last 50 inbox lines.' };
  if (times.filter(t => t > now - 3600000).length >= 20) return { error: 'Limit reached: at most 20 notes per hour in total.' };
  const d = new Date(now), months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return { line: `- ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} | ${kind} | ${text}` };
}
