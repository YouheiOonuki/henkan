// ===========================
// JSON の検証・整形（画面から切り離した純粋関数。DOM に触らない）
// ブラウザ・Worker では self.HenkanJson、Node（テスト）では module.exports
//
// 自前の読み取り器を使う理由:
// - 数と文字列を「書いてあったとおり」に残す。JSON.parse を通すと 12345678901234567890 は
//   12345678901234567000 に、1.10 は 1.1 に、"あ" は "あ" になる（RFC 8259 6 章: 数の精度は実装しだい）
// - 誤りの位置（行・列）と理由を、ブラウザによらず同じ日本語で出す
// 文法は RFC 8259（空白は スペース・タブ・LF・CR の 4 つだけ）。先頭の BOM は読み飛ばして知らせる（8.1 章の MAY）
// ===========================
(function (root) {
  'use strict';

  var MAX_DEPTH = 2000;

  function JsonError(message, index, hint) { this.message = message; this.index = index; this.hint = hint || ''; }

  /** index（UTF-16 の位置）→ 行・列（列は字の数。1 から） */
  function lineCol(text, index) {
    var line = 1, start = 0;
    for (var i = 0; i < index && i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) { line++; start = i + 1; }
    }
    var col = 1;
    for (var k = start; k < index && k < text.length; k++) {
      var cc = text.charCodeAt(k);
      if (cc >= 0xD800 && cc <= 0xDBFF && k + 1 < index) k++;   // サロゲートペアは 1 字
      col++;
    }
    return { line: line, col: col };
  }

  function show(ch) {
    if (ch === undefined || ch === '') return '入力の終わり';
    if (ch === ' ') return '半角スペース';
    if (ch === '　') return '全角スペース';
    if (ch === '\t') return 'タブ';
    if (ch === '\n' || ch === '\r') return '改行';
    return '「' + ch + '」';
  }

  /**
   * 読み取る
   * @returns {{ok: true, value: object, bom: boolean, dupKeys: Array} | {ok: false, error: {message, hint, index, line, col}}}
   *   value は { t: 'obj'|'arr'|'str'|'num'|'lit', raw?: string, items?: [...], entries?: [[keyRaw, keyValue, node]] }
   */
  function parse(text) {
    var s = String(text == null ? '' : text), i = 0, n = s.length, bom = false, dupKeys = [];
    if (s.charCodeAt(0) === 0xFEFF) { bom = true; i = 1; }

    function ws() {
      while (i < n) {
        var c = s.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13) i++;
        else break;
      }
      // 空白ではないが空白に見えるもの・コメント
      var ch = s.charAt(i);
      if (ch === '　' || ch === ' ' || ch === '﻿') throw new JsonError(show(ch) + 'は JSON では空白として使えません。', i, '半角スペースに置き換えてください。');
      if (ch === '/' && (s.charAt(i + 1) === '/' || s.charAt(i + 1) === '*')) throw new JsonError('コメント（' + s.substr(i, 2) + '）は JSON では書けません。', i, 'コメントを消してください（JSONC・JSON5 の書き方です）。');
    }

    function value(depth) {
      if (depth > MAX_DEPTH) throw new JsonError('入れ子が深すぎます（' + MAX_DEPTH + ' 段まで）。', i);
      ws();
      var ch = s.charAt(i);
      if (ch === '{') return object(depth);
      if (ch === '[') return array(depth);
      if (ch === '"') return { t: 'str', raw: string() };
      if (ch === '-' || (ch >= '0' && ch <= '9')) return { t: 'num', raw: number() };
      if (s.startsWith('true', i)) { i += 4; return { t: 'lit', raw: 'true' }; }
      if (s.startsWith('false', i)) { i += 5; return { t: 'lit', raw: 'false' }; }
      if (s.startsWith('null', i)) { i += 4; return { t: 'lit', raw: 'null' }; }
      if (i >= n) throw new JsonError('値がありません（入力が途中で終わっています）。', i);
      if (ch === "'") throw new JsonError('文字列が「\'」（シングルクォート）で囲まれています。', i, 'JSON の文字列は「"」（ダブルクォート）で囲みます。');
      if (ch === '“' || ch === '”') throw new JsonError('全角の引用符' + show(ch) + 'があります。', i, '半角の「"」に置き換えてください。');
      if (ch === '+' || ch === '.') throw new JsonError(show(ch) + 'で始まる数は JSON では書けません。', i, ch === '+' ? '「+」を消してください。' : '「0.5」のように 0 を付けてください。');
      var word = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 40));
      if (word) {
        var w = word[0];
        if (w === 'True' || w === 'False' || w === 'TRUE' || w === 'FALSE' || w === 'Null' || w === 'NULL' || w === 'None') throw new JsonError(show(w) + 'は JSON では使えません。', i, 'true・false・null は小文字で書きます。');
        if (w === 'NaN' || w === 'Infinity' || w === 'undefined') throw new JsonError(show(w) + 'は JSON の値として書けません。', i, 'null か文字列にしてください。');
        throw new JsonError('値として読めない語' + show(w) + 'があります。', i, '文字列なら「"」で囲んでください。');
      }
      if (ch === ',' ) throw new JsonError('値が来るところに「,」があります。', i, 'カンマが 2 つ続いているか、最初の値が抜けています。');
      if (ch === ']' || ch === '}') throw new JsonError('値が来るところに' + show(ch) + 'があります。', i);
      throw new JsonError('値が来るところに' + show(ch) + 'があります。', i);
    }

    function object(depth) {
      var open = i, entries = [], seen = new Map();
      i++;
      ws();
      if (s.charAt(i) === '}') { i++; return { t: 'obj', entries: entries }; }
      for (;;) {
        ws();
        var ch = s.charAt(i);
        if (ch !== '"') {
          if (ch === '}' && entries.length) throw new JsonError('「}」の前に余分な「,」があります。', lastComma, 'JSON では最後の項目の後ろにカンマを書けません。');
          if (ch === "'") throw new JsonError('名前（キー）が「\'」で囲まれています。', i, '「"」で囲んでください。');
          if (/[A-Za-z_$]/.test(ch)) throw new JsonError('名前（キー）が「"」で囲まれていません。', i, '{"name": 1} のように名前も「"」で囲みます。');
          if (i >= n) throw new JsonError('「{」が閉じていません。', open, lineCol(s, open).line + ' 行目の「{」に対応する「}」がありません。');
          throw new JsonError('名前（キー）が来るところに' + show(ch) + 'があります。', i);
        }
        var kpos = i, kraw = string(), kval = decodeString(kraw);
        if (seen.has(kval)) dupKeys.push({ key: kval, index: kpos, first: seen.get(kval) }); else seen.set(kval, kpos);
        ws();
        if (s.charAt(i) !== ':') {
          if (s.charAt(i) === '：') throw new JsonError('全角の「：」があります。', i, '半角の「:」に置き換えてください。');
          throw new JsonError('名前の後ろに「:」がありません（' + show(s.charAt(i)) + 'があります）。', i);
        }
        i++;
        var v = value(depth + 1);
        entries.push([kraw, kval, v]);
        ws();
        ch = s.charAt(i);
        if (ch === ',') { var lastComma = i; i++; continue; }
        if (ch === '}') { i++; return { t: 'obj', entries: entries }; }
        if (i >= n) throw new JsonError('「{」が閉じていません。', open, lineCol(s, open).line + ' 行目の「{」に対応する「}」がありません。');
        if (ch === '"') throw new JsonError('項目のあいだに「,」がありません。', i, '前の値のあとにカンマを足してください。');
        if (ch === '、' || ch === '，') throw new JsonError('全角の' + show(ch) + 'があります。', i, '半角の「,」に置き換えてください。');
        throw new JsonError('「,」か「}」が来るところに' + show(ch) + 'があります。', i);
      }
    }

    function array(depth) {
      var open = i, items = [], lastComma = -1;
      i++;
      ws();
      if (s.charAt(i) === ']') { i++; return { t: 'arr', items: items }; }
      for (;;) {
        ws();
        if (s.charAt(i) === ']' && items.length) throw new JsonError('「]」の前に余分な「,」があります。', lastComma, 'JSON では最後の要素の後ろにカンマを書けません。');
        if (i >= n) throw new JsonError('「[」が閉じていません。', open, lineCol(s, open).line + ' 行目の「[」に対応する「]」がありません。');
        items.push(value(depth + 1));
        ws();
        var ch = s.charAt(i);
        if (ch === ',') { lastComma = i; i++; continue; }
        if (ch === ']') { i++; return { t: 'arr', items: items }; }
        if (i >= n) throw new JsonError('「[」が閉じていません。', open, lineCol(s, open).line + ' 行目の「[」に対応する「]」がありません。');
        if (ch === '}') throw new JsonError('「]」が来るところに「}」があります。', i, lineCol(s, open).line + ' 行目の「[」を閉じるのは「]」です。');
        if (ch === '、' || ch === '，') throw new JsonError('全角の' + show(ch) + 'があります。', i, '半角の「,」に置き換えてください。');
        throw new JsonError('要素のあいだに「,」がありません（' + show(ch) + 'があります）。', i, '前の値のあとにカンマを足してください。');
      }
    }

    // 文字列の生の形（引用符を含む）を返す
    function string() {
      var start = i;
      i++;
      for (;;) {
        if (i >= n) throw new JsonError('文字列が閉じていません。', start, lineCol(s, start).line + ' 行目で始まる文字列に、閉じる「"」がありません。');
        var c = s.charCodeAt(i);
        if (c === 34) { i++; return s.slice(start, i); }
        if (c === 92) {
          var e = s.charAt(i + 1);
          if ('"\\/bfnrt'.indexOf(e) >= 0 && e !== '') { i += 2; continue; }
          if (e === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(s.substr(i + 2, 4))) throw new JsonError('「\\u」の後ろは 16 進の 4 桁です。', i);
            i += 6; continue;
          }
          throw new JsonError('文字列の中の「\\' + e + '」は JSON のエスケープにありません。', i, '「\\」そのものを書くときは「\\\\」と 2 つ重ねます。');
        }
        if (c < 0x20) {
          if (c === 10 || c === 13) throw new JsonError('文字列の中に改行があります。', i, '改行は「\\n」と書きます。文字列の閉じる「"」を忘れていないかも見てください。');
          if (c === 9) throw new JsonError('文字列の中にタブがあります。', i, 'タブは「\\t」と書きます。');
          throw new JsonError('文字列の中に制御文字（U+' + ('000' + c.toString(16).toUpperCase()).slice(-4) + '）があります。', i);
        }
        i++;
      }
    }

    function number() {
      var start = i;
      if (s.charAt(i) === '-') i++;
      if (s.charAt(i) === '0') {
        i++;
        if (/[0-9]/.test(s.charAt(i))) throw new JsonError('数の先頭に 0 を付けられません（「' + s.slice(start, i + 1) + '…」）。', start, '郵便番号や電話番号のように 0 で始まるものは、文字列（"0123"）にしてください。');
      } else if (/[1-9]/.test(s.charAt(i))) {
        while (/[0-9]/.test(s.charAt(i))) i++;
      } else throw new JsonError('「-」の後ろに数字がありません。', i);
      if (s.charAt(i) === '.') {
        i++;
        if (!/[0-9]/.test(s.charAt(i))) throw new JsonError('小数点の後ろに数字がありません。', i, '「1.」ではなく「1.0」か「1」と書きます。');
        while (/[0-9]/.test(s.charAt(i))) i++;
      }
      if (s.charAt(i) === 'e' || s.charAt(i) === 'E') {
        i++;
        if (s.charAt(i) === '+' || s.charAt(i) === '-') i++;
        if (!/[0-9]/.test(s.charAt(i))) throw new JsonError('指数（e）の後ろに数字がありません。', i);
        while (/[0-9]/.test(s.charAt(i))) i++;
      }
      return s.slice(start, i);
    }

    try {
      ws();
      if (i >= n) throw new JsonError('JSON が空です。', i);
      var v = value(0);
      ws();
      if (i < n) {
        var ch = s.charAt(i);
        if (ch === ',') throw new JsonError('JSON の終わりのあとに「,」があります。', i, '全体を [ ] で囲むと、いくつもの値を並べられます。');
        if (ch === '}' || ch === ']') throw new JsonError('閉じかっこ' + show(ch) + 'が多すぎます。', i);
        throw new JsonError('JSON の終わりのあとに、まだ' + show(ch) + 'が続いています。', i, '1 行に 1 つの JSON（JSON Lines）なら、行ごとに分けて貼ってください。');
      }
      return { ok: true, value: v, bom: bom, dupKeys: dupKeys.map(function (d) { var p = lineCol(s, d.index); return { key: d.key, line: p.line, col: p.col }; }) };
    } catch (e) {
      if (!(e instanceof JsonError)) throw e;
      var p = lineCol(s, e.index);
      return { ok: false, error: { message: e.message, hint: e.hint, index: e.index, line: p.line, col: p.col } };
    }
  }

  /** 文字列の生の形 → 値（JSON.parse は 1 つの文字列なら安全に使える） */
  function decodeString(raw) { return JSON.parse(raw); }

  /**
   * 整形する。indent は 0（1 行に詰める）・2・4・'\t'。sortKeys なら名前の順（UTF-16 の符号の順）に並べる。
   * 数と文字列は書いてあったとおりに出す
   */
  function format(node, o) {
    o = o || {};
    var ind = o.indent === '\t' ? '\t' : ' '.repeat(Number(o.indent) || 0), pretty = ind !== '', out = [];
    function walk(v, pad) {
      if (v.t === 'obj') {
        if (!v.entries.length) { out.push('{}'); return; }
        var es = v.entries;
        if (o.sortKeys) es = es.slice().sort(function (x, y) { return x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0; });
        out.push('{');
        es.forEach(function (e, k) {
          if (k) out.push(',');
          if (pretty) out.push('\n', pad + ind);
          out.push(e[0], pretty ? ': ' : ':');
          walk(e[2], pad + ind);
        });
        if (pretty) out.push('\n', pad);
        out.push('}');
      } else if (v.t === 'arr') {
        if (!v.items.length) { out.push('[]'); return; }
        out.push('[');
        v.items.forEach(function (it, k) {
          if (k) out.push(',');
          if (pretty) out.push('\n', pad + ind);
          walk(it, pad + ind);
        });
        if (pretty) out.push('\n', pad);
        out.push(']');
      } else out.push(v.raw);
    }
    walk(node, '');
    return out.join('');
  }

  /** 数の中で、ふつうの JavaScript（倍精度）に読むと値が変わるもの */
  function lossyNumbers(node, limit) {
    var found = [];
    (function walk(v) {
      if (found.length >= (limit || 5)) return;
      if (v.t === 'obj') v.entries.forEach(function (e) { walk(e[2]); });
      else if (v.t === 'arr') v.items.forEach(walk);
      else if (v.t === 'num' && /^-?\d+$/.test(v.raw) && !Number.isSafeInteger(Number(v.raw))) found.push(v.raw);
    })(node);
    return found;
  }

  /**
   * 表（CSV 用の行）にする。一番外が配列で、要素がオブジェクト（名前 → 値）か配列のとき
   * - オブジェクトの入れ子は「親.子」の列に広げる。入れ子の配列は JSON の文字列のまま 1 つのセルに
   * - 列の順は、最初に出てきた順
   * @returns {{ok: true, rows: string[][]} | {ok: false, error: string}}
   */
  function toRows(node) {
    if (node.t !== 'arr') return { ok: false, error: '一番外が配列（[ … ]）のときだけ表にできます。' };
    if (!node.items.length) return { ok: false, error: '配列が空です。' };
    function cell(v) {
      if (v.t === 'str') return decodeString(v.raw);
      if (v.t === 'num' || v.t === 'lit') return v.raw === 'null' ? '' : v.raw;
      return format(v, { indent: 0 });
    }
    if (node.items.every(function (x) { return x.t === 'arr'; })) {
      return { ok: true, header: false, rows: node.items.map(function (r) { return r.items.map(cell); }) };
    }
    if (!node.items.every(function (x) { return x.t === 'obj'; })) return { ok: false, error: '配列の要素がオブジェクト（{ … }）か配列（[ … ]）にそろっているときだけ表にできます。' };
    var cols = [], index = new Map();
    var flat = node.items.map(function (obj) {
      var row = new Map();
      (function walk(o, prefix) {
        o.entries.forEach(function (e) {
          var name = prefix + e[1];
          if (e[2].t === 'obj' && e[2].entries.length) { walk(e[2], name + '.'); return; }
          if (!index.has(name)) { index.set(name, cols.length); cols.push(name); }
          row.set(name, cell(e[2]));
        });
      })(obj, '');
      return row;
    });
    return { ok: true, header: true, rows: [cols].concat(flat.map(function (r) { return cols.map(function (c) { return r.has(c) ? r.get(c) : ''; }); })) };
  }

  /** 値の数と深さ（結果の 1 行に出す） */
  function stats(node) {
    var count = 0, depth = 0;
    (function walk(v, d) {
      count++; if (d > depth) depth = d;
      if (v.t === 'obj') v.entries.forEach(function (e) { walk(e[2], d + 1); });
      else if (v.t === 'arr') v.items.forEach(function (x) { walk(x, d + 1); });
    })(node, 0);
    return { count: count, depth: depth, kind: node.t };
  }

  var api = { parse: parse, format: format, toRows: toRows, lossyNumbers: lossyNumbers, stats: stats, lineCol: lineCol };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HenkanJson = api;
})(typeof self !== 'undefined' ? self : this);
