// ===========================
// テキスト変換（henkan）— 4 つの道具で共通の部品
// 保存（localStorage、キーは henkan_ で始める）・Worker での実行・ファイルの読み書き・コピー
// ページが分かれた版と 1 ファイル版（henkan.html）の両方で同じものを使う
// ===========================
(function (root) {
  'use strict';

  // --- ブラウザへの保存（README「ツールを追加するとき」12）。保存するのは設定だけで、入力した文章は保存しない ---
  var KEY = 'henkan_settings';
  function loadAll() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; }
  }
  function saveAll(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* 保存できなくても続ける */ } }
  function settings(tool, defaults) {
    var all = loadAll(), cur = Object.assign({}, defaults, all[tool] || {});
    // 既定に無い項目・型の違う項目は捨てる（保存された値や読み込んだファイルをそのまま信じない）
    Object.keys(cur).forEach(function (k) { if (!(k in defaults) || typeof cur[k] !== typeof defaults[k]) cur[k] = defaults[k]; });
    return {
      get: function () { return cur; },
      set: function (patch) { Object.assign(cur, patch); var a = loadAll(); a[tool] = cur; saveAll(a); },
    };
  }

  // --- 重い処理は Worker で。前の処理が終わる前に次を頼んだら、前のものは止める ---
  var workerUrl = null;
  function makeWorker() {
    var src = document.getElementById('henkan-worker-src');
    try {
      if (src) {
        if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([src.textContent], { type: 'text/javascript' }));
        return new Worker(workerUrl);
      }
      return new Worker((document.body.getAttribute('data-root') || './') + 'lib/worker.js');
    } catch (e) { return null; }
  }
  function runner() {
    var w = null, busy = null, seq = 0, noWorker = false;
    function fallback(op, args) {
      // Worker が使えない環境（古いブラウザ・一部の file://）では画面側で同じ処理をする
      return new Promise(function (res, rej) {
        setTimeout(function () { try { res(root.HenkanOps[op](args)); } catch (e) { rej(e); } }, 0);
      });
    }
    return {
      run: function (op, args) {
        if (noWorker) return fallback(op, args);
        if (busy) {
          // 前の処理は止める。止めた Worker からあとで届くエラー・結果は受け取らない
          busy.reject({ cancelled: true }); busy = null;
          if (w) { w.onmessage = w.onerror = null; w.terminate(); w = null; }
        }
        if (!w) w = makeWorker();
        if (!w) { noWorker = true; return fallback(op, args); }
        var id = ++seq, me = w;
        return new Promise(function (resolve, reject) {
          busy = { id: id, reject: reject };
          me.onmessage = function (e) {
            if (me !== w || !busy || e.data.id !== busy.id) return;
            busy = null;
            if (e.data.ok) resolve(e.data.result); else reject(new Error(e.data.error));
          };
          me.onerror = function (ev) {
            // 起動できなかった（file:// で Worker が禁止など）ときは、以後は画面側で
            if (ev && ev.preventDefault) ev.preventDefault();
            if (me !== w) return;
            me.onmessage = me.onerror = null; me.terminate();
            w = null; noWorker = true; busy = null;
            fallback(op, args).then(resolve, reject);
          };
          me.postMessage({ id: id, op: op, args: args });
        });
      },
    };
  }

  function debounce(fn, ms) {
    var t = null;
    return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, typeof ms === 'function' ? ms() : ms); };
  }

  // 入力の大きさで待ち時間を変える（大きい入力を打つたびに計算し直さない）
  function waitFor(len) { return len > 2e6 ? 900 : len > 3e5 ? 500 : 250; }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(n) { return Number(n).toLocaleString('ja-JP'); }
  function size(len) { return len >= 1e5 ? Math.round(len / 1e4) + ' 万字' : len >= 1e4 ? (len / 1e4).toFixed(1) + ' 万字' : num(len) + ' 字'; }

  /** ファイルを文字にする（UTF-8 か Shift_JIS。CSV・テキスト・JSON のどれも） */
  function readFile(file) {
    return file.arrayBuffer().then(function (buf) { return root.HenkanCsv.decode(new Uint8Array(buf)); });
  }

  // textarea の value は改行を LF にそろえてしまう。開いたファイルの中身（CRLF など）は別に持ち、手で直したら捨てる
  var raws = new WeakMap();
  // 大きなファイル（30 万字より多い）は入力欄に表示しない。ブラウザが入力欄に数 MB を並べるだけで数秒止まるため（2.3MB で約 3.5 秒、2026-09-25 に計測）
  var BIG = 300000;
  function setRaw(textarea, text, name) {
    if (textarea._ph == null) textarea._ph = textarea.placeholder;
    var big = text.length > BIG;
    textarea.value = big ? '' : text;
    textarea.placeholder = big ? '「' + (name || 'ファイル') + '」（' + size(text.length) + '）を読み込みました。大きいので表示を省いています。入れ直すときは、ここに貼り付けるかファイルを開いてください。' : textarea._ph;
    if (big || /\r/.test(text)) raws.set(textarea, text); else raws.delete(textarea);
    if (!textarea._rawWired) {
      textarea._rawWired = true;
      textarea.addEventListener('input', function () { raws.delete(textarea); textarea.placeholder = textarea._ph; });
    }
  }
  /** 入力欄の中身（開いたファイルならその改行のまま） */
  function val(textarea) { return raws.has(textarea) ? raws.get(textarea) : textarea.value; }

  /** 結果の欄に出す。大きい結果は表示を省き、コピー・保存で取り出してもらう */
  function showOut(textarea, text) {
    if (textarea._ph == null) textarea._ph = textarea.placeholder;
    var big = text.length > BIG;
    textarea.value = big ? '' : text;
    textarea.placeholder = big ? '結果は ' + size(text.length) + 'です。大きいので表示を省いています。「コピー」か「ファイルに保存」で取り出してください。' : textarea._ph;
  }

  /** 入力欄にファイルを開くボタンとドロップをつける */
  function attachFile(textarea, button, onText) {
    var input = document.createElement('input');
    input.type = 'file'; input.hidden = true;
    input.accept = textarea.getAttribute('data-accept') || '';
    button.after(input);
    function take(file) {
      if (!file) return;
      readFile(file).then(function (r) { setRaw(textarea, r.text, file.name); onText(file.name, r.encoding); }, function () { onText(file.name, null); });
    }
    button.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { take(input.files && input.files[0]); input.value = ''; });
    textarea.addEventListener('dragover', function (e) { e.preventDefault(); textarea.classList.add('drop'); });
    textarea.addEventListener('dragleave', function () { textarea.classList.remove('drop'); });
    textarea.addEventListener('drop', function (e) {
      e.preventDefault(); textarea.classList.remove('drop');
      take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  /** 文字をファイルとして保存する（この端末の中で作るだけ） */
  function download(text, name, type, bom) {
    var blob = new Blob([bom ? '﻿' : '', text], { type: (type || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function copy(text, msgEl) {
    function done(ok) { if (msgEl) { msgEl.textContent = ok ? 'コピーしました。' : 'コピーできませんでした。結果の欄を選んでコピーしてください。'; setTimeout(function () { msgEl.textContent = ''; }, 3000); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  // --- 設定のファイルへの書き出し・読み込み（README「ツールを追加するとき」20。決定 D31） ---
  var TOOL = 'henkan', BACKUP_VERSION = 1;
  function backupFileName(d) {
    d = d || new Date();
    return TOOL + '-backup-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
  }
  function wireBackup(box, onLoaded) {
    if (!box) return;
    var msg = box.querySelector('.backup-msg'), file = box.querySelector('input[type=file]');
    box.querySelector('.backup-export').addEventListener('click', function () {
      download(JSON.stringify({ tool: TOOL, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data: { settings: loadAll() } }, null, 2), backupFileName(), 'application/json');
      msg.textContent = 'ファイルに書き出しました。';
    });
    box.querySelector('.backup-import').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      if (f.size > 1024 * 1024) { msg.textContent = 'ファイルが大きすぎます。このツールで書き出したファイルを選んでください。'; return; }
      f.text().then(function (text) {
        var o = null;
        try { o = JSON.parse(text); } catch (e) { o = null; }
        if (!o || typeof o !== 'object' || o.tool !== TOOL) { msg.textContent = o && typeof o.tool === 'string' ? 'ほかのツール（' + String(o.tool).slice(0, 40) + '）のファイルです。' : 'ファイルを読み取れませんでした。このツールの「ファイルに書き出す」で作った .json ファイルを選んでください。'; return; }
        if (o.version !== BACKUP_VERSION) { msg.textContent = 'ファイルの形式が正しくないため読み込めません。'; return; }
        var s = o.data && o.data.settings;
        if (!s || typeof s !== 'object' || Array.isArray(s)) { msg.textContent = 'ファイルの中身が足りないため読み込めません。'; return; }
        if (!root.confirm('ファイルの設定で、今の設定を置き換えます。よろしいですか？')) return;
        var clean = {};
        ['diff', 'json', 'csv', 'kana'].forEach(function (k) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) clean[k] = s[k]; });
        saveAll(clean);   // 各道具の settings() が読み込むときに型をそろえる
        msg.textContent = 'ファイルから読み込みました。画面を読み直します。';
        if (onLoaded) onLoaded(); else setTimeout(function () { location.reload(); }, 600);
      }, function () { msg.textContent = 'ファイルを読み取れませんでした。'; });
    });
  }

  root.Henkan = {
    settings: settings, runner: runner, debounce: debounce, waitFor: waitFor, esc: esc, num: num, size: size,
    attachFile: attachFile, val: val, showOut: showOut, setRaw: setRaw, download: download, copy: copy, wireBackup: wireBackup, backupFileName: backupFileName,
  };
})(typeof window !== 'undefined' ? window : this);
