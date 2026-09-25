// ===========================
// 画面が頼む処理の一覧（Worker の中でも、Worker が使えないときは画面側でも同じものを呼ぶ）
// 受け取る args は配列。結果は構造化複製できる値だけ（関数・DOM を入れない）
// ===========================
/* global HenkanDiff, HenkanJson, HenkanCsv, HenkanKana */
(function (root) {
  'use strict';
  var OPS = {
    diffLines: function (a) { return HenkanDiff.diffLines(a[0], a[1], a[2]); },
    diffChars: function (a) { return HenkanDiff.diffChars(a[0], a[1], a[2]); },
    unified: function (a) { return HenkanDiff.unified(HenkanDiff.diffLines(a[0], a[1], Object.assign({}, a[2], { inline: false })), a[3]); },
    json: function (a) {
      // 読む → 整形（と表にする）までを 1 回で。大きな木を画面側に送らない
      var r = HenkanJson.parse(a[0]);
      if (!r.ok) return r;
      var o = a[1] || {};
      var out = { ok: true, bom: r.bom, dupKeys: r.dupKeys.slice(0, 20), dupCount: r.dupKeys.length, stats: HenkanJson.stats(r.value), lossy: HenkanJson.lossyNumbers(r.value, 5) };
      if (o.mode === 'csv') {
        var t = HenkanJson.toRows(r.value);
        if (!t.ok) { out.tableError = t.error; out.text = ''; }
        else { out.rows = t.rows.length - (t.header ? 1 : 0); out.cols = t.rows[0] ? t.rows[0].length : 0; out.header = t.header; out.text = HenkanCsv.stringify(t.rows, o.csv || {}); out.preview = t.rows.slice(0, 51); }
      } else out.text = HenkanJson.format(r.value, { indent: o.mode === 'min' ? 0 : o.indent, sortKeys: o.sortKeys });
      return out;
    },
    csv: function (a) {
      var text = a[0], o = a[1] || {};
      var det = HenkanCsv.detect(text);
      var d = o.delimiter && o.delimiter !== 'auto' ? o.delimiter : det.delimiter;
      var r = HenkanCsv.parse(text, { delimiter: d });
      var rows = r.rows, widths = {};
      rows.forEach(function (x) { widths[x.length] = (widths[x.length] || 0) + 1; });
      var out = { detected: det, delimiter: d, rowCount: rows.length, widths: widths, warnings: r.warnings, error: r.error, preview: rows.slice(0, 101) };
      if (o.mode === 'json') out.text = HenkanCsv.toJson(rows, { header: o.header, numbers: o.numbers });
      else out.text = HenkanCsv.stringify(rows, { delimiter: o.outDelimiter === 'same' ? d : (o.outDelimiter || ','), quote: o.quote, eol: o.eol, bom: false });
      return out;
    },
    kana: function (a) { return HenkanKana.convert(a[0], a[1]); },
  };

  root.HenkanOps = OPS;
})(typeof self !== 'undefined' ? self : this);
