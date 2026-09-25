// ===========================
// テキストの差分（画面から切り離した純粋関数。DOM に触らない）
// ブラウザ・Worker では self.HenkanDiff、Node（テスト）では module.exports
//
// 手法: Myers の O(ND) 差分アルゴリズムの線形空間版（中央のスネークで分割）。
//   E. W. Myers, "An O(ND) Difference Algorithm and Its Variations", Algorithmica 1 (1986) 251-266。
//   分割の書き方は GNU diffutils の diffseq.h（compareseq / diag）と同じ形で、コードは自分で書いた。
// 速さのための工夫（どれも「最短の差分」を変えないもの。4 だけが例外で、そのときは approx を立てる）:
//   1. 前後の一致をはじめに切り落とす
//   2. 相手側に 1 回も出てこない行（字）は、必ず削除・追加なので、比べる列から外す
//   3. 比べる単位（行・字）は整数に置き換えて比べる
//   4. 1 回の分割で探す深さに上限（入力が大きいほど小さい）。超えたら GNU diff と同じ近似で分ける
// ===========================
(function (root) {
  'use strict';

  var Kana = (typeof module !== 'undefined' && module.exports) ? require('./kana.js') : root.HenkanKana;

  /**
   * 整数の列 a・b の差分。削除・追加の印（1）を返す
   * @returns {{da: Uint8Array, db: Uint8Array, approx: boolean}}
   */
  function compare(a, b) {
    var n = a.length, m = b.length;
    var da = new Uint8Array(n), db = new Uint8Array(m);
    // 2. 相手に無い要素を外す
    var inB = new Set(), inA = new Set(), i;
    for (i = 0; i < m; i++) inB.add(b[i]);
    for (i = 0; i < n; i++) inA.add(a[i]);
    var ia = [], ib = [];
    for (i = 0; i < n; i++) { if (inB.has(a[i])) ia.push(i); else da[i] = 1; }
    for (i = 0; i < m; i++) { if (inA.has(b[i])) ib.push(i); else db[i] = 1; }
    var A = new Int32Array(ia.length), B = new Int32Array(ib.length);
    for (i = 0; i < ia.length; i++) A[i] = a[ia[i]];
    for (i = 0; i < ib.length; i++) B[i] = b[ib[i]];
    var N = A.length, M = B.length;
    var fa = new Uint8Array(N), fb = new Uint8Array(M);
    var approx = false;
    if (N && M) approx = seq(A, B, fa, fb);
    else { fa.fill(1); fb.fill(1); }
    for (i = 0; i < N; i++) if (fa[i]) da[ia[i]] = 1;
    for (i = 0; i < M; i++) if (fb[i]) db[ib[i]] = 1;
    return { da: da, db: db, approx: approx };
  }

  // 線形空間の Myers。再帰は明示のスタックで（深い再帰でスタックがあふれないように）
  function seq(A, B, fa, fb) {
    var N = A.length, M = B.length, off = M + 1, size = N + M + 3;
    var fd = new Int32Array(size), bd = new Int32Array(size);
    var BIG = 0x3fffffff, approx = false;
    // 4. 深さの上限。小さい入力では実質無制限（最短）、大きい入力では 1 回の探索を (N+M)×上限 に抑える
    var tooExpensive = Math.max(256, Math.floor(4e7 / (N + M)));
    var stack = [0, N, 0, M];
    while (stack.length) {
      var ylim = stack.pop(), yoff = stack.pop(), xlim = stack.pop(), xoff = stack.pop();
      while (xoff < xlim && yoff < ylim && A[xoff] === B[yoff]) { xoff++; yoff++; }
      while (xlim > xoff && ylim > yoff && A[xlim - 1] === B[ylim - 1]) { xlim--; ylim--; }
      if (xoff === xlim) { for (var y0 = yoff; y0 < ylim; y0++) fb[y0] = 1; continue; }
      if (yoff === ylim) { for (var x0 = xoff; x0 < xlim; x0++) fa[x0] = 1; continue; }
      // 中央のスネークを探す
      var dmin = xoff - ylim, dmax = xlim - yoff, fmid = xoff - yoff, bmid = xlim - ylim;
      var fmin = fmid, fmax = fmid, bmin = bmid, bmax = bmid, odd = (fmid - bmid) & 1;
      fd[fmid + off] = xoff; bd[bmid + off] = xlim;
      var sx = -1, sy = -1, d, x, y, tlo, thi;
      for (var c = 1; ; c++) {
        if (fmin > dmin) fd[--fmin - 1 + off] = -1; else ++fmin;
        if (fmax < dmax) fd[++fmax + 1 + off] = -1; else --fmax;
        for (d = fmax; d >= fmin; d -= 2) {
          tlo = fd[d - 1 + off]; thi = fd[d + 1 + off];
          x = tlo >= thi ? tlo + 1 : thi; y = x - d;
          while (x < xlim && y < ylim && A[x] === B[y]) { x++; y++; }
          fd[d + off] = x;
          if (odd && bmin <= d && d <= bmax && bd[d + off] <= x) { sx = x; sy = y; break; }
        }
        if (sx >= 0) break;
        if (bmin > dmin) bd[--bmin - 1 + off] = BIG; else ++bmin;
        if (bmax < dmax) bd[++bmax + 1 + off] = BIG; else --bmax;
        for (d = bmax; d >= bmin; d -= 2) {
          tlo = bd[d - 1 + off]; thi = bd[d + 1 + off];
          x = tlo < thi ? tlo : thi - 1; y = x - d;
          while (x > xoff && y > yoff && A[x - 1] === B[y - 1]) { x--; y--; }
          bd[d + off] = x;
          if (!odd && fmin <= d && d <= fmax && x <= fd[d + off]) { sx = x; sy = y; break; }
        }
        if (sx >= 0) break;
        if (c >= tooExpensive) {
          // GNU diff と同じ近似: いちばん進んだ対角線で分ける（最短とは限らない）
          approx = true;
          var fxy = -1, fx = 0, bxy = BIG, bx = 0;
          for (d = fmax; d >= fmin; d -= 2) {
            x = Math.min(fd[d + off], xlim); y = x - d;
            if (ylim < y) { x = ylim + d; y = ylim; }
            if (fxy < x + y) { fxy = x + y; fx = x; }
          }
          for (d = bmax; d >= bmin; d -= 2) {
            x = Math.max(xoff, bd[d + off]); y = x - d;
            if (y < yoff) { x = yoff + d; y = yoff; }
            if (x + y < bxy) { bxy = x + y; bx = x; }
          }
          if ((xlim + ylim) - bxy < fxy - (xoff + yoff)) { sx = fx; sy = fxy - fx; } else { sx = bx; sy = bxy - bx; }
          break;
        }
      }
      stack.push(sx, xlim, sy, ylim);
      stack.push(xoff, sx, yoff, sy);
    }
    return approx;
  }

  /** 文字列の列を整数の列にする（同じ比べる形 → 同じ番号） */
  function intern(keysA, keysB) {
    var map = new Map(), a = new Int32Array(keysA.length), b = new Int32Array(keysB.length), i, id;
    for (i = 0; i < keysA.length; i++) { id = map.get(keysA[i]); if (id === undefined) { id = map.size; map.set(keysA[i], id); } a[i] = id; }
    for (i = 0; i < keysB.length; i++) { id = map.get(keysB[i]); if (id === undefined) { id = map.size; map.set(keysB[i], id); } b[i] = id; }
    return { a: a, b: b };
  }

  /** 比べる形（表示は元の文字のまま） */
  function keyFn(o) {
    o = o || {};
    return function (s) {
      if (o.width) s = Kana.foldWidth(s);
      if (o.space) s = s.replace(/\s+/g, '');   // \s は全角スペース（U+3000）も含む
      if (o.caseless) s = s.toLowerCase();
      return s;
    };
  }

  /** 行に分ける。改行は CRLF・LF・CR のどれでもよい */
  function splitLines(text) {
    var t = String(text == null ? '' : text);
    var crlf = (t.match(/\r\n/g) || []).length, lf = (t.match(/\n/g) || []).length - crlf, cr = (t.match(/\r(?!\n)/g) || []).length;
    var eol = crlf + lf + cr === 0 ? 'なし' : crlf >= lf && crlf >= cr ? 'CRLF' : lf >= cr ? 'LF' : 'CR';
    if (t === '') return { lines: [], finalEol: true, eol: eol };
    var lines = t.split(/\r\n|\n|\r/), finalEol = lines[lines.length - 1] === '';
    if (finalEol) lines.pop();
    return { lines: lines, finalEol: finalEol, eol: eol };
  }

  /** 印（da・db）から、同じ所と変わった所の並びを作る */
  function hunksOf(da, db) {
    var out = [], i = 0, j = 0, n = da.length, m = db.length;
    while (i < n || j < m) {
      var i0 = i, j0 = j;
      while (i < n && j < m && !da[i] && !db[j]) { i++; j++; }
      if (i > i0) out.push({ t: 'eq', a0: i0, a1: i, b0: j0, b1: j });
      i0 = i; j0 = j;
      while (i < n && da[i]) i++;
      while (j < m && db[j]) j++;
      if (i > i0 || j > j0) out.push({ t: 'ch', a0: i0, a1: i, b0: j0, b1: j });
      if (i === i0 && j === j0 && (i < n || j < m)) {   // 念のため（ここには来ない）
        if (i < n) { da[i] = 1; } else { db[j] = 1; }
      }
    }
    return out;
  }

  /**
   * 行単位の差分。変わった行の組には、字単位の強調（inline）を付ける
   * @param {{space?:boolean, caseless?:boolean, width?:boolean, inline?:boolean}} o
   */
  function diffLines(textA, textB, o) {
    o = o || {};
    var A = splitLines(textA), B = splitLines(textB), key = keyFn(o);
    var ids = intern(A.lines.map(key), B.lines.map(key));
    var r = compare(ids.a, ids.b);
    var hunks = hunksOf(r.da, r.db), add = 0, del = 0, pairsDone = 0;
    hunks.forEach(function (h) {
      if (h.t !== 'ch') return;
      del += h.a1 - h.a0; add += h.b1 - h.b0;
      if (o.inline === false) return;
      // 同じ位置の行どうしを字単位で比べ、似ている組だけ強調する
      var k = Math.min(h.a1 - h.a0, h.b1 - h.b0);
      for (var p = 0; p < k && pairsDone < 3000; p++) {
        var la = A.lines[h.a0 + p], lb = B.lines[h.b0 + p];
        if (la.length > 3000 || lb.length > 3000) continue;
        pairsDone++;
        var c = diffChars(la, lb, o);
        if (c.same / Math.max(1, Math.max(c.lenA, c.lenB)) < 0.35) continue;   // ほとんど違う行は行ごとの色だけ
        (h.inline || (h.inline = []))[p] = { a: c.a, b: c.b };
      }
    });
    return {
      mode: 'line', hunks: hunks, linesA: A.lines, linesB: B.lines, approx: r.approx,
      add: add, del: del, same: A.lines.length - del,
      eolA: A.eol, eolB: B.eol, finalEolA: A.finalEol, finalEolB: B.finalEol,
    };
  }

  /** 字に分ける。結合する濁点・半濁点・合字の印は前の字と 1 つにする */
  var JOIN = /[̀-゙゚ͯﾞﾟ︀-️‍]/;
  function tokens(s) {
    var out = [], cur = '';
    for (var ch of String(s)) {
      if (cur && JOIN.test(ch)) cur += ch;
      else { if (cur) out.push(cur); cur = ch; }
    }
    if (cur) out.push(cur);
    return out;
  }

  /**
   * 字単位の差分。a・b は [種類, 文字] の並び（'=' 同じ、'-' 削除、'+' 追加）。inline は 1 本にまとめた並び
   * 空白を無視するときは、空白を比べる列から外し、同じ扱いで表示する
   */
  function diffChars(textA, textB, o) {
    o = o || {};
    var ta = tokens(textA), tb = tokens(textB), key = keyFn(o);
    var ka = ta.map(key), kb = tb.map(key);
    var skipA = new Uint8Array(ta.length), skipB = new Uint8Array(tb.length), xa = [], xb = [], i;
    for (i = 0; i < ta.length; i++) { if (o.space && ka[i] === '') skipA[i] = 1; else xa.push(i); }
    for (i = 0; i < tb.length; i++) { if (o.space && kb[i] === '') skipB[i] = 1; else xb.push(i); }
    var ids = intern(xa.map(function (x) { return ka[x]; }), xb.map(function (x) { return kb[x]; }));
    var r = compare(ids.a, ids.b);
    var fa = new Uint8Array(ta.length), fb = new Uint8Array(tb.length), same = 0;
    for (i = 0; i < xa.length; i++) if (r.da[i]) fa[xa[i]] = 1;
    for (i = 0; i < xb.length; i++) if (r.db[i]) fb[xb[i]] = 1;
    for (i = 0; i < xa.length; i++) if (!r.da[i]) same++;
    function runs(tok, flag, skip, mark) {
      var out = [];
      for (var k = 0; k < tok.length; k++) {
        var t = flag[k] ? mark : '=';
        if (out.length && out[out.length - 1][0] === t) out[out.length - 1][1] += tok[k];
        else out.push([t, tok[k]]);
      }
      return out;
    }
    // 1 本にまとめた並び（同じ所は新しい方の字で出す。無視した A の空白は出さない）
    var inline = [], p = 0, q = 0, add = 0, del = 0;
    function push(t, s) { if (inline.length && inline[inline.length - 1][0] === t) inline[inline.length - 1][1] += s; else inline.push([t, s]); }
    while (p < ta.length || q < tb.length) {
      if (p < ta.length && skipA[p]) { p++; continue; }
      if (q < tb.length && skipB[q]) { push('=', tb[q]); q++; continue; }
      if (p < ta.length && fa[p]) { push('-', ta[p]); del++; p++; continue; }
      if (q < tb.length && fb[q]) { push('+', tb[q]); add++; q++; continue; }
      if (p < ta.length && q < tb.length) { push('=', tb[q]); p++; q++; continue; }
      if (p < ta.length) { push('-', ta[p]); del++; p++; } else { push('+', tb[q]); add++; q++; }
    }
    return {
      mode: 'char', a: runs(ta, fa, skipA, '-'), b: runs(tb, fb, skipB, '+'), inline: inline,
      add: add, del: del, same: same, lenA: xa.length, lenB: xb.length, approx: r.approx,
    };
  }

  /**
   * unified diff の文字列（diff -u と同じ形。見出しの日時は付けない）
   * 同じ所は A の行を出す。行末の改行が無い最後の行には「\ No newline at end of file」
   */
  function unified(res, o) {
    o = o || {};
    var ctx = o.context == null ? 3 : o.context, H = res.hunks, out = [];
    if (!H.some(function (h) { return h.t === 'ch'; })) return '';
    out.push('--- ' + (o.nameA || 'A'), '+++ ' + (o.nameB || 'B'));
    var nA = res.linesA.length, nB = res.linesB.length;
    // 変わった所ごとに前後 ctx 行をつけ、近いものはまとめる
    var groups = [], cur = null;
    H.forEach(function (h) {
      if (h.t !== 'ch') return;
      var a0 = Math.max(0, h.a0 - ctx), b0 = Math.max(0, h.b0 - ctx);
      if (cur && h.a0 - cur.lastA1 <= 2 * ctx) { cur.list.push(h); cur.lastA1 = h.a1; cur.lastB1 = h.b1; }
      else { cur = { a0: a0, b0: b0, list: [h], lastA1: h.a1, lastB1: h.b1 }; groups.push(cur); }
    });
    function range(start, count) {
      var s = count === 0 ? start : start + 1;
      return count === 1 ? String(s) : s + ',' + count;
    }
    groups.forEach(function (g) {
      var a1 = Math.min(nA, g.lastA1 + ctx), b1 = Math.min(nB, g.lastB1 + ctx);
      out.push('@@ -' + range(g.a0, a1 - g.a0) + ' +' + range(g.b0, b1 - g.b0) + ' @@');
      var ai = g.a0, bi = g.b0;
      function line(prefix, side, idx) {
        out.push(prefix + (side === 'a' ? res.linesA[idx] : res.linesB[idx]));
        if (side === 'a' && idx === nA - 1 && !res.finalEolA) out.push('\\ No newline at end of file');
        if (side === 'b' && idx === nB - 1 && !res.finalEolB) out.push('\\ No newline at end of file');
      }
      g.list.forEach(function (h) {
        while (ai < h.a0) { line(' ', 'a', ai); ai++; bi++; }
        for (var x = h.a0; x < h.a1; x++) line('-', 'a', x);
        for (var y = h.b0; y < h.b1; y++) line('+', 'b', y);
        ai = h.a1; bi = h.b1;
      });
      while (ai < a1) { line(' ', 'a', ai); ai++; bi++; }
    });
    return out.join('\n') + '\n';
  }

  var api = { compare: compare, diffLines: diffLines, diffChars: diffChars, unified: unified, splitLines: splitLines, tokens: tokens, hunksOf: hunksOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HenkanDiff = api;
})(typeof self !== 'undefined' ? self : this);
