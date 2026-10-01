// ===========================
// PDF 結合・分割・回転（/henkan/pdf/）の画面
// - ファイルは送信しない。読み込み・結合・分割はこの端末の中（Web Worker。使えなければ画面側）
// - pdf-lib（vendor/pdf-lib/pdf-lib.min.js）は最初のファイルを選んだときに初めて読む（ページを開いただけでは読まない）
// - 何も保存しない（ブラウザのストレージを使わない）。ページを閉じれば入れた PDF は消える
// ===========================
(function () {
  'use strict';
  var P = window.HenkanPdf;
  var ROOT = document.body.getAttribute('data-root') || '../';
  var $ = function (id) { return document.getElementById(id); };
  // 大きなファイルの目安（合計）。超えても止めずに知らせる。pdf-lib はファイル全体をメモリに読み、書き出しでもう 1 つ作るため
  var SOFT_LIMIT = 100 * 1024 * 1024;

  var files = [];   // { id, name, size, pages: [{ w, h, rot }], error }
  var pages = [];   // 並び順どおり: { fid, i, rot（足す角度）, del, sel }
  var outs = [];    // 最後に作ったファイル: { name, bytes, url }
  var seq = 0, busy = false, lastClicked = -1;

  // --- エンジン（Worker か、だめなら画面側） ---
  var enginePromise = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error(src + ' を読めませんでした')); };
      document.head.appendChild(s);
    });
  }
  function mainThreadEngine() {
    var ready = window.PDFLib ? Promise.resolve() : loadScript(ROOT + 'vendor/pdf-lib/pdf-lib.min.js');
    return ready.then(function () {
      var e = P.createEngine(window.PDFLib);
      return { call: function (op, args) { return e[op].apply(null, args); }, where: 'main' };
    });
  }
  function workerEngine() {
    return new Promise(function (resolve, reject) {
      var w;
      try { w = new Worker(ROOT + 'lib/pdf-worker.js'); } catch (e) { reject(e); return; }
      var waits = {}, id = 0, started = false;
      var timer = setTimeout(function () { if (!started) { w.terminate(); reject(new Error('Worker が応答しません')); } }, 20000);
      w.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (!started) { clearTimeout(timer); w.terminate(); reject(new Error('Worker を起動できませんでした')); return; }
        Object.keys(waits).forEach(function (k) { waits[k].reject(new Error('処理が止まりました（メモリが足りない可能性があります）')); });
        waits = {};
      };
      w.onmessage = function (e) {
        var m = e.data || {};
        if (m.ready) { started = true; clearTimeout(timer); resolve(api); return; }
        var h = waits[m.id]; if (!h) return; delete waits[m.id];
        if (m.ok) h.resolve(m.result); else h.reject(new Error(m.error));
      };
      var api = {
        where: 'worker',
        call: function (op, args, transfer) {
          return new Promise(function (res, rej) { var n = ++id; waits[n] = { resolve: res, reject: rej }; w.postMessage({ id: n, op: op, args: args }, transfer || []); });
        },
      };
    });
  }
  function engine() {
    if (!enginePromise) enginePromise = (typeof Worker === 'undefined' ? Promise.reject(new Error('no worker')) : workerEngine()).catch(mainThreadEngine);
    return enginePromise;
  }

  // --- 表示の部品 ---
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function bytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B'; }
  function mode() { return document.querySelector('input[name=p-mode]:checked').value; }
  function okFiles() { return files.filter(function (f) { return !f.error; }); }
  function letter(k) { var s = ''; k++; while (k > 0) { var r = (k - 1) % 26; s = String.fromCharCode(65 + r) + s; k = Math.floor((k - 1) / 26); } return s; }
  function fileOf(fid) { for (var k = 0; k < files.length; k++) if (files[k].id === fid) return files[k]; return null; }
  function letterOf(fid) { var ok = okFiles(); for (var k = 0; k < ok.length; k++) if (ok[k].id === fid) return letter(k); return '?'; }
  function active() { return pages.filter(function (p) { return !p.del; }); }
  function baseName() {
    var custom = $('p-name').value.trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    if (custom) return custom;
    var f = okFiles()[0];
    return f ? f.name.replace(/\.pdf$/i, '') : 'pdf';
  }

  // --- ファイルを入れる ---
  function addFiles(list) {
    var arr = Array.prototype.slice.call(list || []);
    if (!arr.length) return;
    var skipped = arr.filter(function (f) { return !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf'; });
    arr = arr.filter(function (f) { return skipped.indexOf(f) < 0; });
    if (skipped.length) setStatus('PDF ではないファイル（' + skipped.map(function (f) { return f.name; }).join('、') + '）は入れませんでした。');
    if (!arr.length) return;
    busy = true; update();
    setStatus('読み込んでいます…（' + arr.length + ' ファイル）');
    var chain = engine().then(function (eng) {
      var c = Promise.resolve();
      arr.forEach(function (file) {
        c = c.then(function () { return file.arrayBuffer(); }).then(function (buf) {
          var id = ++seq;
          return eng.call('add', [id, buf], [buf]).then(function (r) {
            if (r.ok) {
              files.push({ id: id, name: file.name, size: file.size, pages: r.pages });
              r.pages.forEach(function (pg, i) { pages.push({ fid: id, i: i, rot: 0, del: false, sel: false }); });
            } else {
              files.push({ id: id, name: file.name, size: file.size, pages: [], error: r.reason === 'encrypted'
                ? 'パスワードか編集の制限がかかった PDF なので開けません。PDF を作ったソフトなどで保護を外して保存し直してから入れてください。'
                : 'PDF として読めませんでした（壊れているか、PDF ではないファイルです）。' });
            }
          });
        }, function () {
          files.push({ id: ++seq, name: file.name, size: file.size, pages: [], error: 'ファイルを読めませんでした（大きすぎてメモリが足りない可能性があります）。' });
        });
      });
      return c;
    });
    chain.catch(function (e) { setStatus('読み込めませんでした: ' + e.message); }).then(function () {
      busy = false;
      var total = okFiles().reduce(function (s, f) { return s + f.size; }, 0);
      setStatus(total > SOFT_LIMIT
        ? '合計 ' + bytes(total) + ' あります。端末のメモリによっては途中で止まることがあります（目安は合計 100MB まで）。'
        : '');
      render();
    });
  }
  function setStatus(t) { $('p-status').textContent = t; }

  function removeFile(id) {
    files = files.filter(function (f) { return f.id !== id; });
    pages = pages.filter(function (p) { return p.fid !== id; });
    engine().then(function (eng) { eng.call('drop', [id]); });
    render();
  }
  function moveFile(from, to) {
    if (to < 0 || to >= files.length || from === to) return;
    var f = files.splice(from, 1)[0]; files.splice(to, 0, f);
    // ページはファイルの順に並べ直す（回転・削除はそのまま）
    var order = {}; files.forEach(function (x, k) { order[x.id] = k; });
    pages.sort(function (a, b) { return order[a.fid] - order[b.fid] || a.i - b.i; });
    render();
  }

  // --- 描く ---
  function renderFiles() {
    var ol = $('p-files');
    ol.innerHTML = files.map(function (f, k) {
      var tag = f.error ? '' : '<span class="p-letter">' + letterOf(f.id) + '</span>';
      var info = f.error ? '<span class="p-err">' + esc(f.error) + '</span>' : '<span class="small">' + f.pages.length + ' ページ・' + bytes(f.size) + '</span>';
      return '<li draggable="' + (f.error ? 'false' : 'true') + '" data-k="' + k + '">' + tag +
        '<span class="p-fname"><span class="p-name">' + esc(f.name) + '</span>' + info + '</span>' +
        '<span class="p-fbtn">' +
        '<button type="button" class="btn-sub" data-up="' + k + '" aria-label="' + esc(f.name) + ' を上へ"' + (k === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn-sub" data-down="' + k + '" aria-label="' + esc(f.name) + ' を下へ"' + (k === files.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn-sub" data-rm="' + f.id + '" aria-label="' + esc(f.name) + ' を外す">✕</button></span></li>';
    }).join('');
  }
  function renderGrid() {
    var multi = okFiles().length > 1, n = 0;
    $('p-grid').innerHTML = pages.map(function (p, k) {
      var f = fileOf(p.fid), pg = f.pages[p.i], eff = P.normRot(pg.rot + p.rot);
      var side = eff % 180 ? [pg.h, pg.w] : [pg.w, pg.h];
      var big = Math.max(side[0], side[1]) || 1;
      var w = Math.round(48 * side[0] / big), h = Math.round(48 * side[1] / big);
      var name = (multi ? letterOf(p.fid) : '') + (p.i + 1);
      var no = p.del ? '削除' : String(++n);
      var desc = (multi ? 'ファイル ' + letterOf(p.fid) + ' の ' : '') + (p.i + 1) + ' ページ目' + (p.rot ? '、' + (p.rot > 0 ? '右' : '左') + 'に ' + Math.abs(p.rot) + '°' : '') + (p.del ? '、削除' : '');
      return '<li draggable="true" data-k="' + k + '"><button type="button" class="p-page' + (p.del ? ' del' : '') + '" aria-pressed="' + (p.sel ? 'true' : 'false') + '" data-k="' + k + '" aria-label="' + desc + '">' +
        '<span class="p-sheet" style="width:' + w + 'px;height:' + h + 'px"><span class="p-up" style="transform:rotate(' + eff + 'deg)">↑</span></span>' +
        '<span class="p-no">' + esc(name) + '</span><span class="p-out">' + no + '</span></button></li>';
    }).join('');
    var sel = pages.filter(function (p) { return p.sel; }).length;
    $('p-sel').textContent = sel ? sel + ' ページを選んでいます。' : 'ページを押して選び、上のボタンで回す・消す・動かす。ドラッグでも並べ替えられます。';
  }

  function plan() {
    // いまの設定で作るファイルの一覧: [{ items, name, pages }] か { error }
    var act = active(), m = mode(), base = baseName();
    if (!act.length) return { error: okFiles().length ? 'すべてのページを削除しています。' : '' };
    var item = function (p) { return { id: p.fid, i: p.i, rot: p.rot }; };
    if (m === 'split') {
      var how = $('p-how').value, r;
      if (how === 'each') r = { groups: P.eachPage(act.length) };
      else if (how === 'n') r = P.everyN(act.length, $('p-n').value);
      else {
        r = P.parseRanges($('p-range').value, act.length);
        if (r.groups && how === 'extract') r = { groups: [[].concat.apply([], r.groups)] };
      }
      if (r.error) return { error: r.error };
      var width = String(act.length).length;
      return { list: r.groups.map(function (g) {
        var lab = P.label(g);
        var tag = how === 'each' || how === 'n' ? 'p' + String(g[0] + 1).padStart(width, '0') + (g.length > 1 ? '-' + String(g[g.length - 1] + 1).padStart(width, '0') : '') : 'p' + lab.replace(/, /g, '_');
        return { items: g.map(function (i) { return item(act[i]); }), name: base + '_' + tag + '.pdf', label: lab, pages: g.length };
      }) };
    }
    return { list: [{ items: act.map(item), name: base + (m === 'merge' ? '_merged' : '_edited') + '.pdf', pages: act.length }] };
  }

  function summary() {
    var m = mode(), ok = okFiles(), go = $('p-go');
    go.textContent = m === 'merge' ? '結合して保存' : m === 'split' ? '分割して保存' : '保存する';
    var big = $('p-big'), sub = $('p-sub');
    if (!ok.length) { big.textContent = '—'; sub.textContent = files.length ? '開ける PDF がありません。' : 'PDF を選ぶと、ここに作るファイルが出ます。'; go.disabled = true; return; }
    var pl = plan();
    if (pl.error != null) { big.textContent = '—'; sub.textContent = pl.error; go.disabled = true; return; }
    var rot = pages.filter(function (p) { return !p.del && p.rot; }).length, del = pages.filter(function (p) { return p.del; }).length;
    var edits = (rot ? '回転 ' + rot + ' ページ' : '') + (rot && del ? '・' : '') + (del ? '削除 ' + del + ' ページ' : '');
    if (m === 'split') {
      big.textContent = pl.list.length + ' ファイル';
      var shown = pl.list.slice(0, 6).map(function (o) { return o.label + '（' + o.pages + ' ページ）'; }).join(' ／ ');
      sub.textContent = '全 ' + active().length + ' ページを ' + shown + (pl.list.length > 6 ? ' ほか' : '') + (edits ? '。' + edits + 'も入ります' : '');
    } else if (m === 'merge') {
      big.textContent = pl.list[0].pages + ' ページ';
      sub.textContent = ok.length > 1 ? ok.map(function (f, k) { return letter(k); }).join('・') + ' の ' + ok.length + ' ファイルを、この順で 1 つにします' + (edits ? '（' + edits + 'も入ります）' : '') : 'ファイルを 2 つ以上入れると、つなげて 1 つにします。';
    } else {
      big.textContent = pl.list[0].pages + ' ページ';
      sub.textContent = edits || '変更はまだありません。ページを選んで回す・消す・動かす。';
    }
    go.disabled = busy;
    $('p-opt-state').textContent = ($('p-keep').checked ? '文書情報を残す' : '文書情報は残さない') + ($('p-name').value.trim() ? '・名前 ' + $('p-name').value.trim() : '');
  }

  function render() {
    var m = mode();
    $('p-files').hidden = m === 'pages' || !files.length;
    $('p-split').hidden = m !== 'split';
    $('p-pages').hidden = m !== 'pages';
    var how = $('p-how').value;
    $('p-range-box').hidden = !(how === 'ranges' || how === 'extract');
    $('p-n-box').hidden = how !== 'n';
    renderFiles();
    if (m === 'pages') renderGrid();
    summary();
  }
  function update() { summary(); }

  // --- 作る ---
  function clearOuts() {
    outs.forEach(function (o) { URL.revokeObjectURL(o.url); });
    outs = []; $('p-outs').innerHTML = '';
  }
  function save(name, data, type) {
    var url = URL.createObjectURL(new Blob([data], { type: type }));
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    return url;
  }
  function go() {
    var pl = plan();
    if (!pl.list || busy) return;
    busy = true; summary(); clearOuts();
    $('p-msg').textContent = '作っています…';
    var opts = { keepInfo: $('p-keep').checked };
    var t0 = Date.now();
    engine().then(function (eng) {
      return pl.list.length === 1
        ? eng.call('compose', [pl.list[0].items, opts]).then(function (b) { return [b]; })
        : eng.call('split', [pl.list.map(function (o) { return o.items; }), opts]);
    }).then(function (res) {
      outs = res.map(function (b, k) { return { name: pl.list[k].name, bytes: b, pages: pl.list[k].pages }; });
      var html = outs.map(function (o, k) {
        o.url = URL.createObjectURL(new Blob([o.bytes], { type: 'application/pdf' }));
        return '<li><a class="btn-sub" href="' + o.url + '" download="' + esc(o.name) + '">' + esc(o.name) + '</a> <span class="small">' + o.pages + ' ページ・' + bytes(o.bytes.length) + '</span></li>';
      }).join('');
      $('p-outs').innerHTML = (outs.length > 1 ? '<li><button type="button" class="btn" id="p-zip">ZIP にまとめて保存（' + outs.length + ' ファイル）</button></li>' : '') + html;
      if (outs.length === 1) $('p-outs').querySelector('a').click();
      $('p-msg').textContent = (outs.length === 1 ? '保存しました: ' + outs[0].name + '（' + outs[0].pages + ' ページ・' + bytes(outs[0].bytes.length) + '）。保存されないときは下の名前を押してください。'
        : outs.length + ' ファイルを作りました。1 つずつ保存するか、ZIP にまとめて保存します。') + '（' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）';
    }).catch(function (e) {
      $('p-msg').textContent = '作れませんでした: ' + e.message;
    }).then(function () { busy = false; summary(); });
  }

  // --- 操作 ---
  $('p-pick').addEventListener('click', function () { $('p-file').click(); });
  $('p-file').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  var drop = $('p-drop'), form = $('p-form');
  ['dragenter', 'dragover'].forEach(function (t) {
    form.addEventListener(t, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); drop.classList.add('drop'); } });
  });
  ['dragleave', 'drop'].forEach(function (t) { form.addEventListener(t, function () { drop.classList.remove('drop'); }); });
  form.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

  document.querySelectorAll('input[name=p-mode]').forEach(function (r) { r.addEventListener('change', function () { clearOuts(); $('p-msg').textContent = ''; render(); }); });
  ['p-how'].forEach(function (id) { $(id).addEventListener('change', render); });
  ['p-range', 'p-n', 'p-name'].forEach(function (id) { $(id).addEventListener('input', update); });
  $('p-keep').addEventListener('change', update);
  $('p-go').addEventListener('click', go);
  $('p-outs').addEventListener('click', function (e) {
    if (e.target.id !== 'p-zip') return;
    var z = P.zip(outs.map(function (o) { return { name: o.name, bytes: o.bytes }; }));
    var url = save(baseName() + '_split.zip', z, 'application/zip');
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  });

  // ファイルの一覧: ボタンとドラッグ
  var dragFrom = -1;
  $('p-files').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-up')) moveFile(+b.getAttribute('data-up'), +b.getAttribute('data-up') - 1);
    else if (b.hasAttribute('data-down')) moveFile(+b.getAttribute('data-down'), +b.getAttribute('data-down') + 1);
    else if (b.hasAttribute('data-rm')) removeFile(+b.getAttribute('data-rm'));
  });
  function wireDrag(list, onMove) {
    list.addEventListener('dragstart', function (e) { var li = e.target.closest('li'); if (!li) return; dragFrom = +li.getAttribute('data-k'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); });
    list.addEventListener('dragover', function (e) { if (dragFrom >= 0 && e.target.closest('li')) e.preventDefault(); });
    list.addEventListener('drop', function (e) {
      var li = e.target.closest('li'); if (dragFrom < 0 || !li) return;
      e.preventDefault(); e.stopPropagation(); onMove(dragFrom, +li.getAttribute('data-k')); dragFrom = -1;
    });
    list.addEventListener('dragend', function () { dragFrom = -1; });
  }
  wireDrag($('p-files'), moveFile);
  wireDrag($('p-grid'), function (from, to) {
    if (from === to) return;
    var p = pages.splice(from, 1)[0]; pages.splice(to, 0, p); render();
  });

  // ページの一覧: 押して選ぶ（Shift で範囲）。ツールバーで回す・消す・動かす
  $('p-grid').addEventListener('click', function (e) {
    var b = e.target.closest('button.p-page'); if (!b) return;
    var k = +b.getAttribute('data-k');
    if (e.shiftKey && lastClicked >= 0) { for (var j = Math.min(k, lastClicked); j <= Math.max(k, lastClicked); j++) pages[j].sel = true; }
    else pages[k].sel = !pages[k].sel;
    lastClicked = k; renderGrid(); focusPage(k);
  });
  function focusPage(k) { var b = $('p-grid').querySelector('button[data-k="' + k + '"]'); if (b) b.focus(); }
  document.querySelector('.p-tools').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var act = b.getAttribute('data-act');
    var sel = pages.filter(function (p) { return p.sel; });
    if (act === 'all') { var all = sel.length !== pages.length; pages.forEach(function (p) { p.sel = all; }); render(); return; }
    if (!sel.length) { $('p-sel').textContent = '先にページを押して選んでください（「すべて選ぶ」もあります）。'; return; }
    if (act === 'left' || act === 'right') sel.forEach(function (p) { p.rot = P.normRot(p.rot + (act === 'right' ? 90 : -90)); if (p.rot === 270) p.rot = -90; });
    else if (act === 'del') { var allDel = sel.every(function (p) { return p.del; }); sel.forEach(function (p) { p.del = !allDel; }); }
    else if (act === 'back' || act === 'fwd') {
      // 選んだページをまとめて 1 つずつ前（後ろ）へ。端にあるものは動かない
      if (act === 'back') { for (var i = 1; i < pages.length; i++) if (pages[i].sel && !pages[i - 1].sel) { var t = pages[i - 1]; pages[i - 1] = pages[i]; pages[i] = t; } }
      else { for (var j = pages.length - 2; j >= 0; j--) if (pages[j].sel && !pages[j + 1].sel) { var u = pages[j + 1]; pages[j + 1] = pages[j]; pages[j] = u; } }
    }
    render();
  });

  render();
})();
