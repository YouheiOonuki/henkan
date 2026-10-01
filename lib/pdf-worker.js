// ===========================
// PDF の操作を画面の外で動かす Web Worker（/henkan/pdf/ だけが使う）
// pdf-lib（525KB）はここで初めて読む。ページを開いただけでは読まない（最初のファイルを選んだときに Worker を作る）
// 受け取る: { id, op: 'add' | 'drop' | 'compose' | 'split', args }。返す: { id, ok: true, result } か { id, ok: false, error }
// 中身のバイト列は Transferable で受け渡し、写しを作らない
// ===========================
/* global importScripts */
'use strict';
importScripts('../vendor/pdf-lib/pdf-lib.min.js', 'pdf.js');

var engine = self.HenkanPdf.createEngine(self.PDFLib);

self.onmessage = function (e) {
  var m = e.data || {};
  var a = m.args || [];
  Promise.resolve().then(function () { return engine[m.op].apply(null, a); }).then(function (result) {
    var transfer = [];
    [].concat(result).forEach(function (r) { if (r instanceof Uint8Array && transfer.indexOf(r.buffer) < 0) transfer.push(r.buffer); });
    self.postMessage({ id: m.id, ok: true, result: result }, transfer);
  }, function (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  });
};
self.postMessage({ ready: true });
