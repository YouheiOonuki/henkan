// 「見本を入れる」（ROADMAP 7.241・Q-424）: 4 つの画面（diff・json・csv・zenkaku）と 1 ファイル版。
// 見本の字は constants.js の SAMPLES の 1 か所。欄が空のときだけ押せ、押すと今の動き（input → 結果）で結果が出る。見本は保存しない。
// 画面を開いて押すテストは Playwright（Chromium）が無い環境（GitHub Actions）では飛ばす:
//   NODE_PATH=<playwright を入れた node_modules> node --test tests/sample.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { SAMPLES } = require('../constants.js');

let hasPw = true;
try { require.resolve('playwright'); } catch (e) { hasPw = false; }

// 画面ごと: 入力の欄・見本のボタン・結果を見る所
const PAGES = {
  csv: { inputs: ['c-in'], btn: 'c-sample', texts: [SAMPLES.csv] },
  json: { inputs: ['j-in'], btn: 'j-sample', texts: [SAMPLES.json] },
  diff: { inputs: ['d-a', 'd-b'], btn: 'd-sample', texts: SAMPLES.diff },
  zenkaku: { inputs: ['k-in'], btn: 'k-sample', texts: [SAMPLES.zenkaku] },
};

test('見本の字は constants.js の 1 か所（行に書いた文のまま）', () => {
  assert.equal(SAMPLES.csv, '品名,数,単価\nりんご,3,120\n"みかん, 小",10,45');
  assert.equal(SAMPLES.json, '{"name":"りんご","count":3,"tags":["果物","赤"]}');
  assert.equal(SAMPLES.zenkaku, 'ＡＢＣ１２３　ｶﾀｶﾅ');
  assert.deepEqual(SAMPLES.diff, ['りんご\nみかん\nぶどう', 'りんご\nなし\nぶどう']);
  // 画面と app に見本の字を書かない（1 ファイル版は build.mjs が constants.js から入れる）
  for (const f of ['app/csv.js', 'app/json.js', 'app/diff.js', 'app/zenkaku.js', 'app/common.js'].concat(Object.keys(PAGES).map((t) => t + '/index.html'))) {
    for (const s of ['単価', 'みかん, 小', 'ＡＢＣ１２３', 'ぶどう']) assert.ok(!read(f).includes(s), f + ' に ' + s);
  }
});

test('各画面: ボタンは入力の欄のすぐ下に 1 つ、constants.js を app より先に読む。pdf には足さない', () => {
  for (const [t, c] of Object.entries(PAGES)) {
    const h = read(t + '/index.html');
    assert.equal(h.split('>見本を入れる</button>').length - 1, 1, t);
    const last = h.lastIndexOf('<textarea id="' + c.inputs[c.inputs.length - 1] + '"');
    const btn = h.indexOf('id="' + c.btn + '"');
    assert.ok(last > 0 && btn > last && btn < h.indexOf('result-card'), t + ' のボタンの位置');
    assert.ok(h.indexOf('<script src="../constants.js"></script>') < h.indexOf('<script src="../app/common.js"></script>'), t);
  }
  assert.ok(!read('pdf/index.html').includes('見本を入れる'));
});

test('見本の結果（Worker と同じ処理）: csv 3 行 3 列で 3 行目の品名に「,」、json は鍵 3 つ、zenkaku は既定の変換、diff は違う行 1', () => {
  global.HenkanKana = require('../lib/kana.js'); global.HenkanDiff = require('../lib/diff.js');
  global.HenkanJson = require('../lib/json.js'); global.HenkanCsv = require('../lib/csv.js');
  global.self = global; require('../lib/ops.js');
  const O = global.HenkanOps;
  const c = O.csv([SAMPLES.csv, { mode: 'csv' }]);
  assert.equal(c.rowCount, 3); assert.deepEqual(c.widths, { 3: 3 });
  assert.equal(c.preview[2][0], 'みかん, 小');
  const j = O.json([SAMPLES.json, { mode: 'pretty', indent: 2 }]);
  assert.ok(j.ok); assert.deepEqual(Object.keys(JSON.parse(j.text)), ['name', 'count', 'tags']);
  // zenkaku の既定は「表記をそろえる」（英数字は半角、カナは全角、空白は変えない。app/zenkaku.js の PRESETS.std）
  const k = O.kana([SAMPLES.zenkaku, { alnum: 'half', symbol: 'none', space: 'none', kana: 'full', hira: 'none', nfkc: false }]);
  assert.equal(k.text, 'ABC123　カタカナ');
  const d = O.diffLines([SAMPLES.diff[0], SAMPLES.diff[1], {}]);
  assert.equal(d.hunks.filter((h) => h.t === 'ch').length, 1);
  assert.equal(d.del, 1); assert.equal(d.add, 1); assert.equal(d.same, 2);
});

// --- 画面を開いて押す ---
async function check(page, t, c) {
  const st = () => page.evaluate(() => Object.keys(localStorage).sort().join(',') + '|' + localStorage.getItem('henkan_settings'));
  const btn = page.locator('#' + c.btn);
  const before = await st();
  assert.equal(await btn.isDisabled(), false, t + ': 空のときは押せる');
  const box = await btn.boundingBox();
  assert.ok(box.height >= 44 && box.width >= 44, t + ' のボタン ' + box.width + 'x' + box.height);
  await btn.click();   // 押す数 1
  for (let i = 0; i < c.inputs.length; i++) assert.equal(await page.inputValue('#' + c.inputs[i]), c.texts[i]);
  assert.equal(await btn.isDisabled(), true, t + ': 字が在ると押せない');
  const big = page.locator('#' + t[0] + '-big');
  if (t === 'csv') {
    await page.waitForFunction(() => document.getElementById('c-big').textContent === '3 行 × 3 列');
    assert.equal(await page.locator('#c-preview tr:nth-child(3) td:nth-child(2)').textContent(), 'みかん, 小');
  } else if (t === 'json') {
    await page.waitForFunction(() => document.getElementById('j-out').value !== '');
    assert.equal(Object.keys(JSON.parse(await page.inputValue('#j-out'))).length, 3);
  } else if (t === 'zenkaku') {
    await page.waitForFunction(() => document.getElementById('k-out').value !== '');
    assert.equal(await page.inputValue('#k-out'), 'ABC123　カタカナ');
  } else {
    await page.waitForFunction(() => document.getElementById('d-big').textContent !== '—');
    assert.equal(await big.textContent(), '1 か所が違います');
  }
  assert.equal(await st(), before, t + ': 保存の鍵・値が変わらない');
  // 欄を空にすると押せる。字を 1 つ打つと押せない
  for (const id of c.inputs) await page.fill('#' + id, '');
  assert.equal(await btn.isDisabled(), false);
  await page.fill('#' + c.inputs[0], 'x');
  assert.equal(await btn.isDisabled(), true);
}

test('画面を開く → 見本を入れる → 結果（4 画面と 1 ファイル版の 4 タブ）', { skip: hasPw ? false : 'playwright が無い', timeout: 120000 }, async () => {
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  try {
    for (const [t, c] of Object.entries(PAGES)) {
      const page = await b.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(/^https?:/, (r) => r.abort());   // 広告・解析は読まない
      await page.goto(pathToFileURL(path.join(ROOT, t, 'index.html')).href);
      await check(page, t, c);
      await page.close();
    }
    const page = await b.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.join(ROOT, 'henkan.html')).href);
    for (const [t, c] of Object.entries(PAGES)) {
      await page.click('#tabbtn-' + t);
      await check(page, t, c);
    }
    await page.close();
  } finally { await b.close(); }
});
