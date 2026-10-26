import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rememberNote } from '../server/family-remember.js';
import { familyInboxRoute } from '../server/family-inbox.js';

const now = new Date(2026, 9, 19, 12).getTime();
test('note normalization, kind, length and dated line', () => {
  assert.equal(rememberNote({ text: ' Likes\n plain  English ' }, { now }).line, '- 19 Oct 2026 | observed | Likes plain English');
  assert.match(rememberNote({ text: 'Likes tea', kind: 'said' }, { now }).line, /\| said \|/);
  for (const text of ['', 'x'.repeat(301), null]) assert.ok(rememberNote({ text }).error);
  assert.ok(rememberNote({ text: 'x'.repeat(300) }).line);
  assert.ok(rememberNote({ text: 'tea', kind: 'other' }).error);
});
test('global rolling hourly limit and last fifty duplicates', () => {
  const line = rememberNote({ text: 'Likes tea' }, { now }).line;
  assert.match(rememberNote({ text: 'likes tea' }, { lines: [line] }).error, /already/);
  assert.ok(rememberNote({ text: 'Likes tea' }, { lines: [line, ...Array(50).fill('other')] }).line);
  assert.match(rememberNote({ text: 'Likes tea' }, { now, times: Array(20).fill(now - 1) }).error, /20 notes/);
  assert.ok(rememberNote({ text: 'Likes tea' }, { now, times: Array(20).fill(now - 3600000) }).line);
});
test('secrets cannot be confirmed; sensitive facts require explicit confirmation', () => {
  for (const text of ['sk-abc', 'ghp_abc', 'AKIA123', 'password is x', 'passwd x', 'secret x', 'token x', 'Bearer x', '-----BEGIN RSA PRIVATE KEY-----', 'aB2dE4gH6jK8mN0pQ2sT4vW6yZ8aB0dE']) {
    assert.match(rememberNote({ text, confirmed: true }).error, /secret/);
  }
  for (const text of ['health is good', 'medical appointment', 'diagnosis pending', 'salary increased', 'bank account', 'IBAN details', 'national ID', 'passport expires', 'iqama renewal', 'phone 0501234567', 'address changed', 'Pays 50 SAR', '$500', '+966 50 123 4567']) {
    assert.match(rememberNote({ text }).error, /Ask the user/);
    assert.ok(rememberNote({ text, confirmed: true }).line, text);
    assert.ok(rememberNote({ text, confirmed: JSON.parse('"true"') }).error);
  }
});
test('endpoint saves one line in an isolated directory, returns inbox and logs no text; remote refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remember-')), logs = [];
  const call = async (p, method, data = {}, remote = false) => {
    let result;
    await familyInboxRoute({ req: { method }, res: { setHeader() {} }, p, auth: { remote }, json: (_res, status, value) => { result = { status, value }; }, body: async () => data, dir, logAction: a => logs.push(a) });
    return result;
  };
  try {
    assert.equal((await call('/api/family/remember', 'POST', { text: 'Likes\n tea' })).status, 200);
    assert.deepEqual(logs, [{ action: 'remember', ok: true }]);
    const lines = (await call('/api/family/inbox', 'GET')).value.lines;
    assert.equal(lines.length, 1); assert.match(lines[0], /^- \d{1,2} [A-Z][a-z]{2} \d{4} \| observed \| Likes tea$/);
    assert.equal(fs.readFileSync(path.join(dir, 'inbox.md'), 'utf8'), lines[0] + '\n');
    assert.equal((await call('/api/family/remember', 'POST', { text: 'Likes tea' })).status, 400);
    for (const [p, method] of [['/api/family/inbox', 'GET'], ['/api/family/remember', 'POST']]) assert.equal((await call(p, method, { text: 'Other' }, true)).status, 403);
    fs.writeFileSync(path.join(dir, 'remember-times.json'), JSON.stringify(Array(20).fill(Date.now())));
    assert.match((await call('/api/family/remember', 'POST', { text: 'Likes coffee' })).value.error, /20 notes/);
    assert.equal(logs.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('remember CLI sends flags to the fixed local API without echoing private text', async () => {
  const { execFileSync } = await import('node:child_process');
  const cli = new URL('../bin/remember', import.meta.url).href;
  const script = `process.argv = ['node', 'remember', 'Likes tea', '--said', '--confirmed'];
    globalThis.fetch = async (url, options) => {
      if (url !== 'http://localhost:4321/api/family/remember' || options.redirect !== 'error') throw Error('bad URL');
      const b = JSON.parse(options.body);
      if (b.text !== 'Likes tea' || b.kind !== 'said' || b.confirmed !== true) throw Error('bad body');
      return {ok:true,json:async()=>({message:'Saved a note to the family inbox.'})};
    }; await import(${JSON.stringify(cli)});`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(output.trim(), 'Saved a note to the family inbox.');
});

test('Arabic credentials, sensitive vocabulary and Unicode numbers are filtered', () => {
  for (const text of ['كلمة المرور hunter2', 'الرقم السري 123', 'رمز الدخول', 'مفتاح خاص', 'توكن خاص', 'باسورد']) assert.match(rememberNote({ text, confirmed: true }).error, /secret/);
  for (const text of ['أعاني من السكري', 'راتبي ٢٠٠٠٠ ريال', '٠٥٠١٢٣٤٥٦٧', '۰۵۰۱۲۳۴۵۶۷', 'مرض', 'ضغط', 'سكر', 'علاج', 'دواء', 'تشخيص', 'أنسولين', 'حالة صحية', 'دخل', 'دين', 'قرض', 'بنك', 'حساب بنكي', 'آيبان', 'هوية', 'إقامة', 'جواز', 'رقم الجوال', 'عنوان']) {
    assert.match(rememberNote({ text }).error, /Ask the user/, text);
    assert.ok(rememberNote({ text, confirmed: true }).line);
  }
  for (const text of ['أحب الشاي والقراءة', 'يفضل الإجابات القصيرة', 'Likes tea and books']) assert.ok(rememberNote({ text }).line, text);
});

test('all Unicode decimal digit styles trigger the phone check', () => {
  for (const text of ['０５０１２３４５６７', '𝟢𝟧𝟢𝟣𝟤𝟥𝟦𝟧𝟨𝟩', '٠٥٠١٢٣٤٥٦٧', '۰۵۰۱۲۳۴۵۶۷', '०५०१२३४५६७', '𑁦𑁫𑁦𑁧𑁨𑁩𑁪𑁫𑁬𑁭']) {
    assert.match(rememberNote({ text }).error, /Ask the user/, text);
    assert.ok(rememberNote({ text, confirmed: true }).line);
  }
});

test('Arabic words respect boundaries while retaining credential and sensitive hits', () => {
  for (const text of ['يحب الرمزية في الشعر', 'يحب مدينة الرياض']) assert.ok(rememberNote({ text }).line, text);
  for (const text of ['كلمة المرور hunter2', 'رمز الدخول 1234', 'الرقم السري', 'وبرمز الدخول', 'ومفتاحي']) assert.match(rememberNote({ text, confirmed: true }).error, /secret/, text);
  for (const text of ['أعاني من السكري', 'راتبي ٢٠٠٠٠ ريال', 'وبالسكري', 'وديني', 'وللدين']) assert.match(rememberNote({ text }).error, /Ask the user/, text);
});
