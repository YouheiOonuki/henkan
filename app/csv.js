// ===========================
// CSV 整形・変換の画面（計算は lib/csv.js を Worker で）
// ===========================
(function () {
  'use strict';
  var form = document.getElementById('c-form');
  if (!form) return;
  var H = window.Henkan, $ = function (id) { return document.getElementById(id); };
  var el = { input: $('c-in'), out: $('c-out'), big: $('c-big'), sub: $('c-sub'), notes: $('c-notes'), msg: $('c-msg'), preview: $('c-preview') };
  var S = H.settings('csv', { mode: 'csv', delim: 'auto', outDelim: ',', quote: 'auto', eol: 'crlf', bom: true, header: true, numbers: false });
  // 出力は textarea ではなく結果の文字列から取る（textarea の value は CRLF を LF にしてしまう）
  function rawOut() { return last && typeof last.text === 'string' ? last.text : ''; }
  var run = H.runner(), last = null, encoding = '';
  var TAB = function (v) { return v === 'tab' ? '\t' : v; };

  function applySettings() {
    var s = S.get();
    form.querySelectorAll('input[name=c-mode]').forEach(function (r) { r.checked = r.value === s.mode; });
    $('c-delim').value = s.delim; $('c-outdelim').value = s.outDelim; $('c-quote').value = s.quote; $('c-eol').value = s.eol;
    $('c-bom').checked = s.bom; $('c-header').checked = s.header; $('c-numbers').checked = s.numbers;
    var name = { auto: '区切りは自動', ',': '区切りはカンマ', tab: '区切りはタブ', ';': '区切りはセミコロン', '|': '区切りは縦棒' }[s.delim];
    $('c-opt').querySelector('.opt-state').textContent = name + (s.bom ? '・BOM 付きで保存' : '');
  }

  function update() {
    var text = H.val(el.input), s = S.get();
    if (text === '') { last = null; render(); return; }
    el.sub.textContent = '読んでいます…（' + H.size(text.length) + '）';
    run.run('csv', [text, { delimiter: TAB(s.delim), mode: s.mode, header: s.header, numbers: s.numbers, outDelimiter: TAB(s.outDelim), quote: s.quote, eol: s.eol === 'lf' ? '\n' : '\r\n' }])
      .then(function (r) { last = r; render(); }, function (e) { if (e && e.cancelled) return; last = { fail: String(e && e.message || e) }; render(); });
  }
  var later = H.debounce(update, function () { return H.waitFor(H.val(el.input).length); });

  function render() {
    applySettings();
    el.notes.innerHTML = ''; el.preview.innerHTML = ''; el.msg.textContent = '';
    if (!last) { el.big.textContent = '—'; el.sub.textContent = 'CSV を入れると、表の形と変換した結果が出ます。'; H.showOut(el.out, ''); return; }
    if (last.fail) { el.big.textContent = '—'; el.sub.textContent = '読めませんでした（' + last.fail + '）。'; return; }
    var r = last, cols = Object.keys(r.widths).map(Number), maxCols = Math.max.apply(null, cols.concat([0]));
    var dname = window.HenkanCsv.NAMES[r.delimiter];
    el.big.textContent = H.num(r.rowCount) + ' 行 × ' + H.num(maxCols) + ' 列';
    el.sub.textContent = '区切り: ' + dname + (S.get().delim === 'auto' ? '（自動で判定）' : '') + (encoding ? '・文字コード: ' + encoding : '');
    var notes = [];
    if (r.error) notes.push(r.error.message + ' その行から後ろは 1 つのフィールドとして読みました。');
    if (cols.length > 1) {
      var list = cols.sort(function (a, b) { return r.widths[b] - r.widths[a]; }).map(function (c) { return c + ' 列が ' + H.num(r.widths[c]) + ' 行'; });
      notes.push('列の数が行によって違います（' + list.slice(0, 4).join('、') + '）。区切りか「"」の囲み方を確かめてください。');
    }
    if (S.get().delim === 'auto' && !r.detected.sure && maxCols > 1) notes.push('区切りの判定に自信がありません。違っていたら「読み方・書き方」で選んでください。');
    r.warnings.slice(0, 5).forEach(function (w) { notes.push(w.message); });
    if (r.warnings.length > 5) notes.push('ほかにも注意が ' + (r.warnings.length - 5) + ' 件あります。');
    el.notes.innerHTML = notes.map(function (n) { return '<li>' + H.esc(n) + '</li>'; }).join('');
    el.preview.innerHTML = previewTable(r.preview, maxCols);
    H.showOut(el.out, r.text);
  }

  function previewTable(rows, width) {
    if (!rows.length) return '';
    var n = Math.min(rows.length, 100);
    var h = '<p class="small">表の見本（先頭 ' + n + ' 行。セルの中の改行はそのまま）</p><div class="preview"><table><tbody>';
    for (var i = 0; i < n; i++) {
      var r = rows[i], cells = '';
      for (var k = 0; k < width; k++) cells += '<td>' + (k < r.length ? H.esc(r[k]) : '') + '</td>';
      h += '<tr><td class="rn">' + (i + 1) + '</td>' + cells + '</tr>';
    }
    return h + '</tbody></table></div>';
  }

  H.attachFile(el.input, $('c-file'), function (name, enc) { encoding = enc || ''; update(); });
  el.input.addEventListener('input', function () { encoding = ''; later(); });
  form.addEventListener('change', function (e) {
    var t = e.target, map = { 'c-delim': 'delim', 'c-outdelim': 'outDelim', 'c-quote': 'quote', 'c-eol': 'eol' };
    if (t.name === 'c-mode') S.set({ mode: t.value });
    else if (map[t.id]) { var p = {}; p[map[t.id]] = t.value; S.set(p); }
    else if (t.id === 'c-bom') { S.set({ bom: t.checked }); applySettings(); return; }
    else if (t.id === 'c-header') S.set({ header: t.checked });
    else if (t.id === 'c-numbers') S.set({ numbers: t.checked });
    else return;
    update();
  });
  $('c-copy').addEventListener('click', function () { if (rawOut()) H.copy(rawOut(), el.msg); });
  $('c-save').addEventListener('click', function () {
    if (!rawOut()) return;
    var s = S.get(), json = s.mode === 'json', tsv = !json && (s.outDelim === 'tab' || (s.outDelim === 'same' && last && last.delimiter === '\t'));
    H.download(rawOut(), json ? 'data.json' : tsv ? 'data.tsv' : 'data.csv', json ? 'application/json' : 'text/csv', !json && s.bom);
    el.msg.textContent = !json && s.bom ? 'BOM 付きの UTF-8 で保存しました（Excel でそのまま開けます）。' : 'UTF-8 で保存しました。';
  });
  applySettings();
  if (H.val(el.input)) update();
})();
