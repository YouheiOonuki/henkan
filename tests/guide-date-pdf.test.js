// 名前を guide-date.test.js から変えた（2026-11-27）: 共通の本体（root の tools/common/guide-date.test.js）は「ページ → 値 1 つ」で比べるが、henkan は「script が CHECKED と CHECKED_PDF の 2 つを ISO のまま描く」ので比べるので、repo だけの型として残す。
// 使い方の「最終確認日」が constants.js の CHECKED・CHECKED_PDF から出ていて、手で書いた控えが無いか（Q-275、Q-350。otasuke の tests/guide-date.test.js と同じ目的）。
// 使い方は日付を HTML に持たず、末尾の script が constants.js の日付を #checked・#checked-pdf に描く（正は 1 か所。loan-sim の guide-date.test.js と同じ形）。
// なので比べるのは (1) HTML に手書きの日付が無く、描く先の <time> が空か、(2) script を動かすと constants.js の日付がそのまま出るか。
// 「最終確認日」を書いたページが増えたら、EXPECT に無いと落ちる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const K = require('../constants.js');
// ページ → 描く先の id と、出る日付。guide.html は「最終確認日 CHECKED。PDF は CHECKED_PDF」、pdf/guide.html は PDF の分だけ
const EXPECT = {
  'guide.html': { src: './constants.js', ids: { checked: () => K.CHECKED, 'checked-pdf': () => K.CHECKED_PDF } },
  'pdf/guide.html': { src: '../constants.js', ids: { 'checked-pdf': () => K.CHECKED_PDF } },
};

// 「最終確認日」「Last checked」の直後（60 字以内）に手で書いた日付（空の <time datetime=""> は数えない）
function handDates(h) {
  const out = [];
  for (const m of h.matchAll(/(?:最終確認日|Last checked)([\s\S]{0,60})/g)) {
    const s = m[1];
    const t = s.match(/^[^<。.]*<time datetime="([^"]*)"[^>]*>([^<]*)<\/time>/);
    if (t) { if (t[1] || t[2]) out.push(t[0]); continue; }
    const a = s.match(/^[^。<]{0,8}?(\d{4}-\d{2}-\d{2}|\d{4} ?年 ?\d{1,2} ?月 ?\d{1,2} ?日)/);
    if (a) out.push(a[1]);
  }
  return out;
}

// script を動かすための最小の DOM
function runScript(h) {
  const body = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('K.CHECKED'));
  assert.ok(body, 'CHECKED を描く script が無い');
  const byId = {};
  const ids = [...h.matchAll(/<time datetime="" id="([^"]+)"><\/time>/g)].map((m) => m[1]);
  for (const id of ids) byId[id] = { textContent: '', dateTime: '' };
  const document = { getElementById: (id) => byId[id] || null };
  const window = {};
  const ctx = vm.createContext({ window, document });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'constants.js'), 'utf8'), Object.assign(ctx, { module: undefined }));
  window.Constants = ctx.Constants; // constants.js は this に Constants を置く（ブラウザでは window）
  vm.runInContext(body, ctx);
  return byId;
}

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'tools', '.github', 'vendor'].includes(e.name)) continue;
    const p = d ? `${d}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html') && /最終確認日|Last checked/.test(read(p))) pages.push(p);
  }
})('');

test('CHECKED・CHECKED_PDF は ISO の日付で、今日より先でない', () => {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) /* 今日は日本時間で数える（UTC だと 0〜9 時に当日の CHECKED で落ちる） */;
  for (const d of [K.CHECKED, K.CHECKED_PDF]) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d <= today, d);
  }
});

test('「最終確認日」を書いたページは全部 EXPECT にある（増えたらここに足す）', () => {
  assert.deepEqual(pages.sort(), Object.keys(EXPECT).sort());
});

for (const [p, { src, ids }] of Object.entries(EXPECT)) {
  test(`${p} は手書きの日付を持たず、constants.js を読み込んで日付を出す`, () => {
    const h = read(p);
    assert.deepEqual(handDates(h), []);
    assert.ok(h.includes(`<script src="${src}"></script>`), `${p} が ${src} を読み込んでいない`);
    const got = runScript(h);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(ids).sort());
    for (const [id, want] of Object.entries(ids)) {
      assert.equal(got[id].dateTime, want(), `${p} #${id}`);
      assert.equal(got[id].textContent, want(), `${p} #${id}`);
    }
  });
}
