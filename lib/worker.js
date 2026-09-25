// ===========================
// 重い処理を画面の外で動かす Web Worker（数 MB の入力でも画面が固まらないように）
// 受け取る: { id, op, args }。返す: { id, ok: true, result } か { id, ok: false, error }
// ページが分かれた版（/henkan/diff/ など）は importScripts で読み、1 ファイル版（henkan.html）は
// ビルドがこのファイルの前に lib/*.js をつなげて Blob にするので、読み込みは要らない
// ===========================
/* global importScripts */
'use strict';
if (typeof self.HenkanOps === 'undefined') importScripts('kana.js', 'diff.js', 'json.js', 'csv.js', 'ops.js');

self.onmessage = function (e) {
  var m = e.data || {};
  try {
    var t0 = Date.now();
    var result = self.HenkanOps[m.op](m.args || []);
    self.postMessage({ id: m.id, ok: true, result: result, ms: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
