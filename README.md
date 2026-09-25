# テキスト変換（差分・JSON 整形・CSV 整形・全角半角）

公開 URL: **https://yorozu-craft.com/henkan/**

テキスト差分、JSON 整形・検証、CSV 整形・JSON 変換、全角・半角・かな変換の 4 つの道具。ブラウザの中だけで動き、入力は外部に送信しない。4 つをまとめた**通信しない 1 ファイル版 `henkan.html`** もある。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。企画は yorozu-plans の `docs/45_テキスト変換.md`（台帳 K27）。

## ページ

| URL | 中身 | 広告・解析 |
|-----|------|-----------|
| `/henkan/` | 入口（4 つへのリンク・1 ファイル版のダウンロード） | あり |
| `/henkan/diff/` | テキスト差分（行・文字、左右／1 列、空白・大小・全角半角を無視、unified 形式でコピー） | あり |
| `/henkan/json/` | JSON 整形・検証（誤りの行・列と理由を日本語で、1 行に詰める、名前の並べ替え、CSV に） | あり |
| `/henkan/csv/` | CSV 整形・変換（区切りの自動判定、表の見本、RFC 4180 の形に整える、JSON に、BOM 付き保存、Shift_JIS 読み込み） | あり |
| `/henkan/zenkaku/` | 全角・半角・かな変換（英数・記号・空白・カナの全角半角、ひらがな⇔カタカナ、空白と改行の整理、NFKC は任意） | あり |
| `*/guide.html` | 使い方・しくみ・よくある質問（`/henkan/guide.html` は出どころとライセンス） | あり |
| `henkan.html` | 1 ファイル版（タブで 4 つ）。`noindex`・sitemap に載せない | **なし**（CSP で通信も禁止） |

## しくみ

- 計算は `lib/*.js`（DOM に触らない純粋関数、UMD）。画面は `app/*.js`。重い処理は `lib/worker.js`（Web Worker）で動かし、前の計算中に次の入力が来たら前の Worker を止めて作り直す（`app/common.js` の `runner`）。Worker が使えない環境では同じ処理（`lib/ops.js`）を画面側で呼ぶ
- 30 万字を超えるファイルは入力欄・結果欄に表示しない（ブラウザが入力欄に数 MB を並べるだけで数秒止まるため。2.3MB で約 3.5 秒、2026-09-25 に Playwright の Chromium で計測）。中身は別に持ち、コピー・保存で取り出す
- 入力欄の `value` は改行を LF にそろえてしまうので、開いたファイル（CRLF など）と結果は文字列のまま持ち、コピー・保存はそちらから出す

### 差分（`lib/diff.js`）

- Myers の O(ND) アルゴリズムの線形空間版（E. W. Myers, "An O(ND) Difference Algorithm and Its Variations", Algorithmica 1 (1986)）。分割の書き方は GNU diffutils の diffseq.h と同じ形で、コードは自前（ライブラリは使っていない）
- 速さの工夫: 前後の一致を切る／相手側に出てこない行を先に外す（最短は変わらない）／行を整数に置き換える／1 回の探索の深さに上限 `max(256, 4e7/(N+M))`。上限を超えたら GNU diff と同じ近似で分け、画面に「最短ではない所がある」と出す
- 行の中の強調: 変わった行どうしを同じ位置で組にして字単位で比べ、同じ字が 35% 未満の組は強調しない
- 無視する違い: 比べるときだけ `\s` を除く（全角スペースを含む）・小文字にする・`HenkanKana.foldWidth`（英数記号と空白は半角、半角カナは全角）。表示は元のまま
- 改行コード・最後の改行の有無は比べず、違えば画面に出す。`unified()` は `diff -u` と同じ形（`\ No newline at end of file` も）

### JSON（`lib/json.js`）

- 自前の読み取り（RFC 8259）。数と文字列は元の文字のまま持ち、整形しても変えない（JSON.parse を通すと 12345678901234567890 → 12345678901234567000、1.10 → 1.1、`"あ"` → `"あ"`）
- 誤りは行（改行で数える。CRLF は 1 つ）と列（字の数。サロゲートペアも 1 字）と日本語の理由・直し方。よくある誤り（最後のカンマ、シングルクォート、コメント、0 で始まる数、文字列の中の改行、全角の：，と全角スペース、True/NaN など）は専用の文
- 先頭の BOM は読み飛ばして知らせる。重なった名前と、倍精度で丸められる整数を知らせる。入れ子は 2000 段まで
- 表にする: 一番外が配列。要素がオブジェクトなら名前を列（出てきた順）、入れ子のオブジェクトは「親.子」、配列は JSON のまま 1 セル。null は空

### CSV（`lib/csv.js`）

- 書き出しは RFC 4180 2 章: 区切り・`"`・改行を含むセル（と前後に空白があるセル）だけ囲み、`"` は `""`。改行は CRLF（既定）か LF
- 読み取りは広く: CRLF・LF・CR、区切りはカンマ・タブ・セミコロン・縦棒。閉じない `"` は始まりの行番号つきのエラー、囲まないセルの中の `"` は文字として読んで注意
- 区切りの判定: 先頭 100 レコードを 4 候補で読み、列数がいちばんそろうもの
- 文字コード: BOM（UTF-8・UTF-16）→ UTF-8（fatal）→ Shift_JIS（WHATWG Encoding の shift_jis）
- JSON にする: 1 行目を名前（空は「列N」、重なりは「名前_2」）。「数字を数に」は 0 で始まらない整数・小数で、安全な範囲のものだけ

### 全角・半角・かな（`lib/kana.js`）の対応表

| 種類 | 全角 | 半角 |
|------|------|------|
| 英数字・記号 | U+FF01〜U+FF5E | U+0021〜U+007E（1 対 1） |
| 空白 | U+3000 | U+0020 |
| カタカナ | ア〜ン・ァ〜ッ・ー・ヲ・。「」、・゛゜ | U+FF61〜U+FF9F |
| 濁点つき | ガ〜ボ・パ〜ポ・ヴ・ヷ・ヺ | 2 文字（ｶﾞ など）。半角 → 全角では 1 文字に合わせる |

- 半角の字が無いもの（ヰ ヱ ヮ ヵ ヶ ヸ ヹ）は変えずに残して数える。合わせられない ﾞ ﾟ は ゛ ゜（U+309B/309C）
- 範囲の外の ￥ ￣ 〜（U+301C）は変えない
- ひらがな⇔カタカナ: U+3041〜3096 ⇔ U+30A1〜30F6、ゝゞ ⇔ ヽヾ。ひらがな → カタカナは幅より先、カタカナ → ひらがなは幅より後にかける
- NFKC だけにしない理由（UnicodeData.txt で確認）: ①→1・㈱→(株)・㌔→キロ なども変わる／単独の ﾞ（U+FF9E）は結合用の U+3099 になる、゛（U+309B）は U+0020 U+3099 になる／￥ は ¥（U+00A5）／半角にする向きが無い。NFKC は設定で任意にかけられる

## データの出どころとライセンス

外部のデータ・ライブラリは使っていない（すべて自前のコード）。規則のもとにした仕様（`constants.js` の `SOURCES`、`CHECKED = '2026-09-25'`）:

| 仕様 | URL | 使った所 |
|------|-----|---------|
| RFC 4180（2005、Informational） | https://www.rfc-editor.org/rfc/rfc4180 | CSV の囲み・`""`・改行 |
| RFC 8259（2017） | https://www.rfc-editor.org/rfc/rfc8259 | JSON の文法、6 章（数の精度）、8.1 章（BOM） |
| UAX #15 Unicode Normalization Forms（Revision 58、Unicode 18.0.0） | https://www.unicode.org/reports/tr15/ | NFKC との違いの説明 |
| UnicodeData.txt（18.0.0） | https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt | 全角・半角の分解の指定 |
| WHATWG Encoding Standard | https://encoding.spec.whatwg.org/ | Shift_JIS の読み込み |
| Microsoft Learn（Power Query Text/CSV、Partner Center の CSV エンコード） | constants.js に URL | BOM の説明 |
| Myers (1986) | 論文 | 差分のアルゴリズム |

Microsoft Excel は Microsoft の商標。このツールは Microsoft とは関係ない（csv/guide.html にも 1 文）。

コードは MIT License（`LICENSE`）。

## 保存

- `localStorage` のキーは `henkan_settings` だけ（4 つの道具の設定。貼った文章は保存しない）。各ページの「設定の保存・書き出し」に、書き出し・読み込み（`henkan-backup-YYYYMMDD.json`）と「保存した内容をすべて消す（初期状態に戻す）」（`data-reset-storage="henkan_"`、`reset-storage.js`。K123 の共通部品と同じもの）
- オフライン対応: `sw.js`（キャッシュ名 `henkan-v1`、`./` 配下だけ）

## ビルドとテスト

```sh
node build.mjs                # henkan.html を作る（依存パッケージなし）
node --test tests/*.test.js
```

- `build.mjs` は `diff/ json/ csv/ zenkaku/` の `index.html` から `<!-- TOOL-BEGIN … -->`〜`<!-- TOOL-END -->` を取り出し、`style.css`・`lib/*.js`・`app/*.js`・`reset-storage.js` を埋め込む。Worker は `lib/*.js` と `lib/worker.js` をつなげた `<script type="text/plain">` を Blob にする。CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src blob:; connect-src 'none'`
- ツールのブロックの中に相対リンクを書かない（1 ファイル版で切れる。ビルドが止まる）
- **`lib/`・`app/`・`style.css`・ツールのページを直したら `node build.mjs` して `henkan.html` も一緒にコミットする**（`tests/site.test.js` が一致を確かめる）。サイズが ±15KB 変わったら `index.html` の「約 ○KB」も直す
- テスト: 差分（乱数 2000 組で最短＝最長共通部分列の長さと一致・B に戻せる、GNU diff -u との一致、端の場合、無視の選択、6 万行 3 秒以内、全部違う 2 万行、近似で止まる）、JSON（JSON.parse と同じ受け入れ・拒否、誤りの行・列、数の保持、整形、表）、CSV（RFC 4180 の例、崩れた CSV、区切りの判定、往復 500 表、JSON、Shift_JIS）、全角半角（濁点、往復、対応表の外、ひらがな、整理、NFKC）、サイト（1 ファイル版の一致・通信なし、ページのリンク、sitemap・sw.js）、消すボタン

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| 確認日から 12 か月（2027-09） | RFC 4180・8259 の改訂（Obsoleted by）、Unicode の新しい版で半角・全角の区画に変更がないか | `constants.js`、`lib/*.js`、`guide.html` |
| 問い合わせのとき | Excel の CSV の読み方（BOM）の資料 | `csv/guide.html` |

直したら各 `guide.html` の「更新履歴」に 1 行足す。
