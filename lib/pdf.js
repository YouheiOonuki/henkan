// ===========================
// PDF 結合・分割・回転（/henkan/pdf/）の中身。DOM に触らない（Node のテストからも呼ぶ）
// - ページ範囲の読み取り（「1-3, 5」「1〜3、5」「5-」）と分け方（範囲ごと・1 ページずつ・N ページずつ）
// - PDF の操作は pdf-lib（vendor/pdf-lib/pdf-lib.min.js、MIT）。PDFLib を引数で受け取り、このファイルは読み込まない
// - ZIP（無圧縮、名前は UTF-8）。分割した複数の PDF をまとめて保存するときだけ使う
// ブラウザでは self.HenkanPdf、Node では module.exports
// 1 ファイル版 henkan.html には入れない（pdf-lib が 525KB あるため。ROADMAP 7.10.2）
// ===========================
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HenkanPdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 全角の数字・記号を半角に。「〜」「～」「ー」「−」は範囲の「-」、「、」「，」は区切りの「,」
  function normRanges(s) {
    return String(s || '')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[〜～~ー－―−‐–—]/g, '-')
      .replace(/\s*-\s*/g, '-')
      .replace(/[、，,;；\s]+/g, ',')
      .replace(/^,+|,+$/g, '');
  }

  /**
   * ページ範囲を読む。total はページ数。
   * 返す: { groups: [[0,1,2],[4]] }（0 から数えた番号。範囲ごとに 1 つ）か { error: '…' }
   * 書き方: 「1-3, 5」「1〜3、5」「5-」（5 から最後まで）「-3」（最初から 3 まで）。「3-1」は逆順
   */
  function parseRanges(s, total) {
    var t = normRanges(s);
    if (!t) return { error: 'ページを入れてください（例: 1-3, 5）。' };
    var groups = [];
    var parts = t.split(',');
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      var m = /^(\d*)-(\d*)$/.exec(p) || /^(\d+)$/.exec(p);
      if (!m || (m[1] === '' && m[2] === '')) return { error: '「' + p + '」はページの書き方として読めません（例: 1-3, 5）。' };
      var a, b;
      if (m.length === 2) { a = b = Number(m[1]); }
      else { a = m[1] === '' ? 1 : Number(m[1]); b = m[2] === '' ? total : Number(m[2]); }
      if (a < 1 || b < 1) return { error: 'ページは 1 から数えます（「' + p + '」）。' };
      if (a > total || b > total) return { error: '「' + p + '」: この PDF は ' + total + ' ページまでです。' };
      var g = [];
      if (a <= b) for (var i = a; i <= b; i++) g.push(i - 1);
      else for (var j = a; j >= b; j--) g.push(j - 1);
      groups.push(g);
    }
    return { groups: groups };
  }

  /** 1 ページずつ */
  function eachPage(total) {
    var g = [];
    for (var i = 0; i < total; i++) g.push([i]);
    return g;
  }

  /** n ページずつ（最後は余り） */
  function everyN(total, n) {
    n = Math.floor(Number(n));
    if (!(n >= 1)) return { error: '何ページずつにするかを 1 以上の数で入れてください。' };
    var g = [];
    for (var i = 0; i < total; i += n) {
      var a = [];
      for (var j = i; j < Math.min(total, i + n); j++) a.push(j);
      g.push(a);
    }
    return { groups: g };
  }

  /** 番号の並び（0 から）を「1-3」「5」「1-2, 4」の形に（ファイル名と表示用） */
  function label(g) {
    var out = [], i = 0;
    while (i < g.length) {
      var j = i;
      while (j + 1 < g.length && g[j + 1] === g[j] + 1) j++;
      out.push(j > i ? (g[i] + 1) + '-' + (g[j] + 1) : String(g[i] + 1));
      i = j + 1;
    }
    return out.join(', ');
  }

  /** 回転を 0・90・180・270 にそろえる */
  function normRot(r) { return (((Math.round(Number(r) / 90) * 90) % 360) + 360) % 360; }

  // --- pdf-lib を使う部分 ---
  var LOAD = { ignoreEncryption: true, updateMetadata: false };

  /**
   * 1 つのファイルを読んで、ページの大きさと向きを返す。
   * 返す: { ok: true, pages: [{ w, h, rot }], title, author } か { ok: false, reason: 'encrypted' | 'broken', detail }
   * 暗号化された PDF（開くパスワード・編集の制限）は pdf-lib では正しく書き出せないので、読まずに 'encrypted'
   */
  function inspect(PDFLib, bytes) {
    return PDFLib.PDFDocument.load(bytes, LOAD).then(function (doc) {
      if (doc.isEncrypted) return { ok: false, reason: 'encrypted' };
      var pages = doc.getPages().map(function (p) {
        var s = p.getSize();
        return { w: Math.round(s.width), h: Math.round(s.height), rot: normRot(p.getRotation().angle) };
      });
      if (!pages.length) return { ok: false, reason: 'broken', detail: 'ページがありません' };
      return { ok: true, pages: pages, title: doc.getTitle() || '', author: doc.getAuthor() || '' };
    }).catch(function (e) {
      // 読めない（ヘッダーが無い）・ページの木が無いなど。getPages の中で投げるものもここで受ける
      return { ok: false, reason: 'broken', detail: String(e && e.message || e).slice(0, 200) };
    });
  }

  /**
   * ページを並べて新しい PDF を作る（結合・分割・回転・削除・並べ替えのすべてをこれで）。
   * sources: { id: Uint8Array }。items: [{ id, i, rot }]（i は 0 から、rot は元の向きに足す角度）
   * opts.keepInfo: 最初のファイルのタイトル・作成者・件名・キーワードを残す（既定は残さない）
   * 作るのは新しい文書なので、元の文書情報・しおり（目次）・フォームの設定は持ち込まない。
   * pdf-lib の既定の Producer・Creator・作成日も書かない（updateMetadata: false）
   */
  function compose(PDFLib, sources, items, opts) {
    opts = opts || {};
    if (!items || !items.length) return Promise.reject(new Error('ページがありません'));
    var loaded = {};
    function src(id) {
      if (!loaded[id]) loaded[id] = PDFLib.PDFDocument.load(sources[id], LOAD);
      return loaded[id];
    }
    return PDFLib.PDFDocument.create({ updateMetadata: false }).then(function (out) {
      // 同じファイルのページはまとめて copyPages する（共有のフォント・画像を 1 回だけ写す）
      var runs = [];
      items.forEach(function (it) {
        var last = runs[runs.length - 1];
        if (last && last.id === it.id) last.items.push(it); else runs.push({ id: it.id, items: [it] });
      });
      var chain = Promise.resolve();
      runs.forEach(function (run) {
        chain = chain.then(function () { return src(run.id); }).then(function (doc) {
          return out.copyPages(doc, run.items.map(function (it) { return it.i; })).then(function (pages) {
            pages.forEach(function (p, k) {
              var it = run.items[k];
              if (it.rot) p.setRotation(PDFLib.degrees(normRot(p.getRotation().angle + it.rot)));
              out.addPage(p);
            });
          });
        });
      });
      return chain.then(function () {
        if (!opts.keepInfo || !items.length) return out;
        return src(items[0].id).then(function (doc) {
          var t = doc.getTitle(), a = doc.getAuthor(), s = doc.getSubject(), k = doc.getKeywords();
          if (t) out.setTitle(t);
          if (a) out.setAuthor(a);
          if (s) out.setSubject(s);
          if (k) out.setKeywords(k.split(/\s+/));
          return out;
        });
      });
    }).then(function (out) { return out.save(); });
  }

  // --- ZIP（無圧縮・UTF-8 の名前）。APPNOTE.TXT（PKWARE）の local file header・central directory・end of central directory ---
  var CRC = null;
  function crc32(u8) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
    }
    var x = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) x = CRC[(x ^ u8[i]) & 0xFF] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }
  /** files: [{ name, bytes: Uint8Array }]、date: Date。返す: Uint8Array */
  function zip(files, date) {
    date = date || new Date();
    var dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    var dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    var locals = [], centrals = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name), data = f.bytes, crc = crc32(data);
      if (data.length >= 0xFFFFFFFF || offset >= 0xFFFFFFFF) throw new Error('ZIP にできる大きさ（4GB）を超えています');
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      locals.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      centrals.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = centrals.reduce(function (s, a) { return s + a.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    var parts = locals.concat(centrals, [new Uint8Array(e.buffer)]);
    var out = new Uint8Array(offset + cdSize + 22), pos = 0;
    parts.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }

  /**
   * 画面と Worker の間で使う「エンジン」。読み込んだファイルの中身を id で持つ（画面側は持たない）
   * add(id, bytes) → inspect の結果。drop(id)。compose(items, opts) → Uint8Array。split(groups: [[items]], opts) → [Uint8Array]
   */
  function createEngine(PDFLib) {
    var sources = {};
    return {
      add: function (id, bytes) {
        var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        return inspect(PDFLib, u8).then(function (r) { if (r.ok) sources[id] = u8; return r; });
      },
      drop: function (id) { delete sources[id]; return Promise.resolve(true); },
      compose: function (items, opts) { return compose(PDFLib, sources, items, opts); },
      split: function (groups, opts) {
        var outs = [], chain = Promise.resolve();
        groups.forEach(function (items) {
          chain = chain.then(function () { return compose(PDFLib, sources, items, opts); }).then(function (b) { outs.push(b); });
        });
        return chain.then(function () { return outs; });
      },
    };
  }

  return {
    normRanges: normRanges, parseRanges: parseRanges, eachPage: eachPage, everyN: everyN, label: label, normRot: normRot,
    inspect: inspect, compose: compose, zip: zip, crc32: crc32, createEngine: createEngine,
  };
});
