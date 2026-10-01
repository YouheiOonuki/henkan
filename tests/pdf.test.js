// PDF 結合・分割・回転（lib/pdf.js と pdf-lib）のテスト: node --test tests/*.test.js
// テスト用の PDF は pdf-lib そのもので作る（ページの大きさでファイルとページを見分ける）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PDFLib = require('../vendor/pdf-lib/pdf-lib.min.js');
const P = require('../lib/pdf.js');
const { PDFDocument, degrees } = PDFLib;

/** n ページの PDF。ページ k（1 から）の大きさは [w + k, h]。rots は元の向き */
async function make(n, w, h, opts = {}) {
  const d = await PDFDocument.create();
  if (opts.title) { d.setTitle(opts.title); d.setAuthor('山田 太郎'); d.setSubject('件名'); d.setKeywords(['a', 'b']); }
  for (let k = 1; k <= n; k++) {
    const p = d.addPage([w + k, h]);
    if (opts.rots && opts.rots[k - 1]) p.setRotation(degrees(opts.rots[k - 1]));
  }
  if (opts.encrypt) d.context.trailerInfo.Encrypt = d.context.obj({ Filter: 'Standard', V: 1, R: 2, P: -4 });
  return d.save({ useObjectStreams: !opts.encrypt });
}
async function pagesOf(bytes) {
  const d = await PDFDocument.load(bytes, { updateMetadata: false });
  return d.getPages().map((p) => ({ w: p.getWidth(), rot: p.getRotation().angle }));
}

test('ページ範囲: 書き方のゆれと誤り', () => {
  assert.deepEqual(P.parseRanges('1-3,5', 6).groups, [[0, 1, 2], [4]]);
  assert.deepEqual(P.parseRanges(' １〜３、５ ', 6).groups, [[0, 1, 2], [4]]);
  assert.deepEqual(P.parseRanges('1 - 2 ; 4', 6).groups, [[0, 1], [3]]);
  assert.deepEqual(P.parseRanges('5-', 6).groups, [[4, 5]]);
  assert.deepEqual(P.parseRanges('-2', 6).groups, [[0, 1]]);
  assert.deepEqual(P.parseRanges('3-1', 6).groups, [[2, 1, 0]]);
  assert.deepEqual(P.parseRanges('2,2', 6).groups, [[1], [1]]);
  assert.match(P.parseRanges('', 6).error, /ページを入れて/);
  assert.match(P.parseRanges('0', 6).error, /1 から数えます/);
  assert.match(P.parseRanges('7', 6).error, /6 ページまで/);
  assert.match(P.parseRanges('1-3-5', 6).error, /読めません/);
  assert.match(P.parseRanges('a', 6).error, /読めません/);
  assert.match(P.parseRanges('-', 6).error, /読めません/);
});

test('分け方: 1 ページずつ・N ページずつ・表示の形', () => {
  assert.deepEqual(P.eachPage(3), [[0], [1], [2]]);
  assert.deepEqual(P.everyN(5, 2).groups, [[0, 1], [2, 3], [4]]);
  assert.deepEqual(P.everyN(4, 4).groups, [[0, 1, 2, 3]]);
  assert.deepEqual(P.everyN(2, 9).groups, [[0, 1]]);
  assert.match(P.everyN(5, 0).error, /1 以上/);
  assert.equal(P.label([0, 1, 2, 4]), '1-3, 5');
  assert.equal(P.label([2, 1]), '3, 2');
  assert.deepEqual([0, 90, 180, 270, 360, -90, 450, -270].map(P.normRot), [0, 90, 180, 270, 0, 270, 90, 90]);
});

test('結合: ページ数と順番（ファイルの順・ページの順）', async () => {
  const e = P.createEngine(PDFLib);
  const a = await e.add('A', await make(3, 100, 500));   // 幅 101・102・103
  const b = await e.add('B', await make(2, 200, 500));   // 幅 201・202
  assert.equal(a.ok, true); assert.equal(a.pages.length, 3); assert.equal(b.pages.length, 2);
  const items = (id, n) => Array.from({ length: n }, (_, i) => ({ id, i, rot: 0 }));
  let out = await pagesOf(await e.compose(items('A', 3).concat(items('B', 2))));
  assert.deepEqual(out.map((p) => p.w), [101, 102, 103, 201, 202]);
  out = await pagesOf(await e.compose(items('B', 2).concat(items('A', 3))));
  assert.deepEqual(out.map((p) => p.w), [201, 202, 101, 102, 103]);
  // ページ単位で交互に（同じファイルが続かない並び）
  out = await pagesOf(await e.compose([{ id: 'A', i: 2, rot: 0 }, { id: 'B', i: 0, rot: 0 }, { id: 'A', i: 0, rot: 0 }]));
  assert.deepEqual(out.map((p) => p.w), [103, 201, 101]);
});

test('分割: 範囲どおりのページ', async () => {
  const e = P.createEngine(PDFLib);
  await e.add('A', await make(6, 100, 500));
  const groups = P.parseRanges('1-3, 5, 6-4', 6).groups.map((g) => g.map((i) => ({ id: 'A', i, rot: 0 })));
  const outs = await e.split(groups, {});
  assert.equal(outs.length, 3);
  assert.deepEqual((await pagesOf(outs[0])).map((p) => p.w), [101, 102, 103]);
  assert.deepEqual((await pagesOf(outs[1])).map((p) => p.w), [105]);
  assert.deepEqual((await pagesOf(outs[2])).map((p) => p.w), [106, 105, 104]);
  const each = await e.split(P.eachPage(6).map((g) => g.map((i) => ({ id: 'A', i, rot: 0 }))), {});
  assert.deepEqual(await Promise.all(each.map(async (b) => (await pagesOf(b)).length)), [1, 1, 1, 1, 1, 1]);
});

test('回転: 元の向きに足す（90 の倍数、0〜270 に）。削除・並べ替えも', async () => {
  const e = P.createEngine(PDFLib);
  const info = await e.add('A', await make(4, 100, 500, { rots: [0, 90, 270, 180] }));
  assert.deepEqual(info.pages.map((p) => p.rot), [0, 90, 270, 180]);
  const out = await pagesOf(await e.compose([
    { id: 'A', i: 0, rot: 90 }, { id: 'A', i: 1, rot: 90 }, { id: 'A', i: 2, rot: 90 }, { id: 'A', i: 3, rot: -90 },
  ]));
  assert.deepEqual(out.map((p) => p.rot), [90, 180, 0, 90]);
  // 2 ページ目を消して、4 → 1 → 3 の順
  const out2 = await pagesOf(await e.compose([{ id: 'A', i: 3, rot: 0 }, { id: 'A', i: 0, rot: 180 }, { id: 'A', i: 2, rot: 0 }]));
  assert.deepEqual(out2.map((p) => [p.w, p.rot]), [[104, 180], [101, 180], [103, 270]]);
});

test('回転: ページの木から受け継いだ Rotate も数える', async () => {
  const d = await PDFDocument.create();
  d.addPage([100, 100]); d.addPage([200, 100]);
  // Rotate をページではなく親の Pages に置く（ISO 32000-1 Table 30: inheritable）
  d.catalog.Pages().set(PDFLib.PDFName.of('Rotate'), PDFLib.PDFNumber.of(90));
  const e = P.createEngine(PDFLib);
  const info = await e.add('A', await d.save());
  assert.deepEqual(info.pages.map((p) => p.rot), [90, 90]);
  const out = await pagesOf(await e.compose([{ id: 'A', i: 0, rot: 90 }, { id: 'A', i: 1, rot: 0 }]));
  assert.deepEqual(out.map((p) => p.rot), [180, 90]);
});

test('文書情報: 既定では残さない（Producer・作成日も書かない）。選べば最初のファイルのものを残す', async () => {
  const e = P.createEngine(PDFLib);
  await e.add('A', await make(1, 100, 500, { title: '社外秘の題名' }));
  const plain = await e.compose([{ id: 'A', i: 0, rot: 0 }], {});
  const latin = Buffer.from(plain).toString('latin1');
  assert.doesNotMatch(latin, /\/Title|\/Author|\/Producer|\/Creator|\/CreationDate|\/ModDate/);
  const kept = await PDFDocument.load(await e.compose([{ id: 'A', i: 0, rot: 0 }], { keepInfo: true }), { updateMetadata: false });
  assert.equal(kept.getTitle(), '社外秘の題名');
  assert.equal(kept.getAuthor(), '山田 太郎');
  assert.equal(kept.getSubject(), '件名');
  assert.equal(kept.getProducer(), undefined);
});

test('しおり・フォームは持ち込まない（guide の文の裏づけ）', async () => {
  const d = await PDFDocument.create();
  const pg = d.addPage();
  const f = d.getForm().createTextField('name'); f.setText('x'); f.addToPage(pg, { x: 50, y: 50 });
  d.catalog.set(PDFLib.PDFName.of('Outlines'), d.context.register(d.context.obj({ Type: 'Outlines', Count: 0 })));
  const e = P.createEngine(PDFLib);
  await e.add('A', await d.save());
  const out = await PDFDocument.load(await e.compose([{ id: 'A', i: 0, rot: 0 }]));
  assert.equal(out.catalog.get(PDFLib.PDFName.of('Outlines')), undefined);
  assert.equal(out.getForm().getFields().length, 0);
});

test('暗号化した PDF・壊れた PDF・ページの無い PDF は ok: false（理由つき）', async () => {
  const enc = await P.inspect(PDFLib, await make(1, 100, 100, { encrypt: true }));
  assert.deepEqual(enc, { ok: false, reason: 'encrypted' });
  const broken = await P.inspect(PDFLib, new TextEncoder().encode('%PDF-1.7\nこれは壊れた PDF'));
  assert.equal(broken.ok, false); assert.equal(broken.reason, 'broken');
  const notPdf = await P.inspect(PDFLib, new Uint8Array([1, 2, 3]));
  assert.equal(notPdf.reason, 'broken');
  const empty = await P.inspect(PDFLib, await (await PDFDocument.create()).save({ addDefaultPage: false }));
  assert.equal(empty.reason, 'broken');
  // エンジンは読めなかったファイルを持たない
  const e = P.createEngine(PDFLib);
  await e.add('X', await make(1, 100, 100, { encrypt: true }));
  await assert.rejects(e.compose([{ id: 'X', i: 0, rot: 0 }]));
});

test('ZIP: 無圧縮・UTF-8 の名前・CRC が合う（APPNOTE の形）', () => {
  const files = [{ name: '見積_p1-3.pdf', bytes: new Uint8Array([37, 80, 68, 70, 1, 2, 3]) }, { name: 'b.pdf', bytes: crypto.randomBytes(5000) }];
  const z = Buffer.from(P.zip(files, new Date(2026, 9, 1, 12, 34, 56)));
  // 終わりのレコードから central directory を読む
  const eocd = z.length - 22;
  assert.equal(z.readUInt32LE(eocd), 0x06054b50);
  assert.equal(z.readUInt16LE(eocd + 10), 2);
  let cd = z.readUInt32LE(eocd + 16);
  for (const f of files) {
    assert.equal(z.readUInt32LE(cd), 0x02014b50);
    assert.equal(z.readUInt16LE(cd + 8) & 0x0800, 0x0800);           // 名前は UTF-8
    assert.equal(z.readUInt16LE(cd + 10), 0);                         // 無圧縮
    const nameLen = z.readUInt16LE(cd + 28), off = z.readUInt32LE(cd + 42), size = z.readUInt32LE(cd + 20);
    assert.equal(z.slice(cd + 46, cd + 46 + nameLen).toString('utf8'), f.name);
    assert.equal(z.readUInt32LE(off), 0x04034b50);
    const data = z.slice(off + 30 + z.readUInt16LE(off + 26), off + 30 + z.readUInt16LE(off + 26) + size);
    assert.deepEqual(new Uint8Array(data), new Uint8Array(f.bytes));
    assert.equal(z.readUInt32LE(cd + 16), zlib.crc32(data));
    cd += 46 + nameLen;
  }
});

test('pdf-lib は決めた版のまま（npm の 1.17.1 の dist/pdf-lib.min.js と同じ）・ライセンスがある', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'vendor/pdf-lib/pdf-lib.min.js'));
  assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), '0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f');
  assert.match(read('vendor/pdf-lib/LICENSE.md'), /MIT License[\s\S]*Copyright \(c\) 2019 Andrew Dillon/);
  const third = read('vendor/pdf-lib/THIRD-PARTY-LICENSES.md');
  for (const n of ['pako', 'tslib', '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'Apache License']) assert.ok(third.includes(n), n);
  const readme = read('README.md');
  assert.match(readme, /pdf-lib 1\.17\.1/);
  assert.match(readme, /MIT/);
});

test('1 ファイル版 henkan.html に pdf-lib を入れない（ROADMAP 7.10.2）', async () => {
  const h = read('henkan.html');
  for (const s of ['PDFLib', 'pdf-lib', 'Andrew Dillon', 'HenkanPdf', 'pdf-worker']) assert.ok(!h.includes(s), s);
  assert.ok(Buffer.byteLength(h) < 300000, Buffer.byteLength(h) + ' bytes');
  const { LIBS, APPS, TOOLS } = await import(path.join(ROOT, 'build.mjs'));
  assert.ok(!LIBS.concat(APPS).some((p) => /pdf/.test(p)));
  assert.ok(!TOOLS.some((t) => t.key === 'pdf'));
});

test('PDF のページ: pdf-lib は最初から読まない（Worker が読む）・何も保存しない・送信の処理が無い', () => {
  const page = read('pdf/index.html');
  assert.doesNotMatch(page, /<script[^>]+pdf-lib/);
  assert.match(page, /<script src="\.\.\/lib\/pdf\.js"><\/script>/);
  assert.match(read('lib/pdf-worker.js'), /importScripts\('\.\.\/vendor\/pdf-lib\/pdf-lib\.min\.js', 'pdf\.js'\)/);
  for (const f of ['app/pdf.js', 'lib/pdf.js', 'lib/pdf-worker.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, f);
  }
  // 保存しないので K123 の消すボタンは置かない（置くと「保存している」と誤解させる）
  assert.doesNotMatch(page, /data-reset-storage/);
});
