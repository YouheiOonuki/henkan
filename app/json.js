// ===========================
// JSON 整形・検証の画面（計算は lib/json.js を Worker で）
// ===========================
(function () {
  'use strict';
  var form = document.getElementById('j-form');
  if (!form) return;
  var H = window.Henkan, $ = function (id) { return document.getElementById(id); };
  var el = { input: $('j-in'), out: $('j-out'), big: $('j-big'), sub: $('j-sub'), err: $('j-err'), notes: $('j-notes'), msg: $('j-msg'), preview: $('j-preview') };
  var S = H.settings('json', { mode: 'pretty', indent: '2', sortKeys: false, bom: true, tab: false });
  // 出力は textarea ではなく結果の文字列から取る（textarea の value は CRLF を LF にしてしまう）
  function rawOut() { return last && typeof last.text === 'string' ? last.text : ''; }
  var run = H.runner(), last = null;

  function applySettings() {
    var s = S.get();
    form.querySelectorAll('input[name=j-mode]').forEach(function (r) { r.checked = r.value === s.mode; });
    $('j-indent').value = s.indent; $('j-sort').checked = s.sortKeys; $('j-bom').checked = s.bom; $('j-tab').checked = s.tab;
    var st = { '2': '字下げ 2', '4': '字下げ 4', tab: '字下げ タブ' }[s.indent] + (s.sortKeys ? '・名前を並べ替え' : '');
    $('j-opt').querySelector('.opt-state').textContent = st;
  }

  function update() {
    var text = H.val(el.input), s = S.get();
    if (text.trim() === '') { last = null; render(); return; }
    el.sub.textContent = '確かめています…（' + H.size(text.length) + '）';
    run.run('json', [text, { mode: s.mode, indent: s.indent === 'tab' ? '\t' : Number(s.indent), sortKeys: s.sortKeys, csv: { delimiter: s.tab ? '\t' : ',' } }])
      .then(function (r) { last = r; render(); }, function (e) { if (e && e.cancelled) return; last = { ok: false, error: { message: String(e && e.message || e), line: 0, col: 0 } }; render(); });
  }
  var later = H.debounce(update, function () { return H.waitFor(H.val(el.input).length); });

  // 誤りのある行の前後と、位置の印（^）
  function around(text, e) {
    var lines = text.split(/\r\n|\n|\r/), i = e.line - 1, out = [];
    for (var k = Math.max(0, i - 2); k <= i && k < lines.length; k++) {
      var t = lines[k];
      if (t.length > 160) {   // 長い行（1 行に詰めた JSON など）は位置の前後だけ
        var cps = Array.from(t), start = k === i ? Math.max(0, e.col - 60) : 0;
        t = (start ? '…' : '') + cps.slice(start, start + 120).join('') + (cps.length > start + 120 ? '…' : '');
        if (k === i) out.push({ n: k + 1, t: t, caret: e.col - start + (start ? 1 : 0) });
        else out.push({ n: k + 1, t: t });
      } else out.push({ n: k + 1, t: t, caret: k === i ? e.col : 0 });
    }
    var w = String(e.line).length;
    return out.map(function (o) {
      var head = String(o.n).padStart(w) + ' | ';
      var line = head + o.t;
      if (o.caret) {
        // 全角の字は 2 桁ぶんとして ^ の位置をそろえる（等幅フォントの見た目）
        var pre = Array.from(o.t).slice(0, o.caret - 1).map(function (c) { return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\uD800-\uDBFF]/.test(c) ? '  ' : c === '\t' ? '\t' : ' '; }).join('');
        line += '\n' + ' '.repeat(head.length) + pre + '^';
      }
      return line;
    }).join('\n');
  }

  function render() {
    applySettings();
    el.err.innerHTML = ''; el.notes.innerHTML = ''; el.preview.innerHTML = ''; el.msg.textContent = '';
    if (!last) { el.big.textContent = '—'; el.sub.textContent = 'JSON を入れると、正しいかどうかと整えた形が出ます。'; H.showOut(el.out, ''); return; }
    if (!last.ok) {
      var e = last.error;
      el.big.textContent = e.line ? e.line + ' 行 ' + e.col + ' 文字目に誤り' : '読めませんでした';
      el.sub.textContent = e.message;
      H.showOut(el.out, '');
      if (e.line) el.err.innerHTML = '<div class="err-box">' + (e.hint ? H.esc(e.hint) : '') + '<pre>' + H.esc(around(H.val(el.input), e)) + '</pre>' +
        '<button type="button" class="btn-sub" id="j-goto">入力欄のその位置へ</button></div>';
      return;
    }
    var st = last.stats, kind = { obj: 'オブジェクト', arr: '配列', str: '文字列', num: '数', lit: '値' }[st.kind];
    el.big.textContent = '正しい JSON です';
    el.sub.textContent = '一番外は' + kind + '・値 ' + H.num(st.count) + ' 個・入れ子 ' + st.depth + ' 段';
    var notes = [];
    if (last.bom) notes.push('先頭に BOM（U+FEFF）がありました。出力には付けていません（RFC 8259 は付けないことを求めています）。');
    if (last.dupCount) notes.push('同じ名前（キー）が ' + H.num(last.dupCount) + ' か所で重なっています（例: ' + last.dupKeys.slice(0, 3).map(function (d) { return '「' + d.key + '」' + d.line + ' 行'; }).join('、') + '）。多くのプログラムは後ろの値だけを使います。');
    if (last.lossy.length) notes.push('JavaScript などでふつうに読むと丸められる大きな整数があります（例: ' + last.lossy.slice(0, 2).join('、') + '）。このツールは書いてあったとおりに出します。');
    if (S.get().mode === 'csv') {
      if (last.tableError) notes.push(last.tableError);
      else {
        notes.push(H.num(last.rows) + ' 行 × ' + H.num(last.cols) + ' 列の表にしました' + (last.header ? '（1 行目は名前。入れ子は「親.子」の列、配列は JSON のまま）' : '') + '。');
        el.preview.innerHTML = previewTable(last.preview, last.header);
      }
    }
    el.notes.innerHTML = notes.map(function (n) { return '<li>' + H.esc(n) + '</li>'; }).join('');
    H.showOut(el.out, last.text);
  }

  function previewTable(rows, header) {
    if (!rows || !rows.length) return '';
    var head = header ? rows[0] : null, body = header ? rows.slice(1) : rows;
    var h = '<p class="small">表の見本（先頭 ' + Math.min(body.length, 50) + ' 行）</p><div class="preview"><table>';
    if (head) h += '<thead><tr><th class="rn"></th>' + head.map(function (c) { return '<th>' + H.esc(c) + '</th>'; }).join('') + '</tr></thead>';
    h += '<tbody>' + body.slice(0, 50).map(function (r, i) { return '<tr><td class="rn">' + (i + 1) + '</td>' + r.map(function (c) { return '<td>' + H.esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }

  H.attachFile(el.input, $('j-file'), function (name, enc) { update(); el.msg.textContent = name + ' を開きました' + (enc ? '（' + enc + '）' : '') + '。'; });
  el.input.addEventListener('input', later);
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'j-mode') S.set({ mode: t.value });
    else if (t.id === 'j-indent') S.set({ indent: t.value });
    else if (t.id === 'j-sort') S.set({ sortKeys: t.checked });
    else if (t.id === 'j-bom') { S.set({ bom: t.checked }); applySettings(); return; }
    else if (t.id === 'j-tab') S.set({ tab: t.checked });
    else return;
    update();
  });
  el.err.addEventListener('click', function (e) {
    if (e.target.id !== 'j-goto' || !last || !last.error) return;
    var i = last.error.index;
    el.input.focus(); el.input.setSelectionRange(i, Math.min(H.val(el.input).length, i + 1));
    // 選んだ位置が見えるように、行の高さから大まかにスクロールする
    var lh = parseFloat(getComputedStyle(el.input).lineHeight) || 20;
    el.input.scrollTop = Math.max(0, (last.error.line - 3) * lh);
  });
  $('j-copy').addEventListener('click', function () { if (rawOut()) H.copy(rawOut(), el.msg); });
  $('j-save').addEventListener('click', function () {
    if (!rawOut()) return;
    var s = S.get(), csv = s.mode === 'csv';
    H.download(rawOut(), csv ? (s.tab ? 'data.tsv' : 'data.csv') : 'data.json', csv ? 'text/csv' : 'application/json', csv && s.bom);
    el.msg.textContent = csv && s.bom ? 'BOM 付きの UTF-8 で保存しました。' : 'UTF-8 で保存しました。';
  });
  applySettings();
  if (H.val(el.input)) update();
})();
