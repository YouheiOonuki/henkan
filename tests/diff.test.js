// テキストの差分（lib/diff.js）のテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/diff.js');

// 動的計画法で最長共通部分列の長さ（小さい入力の正解）
function lcsLen(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}
// 印から B を組み立て直す（削除しない A の要素と、追加の B の要素を並べる）
function rebuild(a, b, da, db) {
  const out = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && da[i]) { i++; continue; }
    if (j < b.length && db[j]) { out.push(b[j]); j++; continue; }
    assert.equal(a[i], b[j], '同じとされた要素が違う');
    out.push(a[i]); i++; j++;
  }
  return out;
}
let seed = 12345;
const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

test('compare: 乱数の 2000 組で、最短（最長共通部分列と同じ長さ）かつ B に戻せる', () => {
  for (let t = 0; t < 2000; t++) {
    const la = rand(40), lb = rand(40), k = 1 + rand(6);
    const a = Int32Array.from({ length: la }, () => rand(k)), b = Int32Array.from({ length: lb }, () => rand(k));
    const r = D.compare(a, b);
    assert.deepEqual(rebuild([...a], [...b], r.da, r.db), [...b]);
    const kept = a.length - r.da.reduce((s, x) => s + x, 0);
    assert.equal(kept, lcsLen([...a], [...b]), `a=${[...a]} b=${[...b]}`);
    assert.equal(r.approx, false);
  }
});

test('compare: 端の場合（空・同じ・すべて違う・片方が空）', () => {
  const E = new Int32Array(0), X = Int32Array.from([1, 2, 3]);
  let r = D.compare(E, E); assert.equal(r.da.length + r.db.length, 0);
  r = D.compare(X, X); assert.deepEqual([...r.da, ...r.db], [0, 0, 0, 0, 0, 0]);
  r = D.compare(X, E); assert.deepEqual([...r.da], [1, 1, 1]);
  r = D.compare(E, X); assert.deepEqual([...r.db], [1, 1, 1]);
  r = D.compare(X, Int32Array.from([4, 5])); assert.deepEqual([...r.da, ...r.db], [1, 1, 1, 1, 1]);
});

test('diffLines: 変わった行の数と、行の中の字の強調', () => {
  const r = D.diffLines('りんご\nみかん\nぶどう\n', 'りんご\nみかんジュース\nぶどう\nもも\n');
  assert.equal(r.del, 1); assert.equal(r.add, 2); assert.equal(r.same, 2);
  const ch = r.hunks.find((h) => h.t === 'ch');
  assert.deepEqual(ch.inline[0].b, [['=', 'みかん'], ['+', 'ジュース']]);
  assert.deepEqual(ch.inline[0].a, [['=', 'みかん']]);
});

test('diffLines: 改行コード（CRLF と LF）と末尾の改行は比べない。違いは知らせる', () => {
  const r = D.diffLines('a\r\nb\r\n', 'a\nb');
  assert.equal(r.add + r.del, 0);
  assert.equal(r.eolA, 'CRLF'); assert.equal(r.eolB, 'LF');
  assert.equal(r.finalEolA, true); assert.equal(r.finalEolB, false);
});

test('diffLines: 空白・大文字小文字・全角半角を無視する', () => {
  const A = 'Hello World\nｶｰﾄﾞ番号 １２３\n', B = 'hello  world\nカード番号 123\n';
  assert.equal(D.diffLines(A, B).del, 2);
  assert.equal(D.diffLines(A, B, { caseless: true, space: true }).del, 1);
  assert.equal(D.diffLines(A, B, { width: true }).del, 1);
  assert.equal(D.diffLines(A, B, { caseless: true, space: true, width: true }).del, 0);
  // 全角スペースも空白として無視する
  assert.equal(D.diffLines('a b', 'a　b', { space: true }).del, 0);
});

test('diffChars: 字単位（濁点つきの半角カナは 1 字として比べる）', () => {
  const r = D.diffChars('今日は晴れ', '今日は雨');
  assert.deepEqual(r.inline, [['=', '今日は'], ['-', '晴れ'], ['+', '雨']]);
  assert.deepEqual(D.tokens('ｶﾞｲ'), ['ｶﾞ', 'ｲ']);
  assert.deepEqual(D.tokens('👍🏻a'), ['👍', '🏻', 'a']);
  const w = D.diffChars('ガイド', 'ｶﾞｲﾄﾞ', { width: true });
  assert.equal(w.add + w.del, 0);
  assert.deepEqual(w.inline, [['=', 'ｶﾞｲﾄﾞ']]);
  const s = D.diffChars('a b c', 'abc', { space: true });
  assert.equal(s.add + s.del, 0);
});

test('unified: diff -u と同じ形（見出し・範囲・前後 3 行・まとめ方・改行なし）', () => {
  const A = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'].join('\n') + '\n';
  const B = ['1', '2', 'three', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'].join('\n');
  const u = D.unified(D.diffLines(A, B), { nameA: 'a.txt', nameB: 'b.txt' });
  assert.equal(u, [
    '--- a.txt', '+++ b.txt',
    '@@ -1,6 +1,6 @@', ' 1', ' 2', '-3', '+three', ' 4', ' 5', ' 6',
    '@@ -13,3 +13,4 @@', ' 13', ' 14', ' 15', '+16', '\\ No newline at end of file', '',
  ].join('\n'));
  assert.equal(D.unified(D.diffLines('x\n', 'x\n')), '');
  assert.equal(D.unified(D.diffLines('', 'a\n')), '--- A\n+++ B\n@@ -0,0 +1 @@\n+a\n');
});

test('unified: GNU diff -u と行の中身まで一致（手で選んだ例。同じ長さの別解が無いもの）', () => {
  const A = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', B = 'a\nb\nX\nd\ne\nf\ng\nh\nY\nj\nk\n';
  // GNU diffutils 3.10 の `diff -u --label A --label B` の出力（2026-09-25 に手元で実行）
  const gnu = '--- A\n+++ B\n@@ -1,10 +1,11 @@\n a\n b\n-c\n+X\n d\n e\n f\n g\n h\n-i\n+Y\n j\n+k\n';
  assert.equal(D.unified(D.diffLines(A, B)), gnu);
});

test('大きな入力: 6 万行（約 2.3MB）・変更 600 か所を 3 秒以内に', () => {
  const lines = []; for (let i = 0; i < 60000; i++) lines.push('行 ' + i + ' の本文です。サンプルのテキスト abcdefghij ' + (i * 7919 % 1000));
  const b = lines.slice(); for (let i = 0; i < b.length; i += 97) b[i] += ' 変更';
  const t0 = Date.now();
  const r = D.diffLines(lines.join('\n'), b.join('\n'));
  const ms = Date.now() - t0;
  assert.equal(r.del, Math.ceil(60000 / 97)); assert.equal(r.add, r.del);
  assert.ok(ms < 3000, ms + 'ms');
});

test('大きな入力: すべて違う 2 万行どうしでも止まらない', () => {
  const a = [], b = []; for (let i = 0; i < 20000; i++) { a.push('a' + (i % 5000)); b.push('b' + (i % 5000)); }
  const t0 = Date.now();
  const r = D.diffLines(a.join('\n'), b.join('\n'));
  assert.equal(r.del, 20000); assert.equal(r.add, 20000);
  assert.ok(Date.now() - t0 < 3000);
});

test('大きな入力: 似た行が多く差分が多いときは近似（approx）で止まる', () => {
  const a = [], b = []; seed = 7;
  for (let i = 0; i < 40000; i++) { a.push(String(rand(3))); b.push(String(rand(3))); }
  const t0 = Date.now();
  const r = D.diffLines(a.join('\n'), b.join('\n'), { inline: false });
  assert.ok(Date.now() - t0 < 5000, (Date.now() - t0) + 'ms');
  assert.equal(r.approx, true);
  // 近似でも B には戻せる
  const ids = r.linesA.length - r.del;
  assert.equal(ids + r.add, r.linesB.length);
});
