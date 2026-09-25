// ===========================
// どのページでも最後に読む: 設定の書き出し・読み込みと、オフライン対応（Service Worker）の登録
// ===========================
(function () {
  'use strict';
  window.Henkan.wireBackup(document.getElementById('file-box'));
  // 登録は ./sw.js（リポジトリの直下）だけ。scope: '/' を指定しない（README「ツールを追加するとき」13）。1 ファイル版では登録しない
  var root = document.body.getAttribute('data-root');
  if (root && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', function () { navigator.serviceWorker.register(root + 'sw.js').catch(function () {}); });
  }
})();
