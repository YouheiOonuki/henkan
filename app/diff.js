// ===========================
// テキスト差分の画面（計算は lib/diff.js を Worker で）
// ===========================
(function () {
  'use strict';
  var form = document.getElementById('d-form');
  if (!form) return;
  var H = window.Henkan, $ = function (id) { return document.getElementById(id); };
  var el = { a: $('d-a'), b: $('d-b'), big: $('d-big'), sub: $('d-sub'), out: $('d-out'), msg: $('d-msg'), viewRow: $('d-view-row'), actions: $('d-actions'), all: $('d-all') };
  var S = H.settings('diff', { unit: 'line', space: false, caseless: false, width: false, view: '', all: false });
  var run = H.runner(), last = null, shownRows = 0, ROWS = 2000;

  function opts() { var s = S.get(); return { space: s.space, caseless: s.caseless, width: s.width }; }
  function view() { var v = S.get().view; return v || (window.innerWidth >= 760 ? 'split' : 'unified'); }

  function applySettings() {
    var s = S.get();
    form.querySelectorAll('input[name=d-unit]').forEach(function (r) { r.checked = r.value === s.unit; });
    $('d-space').checked = s.space; $('d-case').checked = s.caseless; $('d-width').checked = s.width;
    form.querySelectorAll('input[name=d-view]').forEach(function (r) { r.checked = r.value === view(); });
    el.all.checked = s.all;
    var ign = [s.space && '空白', s.caseless && '大小', s.width && '全角半角'].filter(Boolean);
    var st = (s.unit === 'char' ? '文字単位' : '行単位') + (ign.length ? '・' + ign.join('・') + 'を無視' : '');
    var state = $('d-opt').querySelector('.opt-state'); if (state) state.textContent = st;
  }

  function update() {
    var a = H.val(el.a), b = H.val(el.b);
    if (a === '' && b === '') { last = null; render(); return; }
    var s = S.get();
    if (s.unit === 'char' && (a.length > 200000 || b.length > 200000)) {
      last = { error: '文字単位で比べられるのは 1 つ 20 万字までです。長い文章は「比べ方」で行単位にしてください。' }; render(); return;
    }
    el.sub.textContent = '比べています…（' + H.size(a.length + b.length) + '）';
    run.run(s.unit === 'char' ? 'diffChars' : 'diffLines', [a, b, opts()]).then(function (r) { last = r; shownRows = ROWS; render(); }, function (e) {
      if (e && e.cancelled) return;
      last = { error: '比べられませんでした（' + (e && e.message || e) + '）。' }; render();
    });
  }
  var later = H.debounce(update, function () { return H.waitFor(H.val(el.a).length + H.val(el.b).length); });

  function render() {
    applySettings();
    el.out.innerHTML = ''; el.msg.textContent = '';
    el.viewRow.hidden = el.actions.hidden = true;
    if (!last) { el.big.textContent = '—'; el.sub.textContent = 'A と B に文章を入れると出ます。'; return; }
    if (last.error) { el.big.textContent = '—'; el.sub.textContent = last.error; return; }
    var r = last, notes = [];
    if (r.mode === 'line') {
      var n = r.hunks.filter(function (h) { return h.t === 'ch'; }).length;
      el.big.textContent = n ? H.num(n) + ' か所が違います' : '違いはありません';
      el.sub.textContent = '削除 ' + H.num(r.del) + ' 行・追加 ' + H.num(r.add) + ' 行・同じ ' + H.num(r.same) + ' 行（A ' + H.num(r.linesA.length) + ' 行、B ' + H.num(r.linesB.length) + ' 行）';
      if (r.eolA !== r.eolB && r.eolA !== 'なし' && r.eolB !== 'なし') notes.push('改行コードが違います（A: ' + r.eolA + '、B: ' + r.eolB + '）。');
      if (r.finalEolA !== r.finalEolB && r.linesA.length && r.linesB.length) notes.push('最後の行の後ろの改行が、' + (r.finalEolA ? 'B' : 'A') + ' にはありません。');
      if (n) el.out.innerHTML = r.hunks.length ? lineHtml(r) : '';
      el.actions.hidden = !n; el.viewRow.hidden = !n;
      $('d-copy-unified').hidden = false; $('d-all-label').hidden = false;
    } else {
      var changed = r.add + r.del;
      el.big.textContent = changed ? '削除 ' + H.num(r.del) + ' 字・追加 ' + H.num(r.add) + ' 字' : '違いはありません';
      el.sub.textContent = '同じ ' + H.num(r.same) + ' 字（A ' + H.num(r.lenA) + ' 字、B ' + H.num(r.lenB) + ' 字）';
      if (changed) el.out.innerHTML = charHtml(r);
      el.actions.hidden = !changed; el.viewRow.hidden = !changed;
      $('d-copy-unified').hidden = true; $('d-all-label').hidden = true;
    }
    if (r.approx) notes.push('違いが多いため、途中から速さを優先して分けました。最短の分け方ではない所があります。');
    if (notes.length) el.msg.textContent = notes.join(' ');
  }

  // --- 行単位の表示 ---
  function seg(list) {
    return list.map(function (p) { var t = H.esc(p[1]); return p[0] === '=' ? t : p[0] === '-' ? '<del>' + t + '</del>' : '<ins>' + t + '</ins>'; }).join('');
  }
  function lineHtml(r) {
    var split = view() === 'split', all = S.get().all, ctx = 3, rows = [], count = 0, more = false;
    function add(html) { if (count >= shownRows) { more = true; return false; } rows.push(html); count++; return true; }
    function eqRow(i, j) {
      var t = H.esc(r.linesB[j]);
      return split ? '<tr class="eq"><td class="n">' + (i + 1) + '</td><td class="c">' + H.esc(r.linesA[i]) + '</td><td class="n">' + (j + 1) + '</td><td class="c">' + t + '</td></tr>'
        : '<tr class="eq"><td class="n">' + (i + 1) + '</td><td class="n">' + (j + 1) + '</td><td class="s"></td><td class="c">' + t + '</td></tr>';
    }
    function fold(k) { return '<tr class="fold"><td colspan="4">… 同じ ' + H.num(k) + ' 行 …</td></tr>'; }
    for (var x = 0; x < r.hunks.length && !more; x++) {
      var h = r.hunks[x];
      if (h.t === 'eq') {
        var len = h.a1 - h.a0, first = x === 0, lastH = x === r.hunks.length - 1;
        var head = all ? len : first ? 0 : Math.min(ctx, len), tail = all ? 0 : lastH ? 0 : Math.min(ctx, len - head);
        for (var k = 0; k < head; k++) if (!add(eqRow(h.a0 + k, h.b0 + k))) break;
        if (len - head - tail > 0 && !all) add(fold(len - head - tail));
        for (k = len - tail; k < len; k++) if (!add(eqRow(h.a0 + k, h.b0 + k))) break;
        continue;
      }
      var na = h.a1 - h.a0, nb = h.b1 - h.b0, inl = h.inline || [];
      if (split) {
        for (var p = 0; p < Math.max(na, nb); p++) {
          var ia = p < na ? h.a0 + p : -1, jb = p < nb ? h.b0 + p : -1, pr = inl[p];
          var ca = ia < 0 ? '' : pr ? seg(pr.a) : H.esc(r.linesA[ia]), cb = jb < 0 ? '' : pr ? seg(pr.b) : H.esc(r.linesB[jb]);
          if (!add('<tr class="ch"><td class="n">' + (ia < 0 ? '' : ia + 1) + '</td><td class="c ' + (ia < 0 ? 'none' : 'del') + '">' + ca + '</td><td class="n">' + (jb < 0 ? '' : jb + 1) + '</td><td class="c ' + (jb < 0 ? 'none' : 'ins') + '">' + cb + '</td></tr>')) break;
        }
      } else {
        for (p = 0; p < na; p++) if (!add('<tr class="ch"><td class="n">' + (h.a0 + p + 1) + '</td><td class="n"></td><td class="s">−</td><td class="c del">' + (inl[p] ? seg(inl[p].a) : H.esc(r.linesA[h.a0 + p])) + '</td></tr>')) break;
        for (p = 0; p < nb; p++) if (!add('<tr class="ch"><td class="n"></td><td class="n">' + (h.b0 + p + 1) + '</td><td class="s">＋</td><td class="c ins">' + (inl[p] ? seg(inl[p].b) : H.esc(r.linesB[h.b0 + p])) + '</td></tr>')) break;
      }
    }
    var head2 = split ? '<colgroup><col class="n"><col><col class="n"><col></colgroup><thead><tr><th class="n">A</th><th>元の文章（A）</th><th class="n">B</th><th>新しい文章（B）</th></tr></thead>'
      : '<colgroup><col class="n"><col class="n"><col class="s"><col></colgroup><thead><tr><th class="n">A</th><th class="n">B</th><th class="s"></th><th>行</th></tr></thead>';
    var html = '<div class="diff-scroll"><table class="diff ' + (split ? 'split' : 'unified') + '">' + head2 + '<tbody>' + rows.join('') + '</tbody></table></div>';
    if (more) html += '<p class="more"><button type="button" class="btn-sub" id="d-more">続きを表示（' + H.num(ROWS) + ' 行ずつ）</button></p>';
    return html;
  }

  // --- 文字単位の表示 ---
  function charHtml(r) {
    if (view() === 'split') return '<div class="char-split"><div><p class="small">元の文章（A）</p><pre class="char">' + seg(r.a) + '</pre></div><div><p class="small">新しい文章（B）</p><pre class="char">' + seg(r.b) + '</pre></div></div>';
    return '<pre class="char">' + seg(r.inline) + '</pre>';
  }

  // --- 操作 ---
  H.attachFile(el.a, $('d-a-file'), function (name, enc) { el.msg.textContent = name + ' を開きました' + (enc ? '（' + enc + '）' : '') + '。'; update(); });
  H.attachFile(el.b, $('d-b-file'), function (name, enc) { el.msg.textContent = name + ' を開きました' + (enc ? '（' + enc + '）' : '') + '。'; update(); });
  el.a.addEventListener('input', later); el.b.addEventListener('input', later);
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'd-unit') S.set({ unit: t.value });
    else if (t.name === 'd-view') { S.set({ view: t.value }); render(); return; }
    else if (t.id === 'd-space') S.set({ space: t.checked });
    else if (t.id === 'd-case') S.set({ caseless: t.checked });
    else if (t.id === 'd-width') S.set({ width: t.checked });
    else if (t.id === 'd-all') { S.set({ all: t.checked }); shownRows = ROWS; render(); return; }
    else return;
    applySettings(); update();
  });
  el.out.addEventListener('click', function (e) { if (e.target.id === 'd-more') { shownRows += ROWS; render(); } });
  $('d-swap').addEventListener('click', function () { var t = H.val(el.a); H.setRaw(el.a, H.val(el.b)); H.setRaw(el.b, t); update(); });
  $('d-copy-unified').addEventListener('click', function () {
    run.run('unified', [H.val(el.a), H.val(el.b), opts(), { nameA: 'A', nameB: 'B' }]).then(function (u) { H.copy(u, el.msg); }, function () {});
  });
  applySettings();
  if (H.val(el.a) || H.val(el.b)) update();   // 戻るボタンでブラウザが入力を戻したとき
})();
