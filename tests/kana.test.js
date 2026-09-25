// 全角・半角・かなの変換（lib/kana.js）のテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../lib/kana.js');

const cv = (s, o) => K.convert(s, o).text;
const cp = (s) => [...s].map((c) => c.codePointAt(0).toString(16).toUpperCase());

test('半角カナ → 全角: 濁点・半濁点を前の字と 1 文字に合わせる', () => {
  assert.equal(cv('ｶﾞｲﾄﾞ', { kana: 'full' }), 'ガイド');
  assert.equal(cv('ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ', { kana: 'full' }), 'パピプペポ');
  assert.equal(cv('ｳﾞｧｲｵﾘﾝ', { kana: 'full' }), 'ヴァイオリン');
  assert.equal(cv('ﾜﾞｦﾞ', { kana: 'full' }), 'ヷヺ');
  assert.equal(cv('ｺｰﾋｰ｡｢ﾃｽﾄ｣､･', { kana: 'full' }), 'コーヒー。「テスト」、・');
  assert.equal(cv('ｧｨｩｪｫｬｭｮｯ', { kana: 'full' }), 'ァィゥェォャュョッ');
});

test('合わせられない ﾞ ﾟ は ゛ ゜（U+309B・U+309C）。NFKC のような結合用の U+3099 にしない', () => {
  assert.deepEqual(cp(cv('ﾞ', { kana: 'full' })), ['309B']);
  assert.deepEqual(cp(cv('ｱﾞ', { kana: 'full' })), ['30A2', '309B']);   // ア に濁点の字は無い
  assert.deepEqual(cp(cv('ﾏﾟ', { kana: 'full' })), ['30DE', '309C']);
  assert.deepEqual(cp('ﾞ'.normalize('NFKC')), ['3099']);   // 比べ: NFKC は結合用にする
});

test('全角カナ → 半角: 濁点つきは 2 文字、半角の字が無いものは残して数える', () => {
  assert.equal(cv('ガイド パン ヴァ ヷ ヺ', { kana: 'half' }), 'ｶﾞｲﾄﾞ ﾊﾟﾝ ｳﾞｧ ﾜﾞ ｦﾞ');
  assert.equal(cv('コーヒー。「テスト」、・゛゜', { kana: 'half' }), 'ｺｰﾋｰ｡｢ﾃｽﾄ｣､･ﾞﾟ');
  const r = K.convert('ヰヱヮヵヶヸヹ', { kana: 'half' });
  assert.equal(r.text, 'ヰヱヮヵヶヸヹ');
  assert.deepEqual(r.kept, { 'ヰ': 1, 'ヱ': 1, 'ヮ': 1, 'ヵ': 1, 'ヶ': 1, 'ヸ': 1, 'ヹ': 1 });
  assert.equal(cv('ガ', { kana: 'half' }), 'ｶﾞ');   // 分解された形
  assert.equal(cv('ひらがな', { kana: 'half' }), 'ひらがな');   // 半角のひらがなは無い
});

test('全角 → 半角 → 全角で元に戻る（半角の字があるカタカナすべて）', () => {
  const all = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロワヲンヴヷヺー。「」、・';
  assert.equal(cv(cv(all, { kana: 'half' }), { kana: 'full' }), all);
});

test('英数・記号・空白の全角 ⇔ 半角（U+FF01〜FF5E ⇔ U+0021〜007E、U+3000 ⇔ U+0020）', () => {
  assert.equal(cv('ＡＢＣ　１２３！＃（）～＼', { alnum: 'half', symbol: 'half', space: 'half' }), 'ABC 123!#()~\\');
  assert.equal(cv('ABC 123!#()~\\', { alnum: 'full', symbol: 'full', space: 'full' }), 'ＡＢＣ　１２３！＃（）～＼');
  assert.equal(cv('ＡＢＣ（１）', { alnum: 'half' }), 'ABC（1）');   // 記号はそのまま
  assert.equal(cv('ＡＢＣ（１）', { symbol: 'half' }), 'ＡＢＣ(１)');
  // 範囲の外は変えない: ￥（FFE5）・￣（FFE3）・〜（301C 波ダッシュ）・全角の中点
  assert.equal(cv('￥￣〜', { alnum: 'half', symbol: 'half', space: 'half' }), '￥￣〜');
  assert.equal(cv('1　 2', { space: 'half' }), '1  2');
});

test('ひらがな ⇔ カタカナ', () => {
  assert.equal(cv('ひらがな ゔ ゕゖ ゝゞ ー', { hira: 'kata' }), 'ヒラガナ ヴ ヵヶ ヽヾ ー');
  assert.equal(cv('カタカナ ヴ ヵヶ ヽヾ ヷ', { hira: 'hira' }), 'かたかな ゔ ゕゖ ゝゞ ヷ');
  // ひらがな → カタカナ → 半角は 1 回で（ひらがなを先に変える）
  assert.equal(cv('がっこう', { hira: 'kata', kana: 'half' }), 'ｶﾞｯｺｳ');
  // 半角カナ → ひらがなも 1 回で（幅をそろえてからひらがなに）
  assert.equal(cv('ｶﾞｯｺｳ', { hira: 'hira', kana: 'full' }), 'がっこう');
});

test('変えた字の数と「元→後」の内訳', () => {
  const r = K.convert('ｶﾞｶﾞＡ', { kana: 'full', alnum: 'half' });
  assert.equal(r.text, 'ガガA');
  assert.equal(r.changed, 3);
  assert.deepEqual(r.pairs, { 'ｶﾞ→ガ': 2, 'Ａ→A': 1 });
});

test('空白・改行の整理', () => {
  const s = '  a  b　　c  \r\n\r\n\r\nd\t\r\n\r\n';
  assert.equal(K.tidy(s, { trimEnd: true }), '  a  b　　c\r\n\r\n\r\nd\r\n\r\n');
  assert.equal(K.tidy(s, { collapseSpaces: true }), ' a b　c \r\n\r\n\r\nd\t\r\n\r\n');
  assert.equal(K.tidy(s, { blankLines: 'one' }), '  a  b　　c  \r\n\r\nd\t\r\n');
  assert.equal(K.tidy(s, { blankLines: 'none' }), '  a  b　　c  \r\nd\t');
  assert.equal(K.tidy('a\r\nb\rc\n', { eol: 'lf' }), 'a\nb\nc\n');
  assert.equal(K.tidy('a\nb', { eol: 'crlf' }), 'a\r\nb');
  assert.equal(K.tidy('\n\n a\n\n', { trimEdges: true }), ' a');
});

test('NFKC は選んだときだけ（①・㈱・㌔ も変わることを確かめる）', () => {
  assert.equal(cv('①㈱㌔', {}), '①㈱㌔');
  assert.equal(cv('①㈱㌔', { nfkc: true }), '1(株)キロ');
});

test('foldWidth（差分の「全角・半角を同じとみなす」）', () => {
  assert.equal(K.foldWidth('ｶｰﾄﾞ ＡＢＣ　１'), 'カード ABC 1');
  assert.equal(K.foldWidth('ﾊﾟﾝ'), K.foldWidth('パン'));
});
