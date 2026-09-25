// ===========================
// 全角・半角・かなの変換（画面から切り離した純粋関数。DOM に触らない）
// ブラウザ・Worker では self.HenkanKana、Node（テスト）では module.exports
//
// 対応表（README「全角・半角の対応表」と guide にも同じことを書く）:
// - 英数・記号: U+FF01〜U+FF5E（全角）⇔ U+0021〜U+007E（半角）の 1 対 1 だけ。
//   ￥（U+FFE5）・￣（U+FFE3）・〜（U+301C 波ダッシュ）などはこの範囲の外なので変えない
// - 空白: U+3000（全角スペース）⇔ U+0020
// - カタカナ: 半角カタカナ（U+FF61〜U+FF9F）⇔ 全角。濁点・半濁点（ﾞ ﾟ）は前の字と 1 文字に合わせる（ｶﾞ→ガ、ﾊﾟ→パ、ｳﾞ→ヴ、ﾜﾞ→ヷ、ｦﾞ→ヺ）。
//   前の字と合わせられない ﾞ ﾟ は ゛ ゜（U+309B・U+309C）にする（NFKC は結合用の U+3099・U+309A にしてしまう）
//   全角 → 半角で、半角の字が無いもの（ヰ ヱ ヮ ヵ ヶ ヸ ヹ）は変えずに残し、数を返す（別の字に置き換えない）
// - ひらがな ⇔ カタカナ: ぁ〜ゖ ⇔ ァ〜ヶ、ゝゞ ⇔ ヽヾ。ヷ ヸ ヹ ヺ はひらがなが無いので残す
// ===========================
(function (root) {
  'use strict';

  // 半角カタカナ（U+FF61〜U+FF9D）→ 全角。添え字 = コード − 0xFF61
  var HALF_KANA = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
  var H2F = {}, F2H = {};
  for (var i = 0; i < HALF_KANA.length; i++) {
    var h = String.fromCharCode(0xFF61 + i), f = HALF_KANA.charAt(i);
    H2F[h] = f; F2H[f] = h;
  }
  H2F['ﾞ'] = '゛'; H2F['ﾟ'] = '゜';
  F2H['゛'] = 'ﾞ'; F2H['゜'] = 'ﾟ';
  F2H['゙'] = 'ﾞ'; F2H['゚'] = 'ﾟ';   // 結合用の濁点・半濁点（分解された形の ガ など）
  // 濁点・半濁点つき: 全角 1 文字 ⇔ 半角 2 文字
  var VOICED = {}, VOICED_REV = {};
  function addVoiced(base, list, mark) {
    for (var k = 0; k < base.length; k++) {
      var full = list.charAt(k), half = F2H[base.charAt(k)] + mark;
      VOICED[half] = full; VOICED_REV[full] = half;
    }
  }
  addVoiced('カキクケコサシスセソタチツテトハヒフヘホ', 'ガギグゲゴザジズゼゾダヂヅデドバビブベボ', 'ﾞ');
  addVoiced('ハヒフヘホ', 'パピプペポ', 'ﾟ');
  addVoiced('ウワヲ', 'ヴヷヺ', 'ﾞ');
  // 半角の字が無いカタカナ（全角 → 半角で残すもの）
  var NO_HALF = 'ヰヱヮヵヶヸヹヽヾ';

  function isAlnum(c) { return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A); }

  /**
   * 変換する。opts の各項目は 'none'（変えない）か、下の値
   *   alnum:  'half' | 'full'   英字と数字
   *   symbol: 'half' | 'full'   ASCII の記号（! " # … ~）と、その全角
   *   space:  'half' | 'full'   空白（U+0020 ⇔ U+3000）
   *   kana:   'half' | 'full'   カタカナと、半角カナの区画にある 。「」、・ー ゛゜
   *   hira:   'kata' | 'hira'   ひらがな ⇔ カタカナ（kana の前にかける）
   *   tidy:   { trimEnd, collapseSpaces, blankLines: 'keep'|'one'|'none', eol: 'keep'|'lf'|'crlf', trimEdges }
   *   nfkc:   true なら最後に String.prototype.normalize('NFKC')
   * @returns {{text: string, changed: number, pairs: Object<string, number>, kept: Object<string, number>}}
   *   pairs は「元→後」ごとの数（表示用）、kept は半角にできずに残したカタカナの数
   */
  function convert(text, opts) {
    opts = opts || {};
    var s = String(text == null ? '' : text);
    var pairs = {}, kept = {}, changed = 0;
    function note(from, to) { var k = from + '→' + to; pairs[k] = (pairs[k] || 0) + 1; changed++; }

    // ひらがな → カタカナは幅より先に（がっこう → ｶﾞｯｺｳ）、カタカナ → ひらがなは幅より後に（ｶﾞｯｺｳ → がっこう）
    var widthOn = opts.alnum === 'half' || opts.alnum === 'full' || opts.symbol === 'half' || opts.symbol === 'full' ||
        opts.space === 'half' || opts.space === 'full' || opts.kana === 'half' || opts.kana === 'full';
    if (opts.hira === 'kata') s = hiraKata(s, 'kata', note);
    if (widthOn) s = width(s, opts, note, kept);
    if (opts.hira === 'hira') s = hiraKata(s, 'hira', note);
    if (opts.tidy) s = tidy(s, opts.tidy);   // 空白・改行の整理は字の置き換えではないので pairs に入れない
    if (opts.nfkc) {
      var n = s.normalize('NFKC');
      if (n !== s) pairs['NFKC 正規化'] = (pairs['NFKC 正規化'] || 0) + 1;
      s = n;
    }
    return { text: s, changed: changed, pairs: pairs, kept: kept };
  }

  function hiraKata(s, dir, note) {
    var out = [], from = dir === 'kata' ? 0x3041 : 0x30A1, to = dir === 'kata' ? 0x3096 : 0x30F6, d = dir === 'kata' ? 0x60 : -0x60;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), r = null;
      if (c >= from && c <= to) r = String.fromCharCode(c + d);
      else if (dir === 'kata' && (c === 0x309D || c === 0x309E)) r = String.fromCharCode(c + 0x60);   // ゝゞ → ヽヾ
      else if (dir === 'hira' && (c === 0x30FD || c === 0x30FE)) r = String.fromCharCode(c - 0x60);   // ヽヾ → ゝゞ
      if (r !== null) { note(s.charAt(i), r); out.push(r); } else out.push(s.charAt(i));
    }
    return out.join('');
  }

  function width(s, o, note, kept) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), c = s.charCodeAt(i), r = null;
      // 英数・記号（全角 → 半角）
      if (c >= 0xFF01 && c <= 0xFF5E) {
        var a = c - 0xFEE0;
        if (isAlnum(a) ? o.alnum === 'half' : o.symbol === 'half') r = String.fromCharCode(a);
      } else if (c >= 0x21 && c <= 0x7E) {
        if (isAlnum(c) ? o.alnum === 'full' : o.symbol === 'full') r = String.fromCharCode(c + 0xFEE0);
      } else if (c === 0x3000) {
        if (o.space === 'half') r = ' ';
      } else if (c === 0x20) {
        if (o.space === 'full') r = '　';
      } else if (c >= 0xFF61 && c <= 0xFF9F) {
        // 半角カナ → 全角（後ろの ﾞ ﾟ と合わせる）
        if (o.kana === 'full') {
          var two = s.substr(i, 2);
          if (VOICED[two]) { note(two, VOICED[two]); out.push(VOICED[two]); i++; continue; }
          r = H2F[ch];
        }
      } else if (o.kana === 'half') {
        // 全角カナ → 半角。分解された形（カ＋U+3099）も合わせて 1 つとして数える
        if (VOICED_REV[ch]) r = VOICED_REV[ch];
        else if (F2H[ch]) r = F2H[ch];
        else if (NO_HALF.indexOf(ch) >= 0) kept[ch] = (kept[ch] || 0) + 1;
        if (r !== null && F2H[ch] && (s.charAt(i + 1) === '゙' || s.charAt(i + 1) === '゚')) {
          var mark = F2H[s.charAt(i + 1)];
          note(ch + s.charAt(i + 1), r + mark); out.push(r + mark); i++; continue;
        }
      }
      if (r !== null && r !== ch) { note(ch, r); out.push(r); } else out.push(ch);
    }
    return out.join('');
  }

  /** 空白・改行の整理 */
  function tidy(s, t) {
    var eol = /\r\n/.test(s) ? '\r\n' : '\n';
    if (t.eol === 'lf') eol = '\n'; else if (t.eol === 'crlf') eol = '\r\n';
    var lines = s.split(/\r\n|\n|\r/);
    if (t.collapseSpaces) lines = lines.map(function (l) { return l.replace(/[ \t　]{2,}/g, function (m) { return m.charAt(0); }); });
    if (t.trimEnd) lines = lines.map(function (l) { return l.replace(/[ \t　]+$/, ''); });
    if (t.blankLines === 'one' || t.blankLines === 'none') {
      var out = [], prevBlank = false;
      lines.forEach(function (l) {
        var blank = /^[ \t　]*$/.test(l);
        if (blank && (t.blankLines === 'none' || prevBlank)) return;
        out.push(l); prevBlank = blank;
      });
      lines = out;
    }
    if (t.trimEdges) {
      while (lines.length > 1 && /^[ \t　]*$/.test(lines[0])) lines.shift();
      while (lines.length > 1 && /^[ \t　]*$/.test(lines[lines.length - 1])) lines.pop();
    }
    return lines.join(eol);
  }

  /**
   * 差分で「全角・半角を同じとみなす」ための比べる形（表示には使わない）。
   * 英数記号と空白は半角に、半角カナは全角に（濁点を合わせる）
   */
  function foldWidth(s) {
    return width(String(s), { alnum: 'half', symbol: 'half', space: 'half', kana: 'full' }, function () {}, {});
  }

  var api = { convert: convert, foldWidth: foldWidth, tidy: tidy, NO_HALF: NO_HALF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HenkanKana = api;
})(typeof self !== 'undefined' ? self : this);
