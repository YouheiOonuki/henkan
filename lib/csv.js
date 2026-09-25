// ===========================
// CSV の読み取り・書き出し（画面から切り離した純粋関数。DOM に触らない）
// ブラウザ・Worker では self.HenkanCsv、Node（テスト）では module.exports
//
// 形式は RFC 4180（2005 年、Informational）の 2 章に合わせる:
//   - 区切りを含む・「"」を含む・改行を含むフィールドは「"」で囲む（6）
//   - 囲んだフィールドの中の「"」は「""」と 2 つ重ねる（7）
//   - 最後のレコードの改行はあってもなくてもよい（2）。空白はフィールドの一部（4）
// 読むときは RFC より広く受け入れる: 改行は CRLF・LF・CR のどれでも、区切りはカンマ・タブ・セミコロン・縦棒、
//   囲まないフィールドの途中の「"」はそのまま文字として読み、注意を返す
// ===========================
(function (root) {
  'use strict';

  var DELIMS = [',', '\t', ';', '|'];
  var NAMES = { ',': 'カンマ', '\t': 'タブ', ';': 'セミコロン', '|': '縦棒（|）' };

  /**
   * 読み取る
   * @returns {{rows: string[][], warnings: Array<{line, message}>, error: null | {line, message}}}
   *   line は元のテキストの行番号（1 から）
   */
  function parse(text, o) {
    o = o || {};
    var s = String(text == null ? '' : text), d = o.delimiter || ',', limit = o.maxRows || Infinity;
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var rows = [], row = [], field = '', i = 0, n = s.length, line = 1, warnings = [], error = null;
    var dc = d.charCodeAt(0);
    if (n === 0) return { rows: rows, warnings: warnings, error: null };
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c === 34 && field === '') {
        // 囲んだフィールド
        var start = line, j = i + 1, buf = [];
        for (;;) {
          var q = s.indexOf('"', j);
          if (q < 0) {
            error = { line: start, message: start + ' 行目で始まる「"」が閉じていません。' };
            buf.push(s.slice(j)); line += countNl(s, j, n); i = n; break;
          }
          buf.push(s.slice(j, q)); line += countNl(s, j, q);
          if (s.charCodeAt(q + 1) === 34) { buf.push('"'); j = q + 2; continue; }
          i = q + 1; break;
        }
        field = buf.join('');
        if (error) { row.push(field); rows.push(row); return { rows: rows, warnings: warnings, error: error }; }
        // 閉じた「"」のすぐ後ろは区切りか改行か終わり
        var nc = s.charCodeAt(i);
        if (i < n && nc !== dc && nc !== 10 && nc !== 13) {
          if (warnings.length < 20) warnings.push({ line: line, message: line + ' 行目: 閉じた「"」の後ろに文字があります（そのまま続けて読みました）。' });
          var k = i;
          while (k < n && s.charCodeAt(k) !== dc && s.charCodeAt(k) !== 10 && s.charCodeAt(k) !== 13) k++;
          field += s.slice(i, k); i = k;
        }
        field = { v: field };   // 空文字でも「囲んだ」ことを覚えておく（下で文字列に戻す）
        continue;
      }
      if (c === dc) { row.push(val(field)); field = ''; i++; continue; }
      if (c === 10 || c === 13) {
        row.push(val(field)); field = ''; rows.push(row); row = [];
        if (rows.length >= limit) return { rows: rows, warnings: warnings, error: null, truncated: true };
        i += (c === 13 && s.charCodeAt(i + 1) === 10) ? 2 : 1; line++;
        continue;
      }
      // 囲まないフィールド: 次の区切り・改行まで
      var e = i;
      while (e < n) { var cc = s.charCodeAt(e); if (cc === dc || cc === 10 || cc === 13) break; e++; }
      var chunk = s.slice(i, e);
      if (typeof field === 'object') field = field.v;
      if (chunk.indexOf('"') >= 0 && warnings.length < 20) warnings.push({ line: line, message: line + ' 行目: 「"」で囲まれていないフィールドの中に「"」があります（文字として読みました）。' });
      field += chunk; i = e;
    }
    // 最後のレコード（終わりに改行が無いとき）
    if (field !== '' || row.length) { row.push(val(field)); rows.push(row); }
    return { rows: rows, warnings: warnings, error: null };
  }
  function val(f) { return typeof f === 'object' ? f.v : f; }
  function countNl(s, a, b) {
    var k = 0;
    for (var x = a; x < b; x++) { var c = s.charCodeAt(x); if (c === 10 || (c === 13 && s.charCodeAt(x + 1) !== 10)) k++; }
    return k;
  }

  /**
   * 区切り文字を推定する。先頭の 100 レコードを各候補で読み、列の数がそろっていて 2 列以上のものを選ぶ
   * @returns {{delimiter: string, name: string, columns: number, sure: boolean}}
   */
  function detect(text) {
    var sample = String(text || '').slice(0, 200000), best = null;
    DELIMS.forEach(function (d, rank) {
      var r = parse(sample, { delimiter: d, maxRows: 100 });
      var rows = r.rows.filter(function (x) { return !(x.length === 1 && x[0] === ''); });
      if (rows.length > 1 && sample.length >= 200000) rows.pop();   // 切った末尾の半端な行は数えない
      if (!rows.length) return;
      var counts = new Map();
      rows.forEach(function (x) { counts.set(x.length, (counts.get(x.length) || 0) + 1); });
      var mode = 0, freq = 0;
      counts.forEach(function (f, k) { if (f > freq || (f === freq && k > mode)) { mode = k; freq = f; } });
      var score = mode > 1 ? (freq / rows.length) * 1000 + Math.min(mode, 50) - rank * 0.1 : 0;
      if (!best || score > best.score) best = { delimiter: d, score: score, columns: mode, consistent: freq === rows.length };
    });
    if (!best || best.score === 0) return { delimiter: ',', name: NAMES[','], columns: 1, sure: false };
    return { delimiter: best.delimiter, name: NAMES[best.delimiter], columns: best.columns, sure: best.consistent };
  }

  /**
   * 書き出す
   * @param {string[][]} rows
   * @param {{delimiter?: string, quote?: 'auto'|'all', eol?: '\r\n'|'\n', bom?: boolean}} o
   *   quote 'auto' は RFC 4180 の 6 のとおり、区切り・「"」・改行を含むフィールドだけ囲む
   *   （先頭・末尾に空白があるフィールドも、読み手が削らないよう囲む）
   */
  function stringify(rows, o) {
    o = o || {};
    var d = o.delimiter || ',', eol = o.eol || '\r\n', all = o.quote === 'all';
    var out = rows.map(function (r) {
      return r.map(function (f) {
        var v = f == null ? '' : String(f);
        if (all || v.indexOf(d) >= 0 || /["\r\n]/.test(v) || /^\s|\s$/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(d);
    }).join(eol);
    if (rows.length) out += eol;
    return (o.bom ? '﻿' : '') + out;
  }

  /**
   * JSON にする。header なら 1 行目を名前にしたオブジェクトの配列、そうでなければ配列の配列。
   * numbers なら「0 で始まらない整数・小数」だけを数にする（郵便番号・電話番号の先頭の 0 を落とさない）
   */
  function toJson(rows, o) {
    o = o || {};
    function conv(v) {
      if (o.numbers && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) {
        var num = Number(v);
        if (Number.isSafeInteger(num) || (/\./.test(v) && String(num) === v.replace(/^(-?)0*(\d)/, '$1$2'))) return num;
      }
      return v;
    }
    var indent = o.indent == null ? 2 : o.indent;
    if (!o.header) return JSON.stringify(rows.map(function (r) { return r.map(conv); }), null, indent);
    var names = uniqueNames(rows[0] || []);
    var list = rows.slice(1).map(function (r) {
      var obj = {};
      names.forEach(function (name, k) { obj[name] = conv(r[k] == null ? '' : r[k]); });
      for (var x = names.length; x < r.length; x++) obj['列' + (x + 1)] = conv(r[x]);
      return obj;
    });
    return JSON.stringify(list, null, indent);
  }

  /** 見出しの名前をそろえる（空は「列N」、重なりは「名前_2」） */
  function uniqueNames(head) {
    var seen = new Map();
    return head.map(function (h, k) {
      var base = String(h).trim() === '' ? '列' + (k + 1) : String(h), name = base, c = 1;
      while (seen.has(name)) { c++; name = base + '_' + c; }
      seen.set(name, true);
      return name;
    });
  }

  /**
   * ファイルのバイト列を文字にする。UTF-8（BOM あり・なし）として読めなければ Shift_JIS（Windows-31J）として読む
   * @param {Uint8Array} bytes
   * @returns {{text: string, encoding: string}}
   */
  function decode(bytes) {
    var bomless = bytes;
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8（BOM あり）' };
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' };
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bomless), encoding: 'UTF-8' }; } catch (e) { /* 次へ */ }
    try { return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'Shift_JIS' }; } catch (e) { /* 次へ */ }
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8（読めない字あり）' };
  }

  var api = { parse: parse, detect: detect, stringify: stringify, toJson: toJson, uniqueNames: uniqueNames, decode: decode, NAMES: NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HenkanCsv = api;
})(typeof self !== 'undefined' ? self : this);
