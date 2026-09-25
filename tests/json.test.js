// JSON の検証・整形（lib/json.js）のテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../lib/json.js');

function err(text) { const r = J.parse(text); assert.equal(r.ok, false, 'エラーになるはず: ' + text); return r.error; }
function fmt(text, o) { const r = J.parse(text); assert.equal(r.ok, true, JSON.stringify(r.error)); return J.format(r.value, o); }

test('JSON.parse が受け付けるものは受け付け、断るものは断る（RFC 8259 の文法）', () => {
  const ok = ['0', '-0', '1.5e-3', '"a\\u3042\\n"', 'true', 'null', '[]', '{}', ' [1, {"a": [null]}] ', '{"":""}', '"\\/"', '1E+2'];
  const ng = ['', '01', '+1', '.5', '1.', '1e', '-', '[1,]', '{"a":1,}', "{'a':1}", '{a:1}', 'NaN', 'undefined', '"\t"', '"a\nb"', '"\\x"', '[1 2]', '{"a" 1}', '[', '{"a":', '"abc', '1 2', 'True', '\u3000[]', '[1]]', '// c\n1'];
  for (const s of ok) { assert.equal(J.parse(s).ok, true, s); JSON.parse(s); }
  for (const s of ng) { assert.equal(J.parse(s).ok, false, s); assert.throws(() => JSON.parse(s), undefined, s); }
});

test('誤りの位置（行・列）と日本語の理由', () => {
  let e = err('{\n  "a": 1,\n  "b": [1, 2,],\n}');
  assert.deepEqual([e.line, e.col], [3, 13]);
  assert.match(e.message, /「\]」の前に余分な「,」/);
  e = err('{\n  "a": 1,\n}');
  assert.deepEqual([e.line, e.col], [2, 9]);
  assert.match(e.message, /「}」の前に余分な「,」/);
  e = err('{"a": 1\n "b": 2}');
  assert.deepEqual([e.line, e.col], [2, 2]);
  assert.match(e.message, /「,」がありません/);
  e = err("{'a': 1}");
  assert.deepEqual([e.line, e.col], [1, 2]);
  assert.match(e.message, /シングル|「'」/);
  e = err('{"name": "山田\n太郎"}');
  assert.deepEqual([e.line, e.col], [1, 13]);
  assert.match(e.message, /改行/);
  e = err('[\n  {"a": 1},\n  {"b": 2}\n');
  assert.deepEqual([e.line, e.col], [1, 1]);
  assert.match(e.hint, /1 行目の「\[」/);
  e = err('{"zip": 0123}');
  assert.match(e.message, /先頭に 0/);
  e = err('{"a"：1}');
  assert.match(e.message, /全角の「：」/);
  e = err('[1,\u30002]');
  assert.match(e.message, /全角スペース/);
  assert.deepEqual([e.line, e.col], [1, 4]);
  e = err('{"a":1} {"b":2}');
  assert.match(e.hint, /JSON Lines/);
});

test('列は字の数（サロゲートペアの絵文字も 1 字）。CRLF も 1 つの改行', () => {
  let e = err('{"😀": 1,}');
  assert.deepEqual([e.line, e.col], [1, 8]);
  e = err('[\r\n1,\r\n]');
  assert.deepEqual([e.line, e.col], [2, 2]);
});

test('整形: 数と文字列は書いてあったとおり（大きな整数・小数の 0・\\u エスケープ）', () => {
  const src = '{"id":12345678901234567890,"price":1.10,"n":1e2,"s":"\\u3042ｶﾞ","t":true,"z":null}';
  assert.equal(fmt(src, { indent: 2 }), '{\n  "id": 12345678901234567890,\n  "price": 1.10,\n  "n": 1e2,\n  "s": "\\u3042ｶﾞ",\n  "t": true,\n  "z": null\n}');
  assert.equal(fmt(src, { indent: 0 }), src);
  // 比べ: JSON.parse → stringify では値が変わる
  assert.notEqual(JSON.stringify(JSON.parse(src)), src);
  assert.deepEqual(J.lossyNumbers(J.parse(src).value), ['12345678901234567890']);
});

test('整形: 字下げ（2・4・タブ）、空の {} []、入れ子、名前の並べ替え', () => {
  const src = '{"b":[1,{"d":{},"c":[]}],"a":"x"}';
  assert.equal(fmt(src, { indent: 4 }), '{\n    "b": [\n        1,\n        {\n            "d": {},\n            "c": []\n        }\n    ],\n    "a": "x"\n}');
  assert.equal(fmt(src, { indent: '\t' }).split('\n')[1], '\t"b": [');
  assert.equal(fmt(src, { indent: 0, sortKeys: true }), '{"a":"x","b":[1,{"c":[],"d":{}}]}');
  // 整形 → 読み直しで同じ値（JSON.parse で比べる。精度の範囲の値だけ）
  const s2 = '{"x":[1,2,{"y":"\\"q\\""}],"日本":"語"}';
  assert.deepEqual(JSON.parse(fmt(s2, { indent: 2 })), JSON.parse(s2));
});

test('BOM は読み飛ばして知らせる。重なった名前を知らせる', () => {
  const r = J.parse('\uFEFF{"a":1,"a":2}');
  assert.equal(r.ok, true); assert.equal(r.bom, true);
  assert.deepEqual(r.dupKeys, [{ key: 'a', line: 1, col: 9 }]);
});

test('表にする: オブジェクトの配列（列は出てきた順、入れ子は「親.子」、配列は JSON のまま）', () => {
  const r = J.toRows(J.parse('[{"名前":"山田","住所":{"県":"東京"},"tags":["a","b"]},{"名前":"佐藤","年":3,"n":null}]').value);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [['名前', '住所.県', 'tags', '年', 'n'], ['山田', '東京', '["a","b"]', '', ''], ['佐藤', '', '', '3', '']]);
  assert.deepEqual(J.toRows(J.parse('[[1,"a"],[2,"b"]]').value).rows, [['1', 'a'], ['2', 'b']]);
  assert.equal(J.toRows(J.parse('{"a":1}').value).ok, false);
  assert.equal(J.toRows(J.parse('[1,2]').value).ok, false);
});

test('大きな入力: 約 5MB の JSON を 3 秒以内に読んで整形', () => {
  const arr = []; for (let i = 0; i < 40000; i++) arr.push({ id: i, name: '名前' + i, tags: ['x', 'y'], v: i / 7, ok: i % 2 === 0 });
  const s = JSON.stringify(arr);
  assert.ok(s.length > 3e6);
  const t0 = Date.now();
  const r = J.parse(s); const out = J.format(r.value, { indent: 2 });
  assert.ok(Date.now() - t0 < 3000, (Date.now() - t0) + 'ms');
  assert.deepEqual(JSON.parse(out), arr);
});

test('深い入れ子は 2000 段で止める（スタックあふれにしない）', () => {
  assert.equal(J.parse('['.repeat(1500) + ']'.repeat(1500)).ok, true);
  assert.match(J.parse('['.repeat(5000) + ']'.repeat(5000)).error.message, /入れ子が深すぎます/);
});
