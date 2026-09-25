// ===========================
// 全角・半角・かな変換の画面（計算は lib/kana.js を Worker で）
// ===========================
(function () {
  'use strict';
  var form = document.getElementById('k-form');
  if (!form) return;
  var H = window.Henkan, $ = function (id) { return document.getElementById(id); };
  var el = { input: $('k-in'), out: $('k-out'), big: $('k-big'), sub: $('k-sub'), msg: $('k-msg'), pairs: $('k-pairs'), pairsBox: $('k-pairs-box') };
  // 変換のしかた（上の選択）と、くわしい設定の中身
  var PRESETS = {
    std: { alnum: 'half', symbol: 'none', space: 'none', kana: 'full', hira: 'none' },
    stdAll: { alnum: 'half', symbol: 'half', space: 'half', kana: 'full', hira: 'none' },
    kanaFull: { alnum: 'none', symbol: 'none', space: 'none', kana: 'full', hira: 'none' },
    alnumHalf: { alnum: 'half', symbol: 'none', space: 'none', kana: 'none', hira: 'none' },
    allFull: { alnum: 'full', symbol: 'full', space: 'full', kana: 'full', hira: 'none' },
    allHalf: { alnum: 'half', symbol: 'half', space: 'half', kana: 'half', hira: 'none' },
    toKata: { alnum: 'none', symbol: 'none', space: 'none', kana: 'none', hira: 'kata' },
    toHira: { alnum: 'none', symbol: 'none', space: 'none', kana: 'full', hira: 'hira' },
  };
  var FIELDS = ['alnum', 'symbol', 'space', 'kana', 'hira'];
  var S = H.settings('kana', { preset: 'std', alnum: 'half', symbol: 'none', space: 'none', kana: 'full', hira: 'none',
    trimEnd: false, collapse: false, edges: false, blank: 'keep', eol: 'keep', nfkc: false });
  // 出力は textarea ではなく結果の文字列から取る（textarea の value は CRLF を LF にしてしまう）
  function rawOut() { return last && typeof last.text === 'string' ? last.text : ''; }
  var run = H.runner(), last = null;
  var NAME = { half: '半角', full: '全角', none: '', kata: 'カタカナに', hira: 'ひらがなに' };

  function applySettings() {
    var s = S.get();
    if (!PRESETS[s.preset] && s.preset !== 'custom') s.preset = 'std';
    if (PRESETS[s.preset]) Object.assign(s, PRESETS[s.preset]);
    $('k-preset').value = s.preset;
    FIELDS.forEach(function (f) { $('k-' + f).value = s[f]; });
    $('k-trimend').checked = s.trimEnd; $('k-collapse').checked = s.collapse; $('k-edges').checked = s.edges;
    $('k-blank').value = s.blank; $('k-eol').value = s.eol; $('k-nfkc').checked = s.nfkc;
    var parts = [];
    if (s.alnum !== 'none') parts.push('英数字' + NAME[s.alnum]);
    if (s.symbol !== 'none') parts.push('記号' + NAME[s.symbol]);
    if (s.space !== 'none') parts.push('空白' + NAME[s.space]);
    if (s.kana !== 'none') parts.push('カナ' + NAME[s.kana]);
    if (s.hira !== 'none') parts.push(NAME[s.hira]);
    var tidy = s.trimEnd || s.collapse || s.edges || s.blank !== 'keep' || s.eol !== 'keep';
    if (tidy) parts.push('空白の整理');
    if (s.nfkc) parts.push('NFKC');
    $('k-opt').querySelector('.opt-state').textContent = parts.join('・') || '何も変えない';
  }

  function opts() {
    var s = S.get(), o = {};
    FIELDS.forEach(function (f) { o[f] = s[f]; });
    var tidy = { trimEnd: s.trimEnd, collapseSpaces: s.collapse, trimEdges: s.edges, blankLines: s.blank, eol: s.eol };
    if (s.trimEnd || s.collapse || s.edges || s.blank !== 'keep' || s.eol !== 'keep') o.tidy = tidy;
    o.nfkc = s.nfkc;
    return o;
  }

  function update() {
    var text = H.val(el.input);
    if (text === '') { last = null; render(); return; }
    run.run('kana', [text, opts()]).then(function (r) { last = r; render(); }, function (e) { if (e && e.cancelled) return; last = { fail: String(e && e.message || e) }; render(); });
  }
  var later = H.debounce(update, function () { return H.waitFor(H.val(el.input).length); });

  function render() {
    applySettings();
    el.msg.textContent = ''; el.pairs.innerHTML = ''; el.pairsBox.hidden = true;
    if (!last) { el.big.textContent = '—'; el.sub.textContent = '文章を入れると、変換した結果が出ます。'; H.showOut(el.out, ''); return; }
    if (last.fail) { el.big.textContent = '—'; el.sub.textContent = '変換できませんでした（' + last.fail + '）。'; return; }
    var same = last.text === H.val(el.input);
    el.big.textContent = last.changed ? H.num(last.changed) + ' か所を変換' : same ? '変える字はありませんでした' : '空白・改行を整理しました';
    var sub = [];
    var keys = Object.keys(last.pairs);
    if (keys.indexOf('NFKC 正規化') >= 0) sub.push('NFKC で変わった字があります');
    var kept = Object.keys(last.kept);
    if (kept.length) sub.push('半角の字が無いため残した字: ' + kept.map(function (k) { return k + '（' + last.kept[k] + '）'; }).join('・'));
    var linesIn = H.val(el.input).split(/\r\n|\n|\r/).length, linesOut = last.text.split(/\r\n|\n|\r/).length;
    if (linesIn !== linesOut) sub.push('行の数 ' + H.num(linesIn) + ' → ' + H.num(linesOut));
    el.sub.textContent = sub.join('。') || (last.changed ? '結果を下の欄からコピーできます。' : '');
    H.showOut(el.out, last.text);
    var list = keys.filter(function (k) { return k !== 'NFKC 正規化'; }).sort(function (a, b) { return last.pairs[b] - last.pairs[a]; });
    if (list.length) {
      el.pairsBox.hidden = false;
      el.pairs.innerHTML = list.slice(0, 60).map(function (k) { return '<li>' + H.esc(k) + ' ×' + H.num(last.pairs[k]) + '</li>'; }).join('') + (list.length > 60 ? '<li>ほか ' + (list.length - 60) + ' 種類</li>' : '');
    }
  }

  H.attachFile(el.input, $('k-file'), function (name, enc) { update(); el.msg.textContent = name + ' を開きました' + (enc ? '（' + enc + '）' : '') + '。'; });
  el.input.addEventListener('input', later);
  form.addEventListener('change', function (e) {
    var t = e.target, id = t.id.replace(/^k-/, '');
    if (t.id === 'k-preset') S.set({ preset: t.value });
    else if (FIELDS.indexOf(id) >= 0) { var p = { preset: 'custom' }; p[id] = t.value; S.set(p); }
    else if (t.id === 'k-trimend') S.set({ trimEnd: t.checked });
    else if (t.id === 'k-collapse') S.set({ collapse: t.checked });
    else if (t.id === 'k-edges') S.set({ edges: t.checked });
    else if (t.id === 'k-blank') S.set({ blank: t.value });
    else if (t.id === 'k-eol') S.set({ eol: t.value });
    else if (t.id === 'k-nfkc') S.set({ nfkc: t.checked });
    else return;
    if (t.id === 'k-preset' && t.value === 'custom') $('k-opt').open = true;
    update();
  });
  $('k-copy').addEventListener('click', function () { if (rawOut()) H.copy(rawOut(), el.msg); });
  $('k-save').addEventListener('click', function () { if (rawOut()) { H.download(rawOut(), 'henkan.txt', 'text/plain'); el.msg.textContent = 'UTF-8 で保存しました。'; } });
  applySettings();
  if (H.val(el.input)) update();
})();
