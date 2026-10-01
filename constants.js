// ===========================
// 変換の規則のもとにした仕様（出典と確認日）。check-site の古さチェックが CHECKED を読む
// 値そのものは lib/*.js の中（対応表・文法）。ここは「どこで確かめたか」の 1 か所
// ブラウザでは window.Constants、Node（テスト）では module.exports
// ===========================
(function (root) {
  'use strict';

  var CHECKED = '2026-09-25';          // いちばん古い確認日（check-site の古さチェックが読む）
  var CHECKED_PDF = '2026-10-01';      // PDF（/henkan/pdf/）の分を確かめた日

  var CONSTANTS = {
    CHECKED: CHECKED,
    CHECKED_PDF: CHECKED_PDF,
    SOURCES: {
      rfc4180: { label: 'RFC 4180 Common Format and MIME Type for CSV Files（2005、Informational）2 章', url: 'https://www.rfc-editor.org/rfc/rfc4180', checked: CHECKED, used: 'lib/csv.js の囲み・「""」・改行・最後の改行' },
      rfc8259: { label: 'RFC 8259 The JSON Data Interchange Format（2017）', url: 'https://www.rfc-editor.org/rfc/rfc8259', checked: CHECKED, used: 'lib/json.js の文法、6 章（数の精度 ±(2^53−1)）、8.1 章（BOM）' },
      uax15: { label: 'Unicode Standard Annex #15 Unicode Normalization Forms（Revision 58、Unicode 18.0.0、2026-08-12）', url: 'https://www.unicode.org/reports/tr15/', checked: CHECKED, used: 'guide の NFKC との違い' },
      ucd: { label: 'Unicode Character Database UnicodeData.txt（18.0.0）', url: 'https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt', checked: CHECKED, used: 'U+FF9E <narrow> 3099、U+309B <compat> 0020 3099、U+FFE5 <wide> 00A5 など（lib/kana.js の対応表）' },
      encoding: { label: 'WHATWG Encoding Standard（Last Updated 2026-05-21）', url: 'https://encoding.spec.whatwg.org/', checked: CHECKED, used: 'lib/csv.js の decode（shift_jis。windows-31j などのラベルも同じ）' },
      powerQuery: { label: 'Microsoft Learn Power Query Text/CSV（UTF-8 と推定するのは BOM で始まるときだけ）', url: 'https://learn.microsoft.com/power-query/connectors/text-csv', checked: CHECKED, used: 'csv/guide.html の BOM の説明' },
      pdf32000: { label: 'ISO 32000-1:2008（PDF 1.7。Adobe が公開している写し PDF32000_2008.pdf）7.7.3.3 Table 30 の Rotate、7.5.5 Table 15 の Encrypt、7.7.2 Table 28 の Outlines・AcroForm', url: 'https://archive.org/details/pdf320002008', checked: CHECKED_PDF, used: 'lib/pdf.js の回転（Rotate は 90 の倍数・時計回り）、暗号化の判定（trailer の Encrypt）、pdf/guide.html の「しおり・フォームは持ち込まない」' },
      pdfLib: { label: 'pdf-lib 1.17.1（MIT License、npm の dist/pdf-lib.min.js をそのまま vendor/pdf-lib/ に置いた。SHA-256 0f9a5cad…3bc694f）', url: 'https://www.npmjs.com/package/pdf-lib/v/1.17.1', checked: CHECKED_PDF, used: 'lib/pdf.js・lib/pdf-worker.js（PDF の読み書き）。ライセンスは vendor/pdf-lib/LICENSE.md と THIRD-PARTY-LICENSES.md' },
      partnerCenter: { label: 'Microsoft Learn Partner Center「Excel での CSV エンコードの問題を修正する」', url: 'https://learn.microsoft.com/ja-jp/partner-center/billing/use-the-reconciliation-files', checked: CHECKED, used: 'csv/guide.html の BOM の説明' },
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CONSTANTS;
  else root.Constants = CONSTANTS;
})(this);
