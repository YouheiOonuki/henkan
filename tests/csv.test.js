// CSV の読み取り・書き出し（lib/csv.js）のテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/csv.js');

test('RFC 4180 2 章の例がそのとおりに読める', () => {
  assert.deepEqual(C.parse('aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n').rows, [['aaa', 'bbb', 'ccc'], ['zzz', 'yyy', 'xxx']]);
  assert.deepEqual(C.parse('aaa,bbb,ccc\r\nzzz,yyy,xxx').rows, [['aaa', 'bbb', 'ccc'], ['zzz', 'yyy', 'xxx']]);   // 2: 最後の改行なし
  assert.deepEqual(C.parse('"aaa","b\r\nbb","ccc"\r\nzzz,yyy,xxx').rows, [['aaa', 'b\r\nbb', 'ccc'], ['zzz', 'yyy', 'xxx']]);   // 6
  assert.deepEqual(C.parse('"aaa","b""bb","ccc"').rows, [['aaa', 'b"bb', 'ccc']]);   // 7
  assert.deepEqual(C.parse(' a , b ').rows, [[' a ', ' b ']]);   // 4: 空白はフィールドの一部
});

test('LF・CR の改行、空のフィールド、空の行、BOM', () => {
  assert.deepEqual(C.parse('a,b\nc,d\re,f').rows, [['a', 'b'], ['c', 'd'], ['e', 'f']]);
  assert.deepEqual(C.parse('a,,\n,,').rows, [['a', '', ''], ['', '', '']]);
  assert.deepEqual(C.parse('"",""').rows, [['', '']]);
  assert.deepEqual(C.parse('a\n\nb').rows, [['a'], [''], ['b']]);
  assert.deepEqual(C.parse('﻿a,b').rows, [['a', 'b']]);
  assert.deepEqual(C.parse('').rows, []);
});

test('崩れた CSV: 閉じない「"」は行番号つきのエラー、途中の「"」は注意', () => {
  let r = C.parse('a,b\nc,"d\ne,f\n');
  assert.deepEqual(r.error, { line: 2, message: '2 行目で始まる「"」が閉じていません。' });
  r = C.parse('a,b"c,d\n');
  assert.deepEqual(r.rows, [['a', 'b"c', 'd']]);
  assert.equal(r.warnings[0].line, 1);
  r = C.parse('"a"b,c\nd,"e\nf"g\nh,i');
  assert.deepEqual(r.rows, [['ab', 'c'], ['d', 'e\nfg'], ['h', 'i']]);
  assert.deepEqual(r.warnings.map((w) => w.line), [1, 3]);
});

test('区切り文字の推定（カンマ・タブ・セミコロン・縦棒）。引用の中の区切りは数えない', () => {
  assert.equal(C.detect('品番\t数量\nA-01\t3\nB-02\t10\n').delimiter, '\t');
  assert.equal(C.detect('a;b;c\n1;2,5;3\n4;5;6\n').delimiter, ';');
  assert.equal(C.detect('a|b\n1|2\n').delimiter, '|');
  assert.equal(C.detect('名前,メモ\n"山田","a;b;c;d"\n"佐藤","e;f;g;h"\n').delimiter, ',');
  const d = C.detect('ひとつの列\nだけ\n');
  assert.equal(d.delimiter, ','); assert.equal(d.sure, false);
});

test('書き出し: 必要なときだけ囲む（区切り・「"」・改行・前後の空白）。すべて囲む・CRLF/LF・BOM', () => {
  const rows = [['a', 'b,c', 'd"e', 'f\ng', ' h', '']];
  assert.equal(C.stringify(rows), 'a,"b,c","d""e","f\ng"," h",\r\n');
  assert.equal(C.stringify(rows, { delimiter: '\t' }), 'a\tb,c\t"d""e"\t"f\ng"\t" h"\t\r\n');
  assert.equal(C.stringify([['1', '2']], { quote: 'all', eol: '\n' }), '"1","2"\n');
  assert.equal(C.stringify([['あ']], { bom: true }), '﻿あ\r\n');
});

test('往復: 書き出して読み直すと元の表に戻る（乱数 500 表、区切り 4 種）', () => {
  let seed = 1; const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const parts = ['a', 'あ', ',', '"', '\n', '\r\n', ' ', '\t', ';', '|', 'ｶﾞ', '', '""'];
  for (let t = 0; t < 500; t++) {
    const w = 1 + rand(4), h = 1 + rand(5);
    const rows = Array.from({ length: h }, () => Array.from({ length: w }, () => Array.from({ length: rand(4) }, () => parts[rand(parts.length)]).join('')));
    if (w === 1) rows.forEach((r) => { if (r[0] === '') r[0] = 'x'; });   // 1 列で空のセルは「空の行」と区別できない
    const d = [',', '\t', ';', '|'][t % 4];
    const out = C.stringify(rows, { delimiter: d, eol: t % 2 ? '\n' : '\r\n', bom: t % 3 === 0 });
    const r = C.parse(out, { delimiter: d });
    assert.equal(r.error, null);
    assert.deepEqual(r.rows, rows, JSON.stringify(out));
  }
});

test('JSON にする: 見出しあり・なし、先頭の 0 を落とさない、名前の重なり・空', () => {
  const rows = [['郵便番号', '名前', '名前', '', '数'], ['0010001', '山田', 'やまだ', 'x', '1.50'], ['0600000', '佐藤']];
  assert.deepEqual(JSON.parse(C.toJson(rows, { header: true })), [
    { 郵便番号: '0010001', 名前: '山田', 名前_2: 'やまだ', 列4: 'x', 数: '1.50' },
    { 郵便番号: '0600000', 名前: '佐藤', 名前_2: '', 列4: '', 数: '' },
  ]);
  const n = JSON.parse(C.toJson([['a', 'b', 'c', 'd'], ['007', '12', '-3.25', '12345678901234567890']], { header: true, numbers: true }));
  assert.deepEqual(n, [{ a: '007', b: 12, c: -3.25, d: '12345678901234567890' }]);
  assert.deepEqual(JSON.parse(C.toJson([['1', '2']], { header: false })), [['1', '2']]);
});

test('文字コード: UTF-8（BOM あり・なし）、Shift_JIS', () => {
  const u8 = new TextEncoder().encode('名前,値\n');
  assert.deepEqual(C.decode(u8), { text: '名前,値\n', encoding: 'UTF-8' });
  assert.equal(C.decode(Uint8Array.from([0xEF, 0xBB, 0xBF, ...u8])).encoding, 'UTF-8（BOM あり）');
  // 「名前,値」の Shift_JIS（96BC 914F 2C 926C）
  const sj = Uint8Array.from([0x96, 0xBC, 0x91, 0x4F, 0x2C, 0x92, 0x6C, 0x0A]);
  assert.deepEqual(C.decode(sj), { text: '名前,値\n', encoding: 'Shift_JIS' });
});

test('大きな入力: 約 5MB・10 万行の CSV を 3 秒以内に読んで書き出す', () => {
  const lines = ['id,name,memo']; for (let i = 0; i < 100000; i++) lines.push(i + ',"山田, 太郎' + i + '",メモ ' + i + ' abcdefghijklmnop');
  const s = lines.join('\r\n');
  const t0 = Date.now();
  const r = C.parse(s, { delimiter: C.detect(s).delimiter });
  const out = C.stringify(r.rows);
  assert.ok(Date.now() - t0 < 3000, (Date.now() - t0) + 'ms');
  assert.equal(r.rows.length, 100001);
  assert.equal(out, s + '\r\n');
});
