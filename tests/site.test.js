// ページと 1 ファイル版の決まりごとのテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TOOLS = ['diff', 'json', 'csv', 'zenkaku'];
const PAGES = ['index.html', 'guide.html'].concat(...TOOLS.map((t) => [t + '/index.html', t + '/guide.html']));

test('constants: 出典に url と確認日がある', () => {
  const C = require('../constants.js');
  assert.match(C.CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  for (const [k, s] of Object.entries(C.SOURCES)) {
    assert.ok(s.label && /^https:\/\//.test(s.url) && s.checked === C.CHECKED, k);
  }
});

test('1 ファイル版 henkan.html は build.mjs の出力と同じ（src を直したらビルドしてコミット）', async () => {
  const { build } = await import(path.join(ROOT, 'build.mjs'));
  assert.equal(read('henkan.html'), build());
});

test('1 ファイル版: 外部のファイルを読まない・通信を CSP で禁止・広告と解析なし', () => {
  const h = read('henkan.html');
  assert.match(h, /connect-src 'none'/);
  assert.match(h, /default-src 'none'/);
  assert.doesNotMatch(h, /<script[^>]+src=/i);
  assert.doesNotMatch(h, /<link[^>]+href=/i);
  assert.doesNotMatch(h, /googlesyndication|cloudflareinsights|google-adsense/);
  // 4 つの道具が入っている
  for (const t of ['d-form', 'j-form', 'c-form', 'k-form', 'henkan-worker-src']) assert.ok(h.includes('id="' + t + '"'), t);
  // 入口ページの「約 ○KB」がずれていない（±15KB）
  const kb = Number(/henkan\.html・約 (\d+)KB/.exec(read('index.html'))[1]);
  assert.ok(Math.abs(Buffer.byteLength(h) / 1000 - kb) <= 15, Buffer.byteLength(h) + ' bytes vs 約 ' + kb + 'KB');
});

test('各ページ: canonical・OGP・AdSense・ビーコン・共通ページへの相対リンク・読み込むファイルがある', () => {
  for (const p of PAGES) {
    const h = read(p), depth = p.split('/').length - 1;
    const url = 'https://yorozu-craft.com/henkan/' + p.replace(/index\.html$/, '');
    assert.ok(h.includes('<link rel="canonical" href="' + url + '">'), p + ' canonical');
    assert.ok(h.includes('og:image" content="https://yorozu-craft.com/henkan/og-image.png"'), p);
    assert.ok(h.includes('ca-pub-5375267956079717') && h.includes('static.cloudflareinsights.com/beacon.min.js'), p);
    assert.ok(h.includes('href="' + '../'.repeat(depth + 1) + 'privacy-policy.html"'), p + ' privacy');
    for (const m of h.matchAll(/(?:src|href)="(\.{1,2}\/[^"#?]*)"/g)) {
      const target = path.normalize(path.join(path.dirname(p), m[1]));
      if (target.startsWith('..')) continue;   // サイト直下の共通ページ
      const f = path.join(ROOT, target.endsWith(path.sep) || m[1].endsWith('/') ? path.join(target, 'index.html') : target);
      assert.ok(fs.existsSync(f), p + ' → ' + m[1]);
    }
  }
});

test('sitemap と sw.js の一覧がページ・ファイルとそろっている', () => {
  const sm = read('sitemap.xml');
  for (const p of PAGES) assert.ok(sm.includes('https://yorozu-craft.com/henkan/' + p.replace(/index\.html$/, '') + '</loc>'), p);
  const sw = read('sw.js');
  assert.match(sw, /const CACHE_PREFIX = 'henkan-';/);
  for (const m of sw.matchAll(/'\.\/([^']*)'/g)) {
    const f = m[1] === '' || m[1].endsWith('/') ? path.join(ROOT, m[1], 'index.html') : path.join(ROOT, m[1]);
    assert.ok(fs.existsSync(f), 'sw.js の ' + m[1]);
  }
  const man = JSON.parse(read('manifest.webmanifest'));
  assert.equal(man.id, '/henkan/');
});

test('保存のキーは henkan_ で始まる（localStorage に書くのは app/common.js だけ）', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'app'))) {
    const s = read('app/' + f);
    if (f !== 'common.js') assert.doesNotMatch(s, /localStorage/, f);
  }
  assert.match(read('app/common.js'), /var KEY = 'henkan_settings';/);
});

test('ops: Worker と同じ処理を Node でも呼べる（JSON → CSV、CSV → JSON）', () => {
  global.HenkanKana = require('../lib/kana.js'); global.HenkanDiff = require('../lib/diff.js');
  global.HenkanJson = require('../lib/json.js'); global.HenkanCsv = require('../lib/csv.js');
  global.self = global; require('../lib/ops.js');
  const O = global.HenkanOps;
  const j = O.json(['[{"a":1,"b":"x,y"}]', { mode: 'csv', csv: {} }]);
  assert.equal(j.text, 'a,b\r\n1,"x,y"\r\n');
  const c = O.csv(['a\tb\n1\t2', { mode: 'json', header: true }]);
  assert.equal(c.delimiter, '\t');
  assert.deepEqual(JSON.parse(c.text), [{ a: '1', b: '2' }]);
  assert.equal(O.kana(['ｶﾞ', { kana: 'full' }]).text, 'ガ');
});
