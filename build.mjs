// 通信しない 1 ファイル版（henkan.html）を作る: node build.mjs
// - 4 つの道具のページ（diff/ json/ csv/ zenkaku/ の index.html）から <!-- TOOL-BEGIN … --> 〜 <!-- TOOL-END --> を取り出し、タブで並べる
// - style.css・lib/*.js・app/*.js・reset-storage.js を埋め込む。Worker は lib/*.js と lib/worker.js をつなげた文字列を Blob にする
// - 外部への通信は CSP で禁止（connect-src 'none'）。広告・アクセス解析は入れない
// 依存パッケージなし。同じ入力なら同じ henkan.html になる（tests/build.test.js が確かめる）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
export const TOOLS = [
  { key: 'diff', label: 'テキスト差分' },
  { key: 'json', label: 'JSON 整形' },
  { key: 'csv', label: 'CSV 整形' },
  { key: 'zenkaku', label: '全角・半角・かな' },
];
export const LIBS = ['lib/kana.js', 'lib/diff.js', 'lib/json.js', 'lib/csv.js', 'lib/ops.js'];
export const APPS = ['reset-storage.js', 'app/common.js', 'app/diff.js', 'app/json.js', 'app/csv.js', 'app/zenkaku.js', 'app/boot.js'];

function script(src, name) {
  if (/<script/i.test(src)) throw new Error(name + ' に「<script」がある（埋め込めない）');
  return src.replace(/<\/script/gi, '<\\/script');
}

export function build() {
  const blocks = TOOLS.map((t) => {
    const html = read(t.key + '/index.html');
    const m = new RegExp('<!-- TOOL-BEGIN ' + t.key + ' -->\\n([\\s\\S]*?)<!-- TOOL-END -->').exec(html);
    if (!m) throw new Error(t.key + '/index.html に TOOL-BEGIN〜TOOL-END が無い');
    if (/\s(src|href)="(?!https:\/\/yorozu-craft\.com\/)[^"#]/.test(m[1])) throw new Error(t.key + ' の中に相対リンクがある（1 ファイル版では切れる）');
    return `<section class="tab-panel" id="tab-${t.key}" role="tabpanel" aria-labelledby="tabbtn-${t.key}"${t.key === 'diff' ? '' : ' hidden'}>\n${m[1]}</section>`;
  });
  const worker = LIBS.concat(['lib/worker.js']).map((p) => `// ---- ${p} ----\n` + read(p)).join('\n');
  const code = LIBS.concat(APPS).map((p) => `// ---- ${p} ----\n` + read(p)).join('\n');
  const tabs = `
// ---- タブ（1 ファイル版だけ）。選んだタブは # に入れる（保存しない） ----
(function () {
  'use strict';
  var btns = document.querySelectorAll('.tabs [role=tab]');
  function show(key, focus) {
    btns.forEach(function (b) {
      var on = b.getAttribute('data-tab') === key;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      document.getElementById('tab-' + b.getAttribute('data-tab')).hidden = !on;
      if (on && focus) b.focus();
    });
  }
  btns.forEach(function (b, i) {
    b.addEventListener('click', function () { show(b.getAttribute('data-tab')); history.replaceState(null, '', '#' + b.getAttribute('data-tab')); });
    b.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      var n = btns[(i + d + btns.length) % btns.length]; show(n.getAttribute('data-tab'), true);
    });
  });
  var h = (location.hash || '').slice(1);
  if (document.getElementById('tab-' + h)) show(h);
})();
`;
  const css = read('style.css');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="robots" content="noindex">
<title>テキスト変換（通信しない 1 ファイル版）｜yorozu-craft</title>
<!-- テキスト差分・JSON 整形・CSV 整形・全角半角かな変換。https://yorozu-craft.com/henkan/ の 1 ファイル版（MIT License、Youhei Oonuki）。
     このファイルは外部と通信しません（上の Content-Security-Policy で禁止）。ビルド: node build.mjs -->
<style>
${css}
</style>
</head>
<body>
<header class="app-header">
  <h1>テキスト変換</h1>
  <p class="subtitle">差分・JSON・CSV・全角半角。このファイルは通信しません。</p>
</header>
<nav class="tabs" role="tablist" aria-label="道具">
${TOOLS.map((t, i) => `  <button type="button" role="tab" id="tabbtn-${t.key}" data-tab="${t.key}" aria-controls="tab-${t.key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${t.label}</button>`).join('\n')}
</nav>
<main class="app-main app-wide">
${blocks.join('\n')}
<details class="card opt" id="file-box">
  <summary>設定の保存・書き出し</summary>
  <p class="small">設定はこの端末のブラウザ（localStorage、キー <code>henkan_settings</code>）にだけ保存されます。貼り付けた文章は保存しません。書き出し・読み込み・消去はこの画面のボタンから。</p>
  <div class="btn-row">
    <button type="button" class="btn backup-export">ファイルに書き出す</button>
    <button type="button" class="btn backup-import">ファイルから読み込む</button>
    <button type="button" class="btn btn-reset" data-reset-storage="henkan_">保存した内容をすべて消す（初期状態に戻す）</button>
  </div>
  <input type="file" accept=".json,application/json" hidden>
  <p class="small backup-msg" aria-live="polite"></p>
</details>
<p class="small">使い方と最新版: <a href="https://yorozu-craft.com/henkan/">https://yorozu-craft.com/henkan/</a>（yorozu-craft）。MIT License。</p>
</main>
<script type="text/plain" id="henkan-worker-src">
${script(worker, 'worker')}
</script>
<script>
${script(code + tabs, 'code')}
</script>
</body>
</html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = build();
  fs.writeFileSync(path.join(ROOT, 'henkan.html'), out);
  console.log('henkan.html', Buffer.byteLength(out), 'bytes');
}
