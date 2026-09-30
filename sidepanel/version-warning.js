// 版本过低提示页：按当前浏览器（Chrome / Edge）显示名字、版本和下载地址。
// Edge 的 UA 同时带 "Chrome/<内核版本>" 和 "Edg/<版本>"，两者主版本号一致。
(function () {
  const ua = navigator.userAgent;
  const isEdge = /Edg\//.test(ua);
  const name = isEdge ? 'Edge' : 'Chrome';
  const match = ua.match(isEdge ? /Edg\/(\d+)/ : /Chrome\/(\d+)/);
  const version = match ? match[1] : '未知';

  document.querySelectorAll('.browser-name').forEach((el) => { el.textContent = ` ${name} `; });
  document.getElementById('current-version').textContent = `${name} ${version}`;
  document.getElementById('download-link').href = isEdge
    ? 'https://www.microsoft.com/edge'
    : 'https://www.google.com/chrome/';
  document.title = `${name} 版本提示`;

  // 版本够但没有侧边栏接口：多半是套了 Chromium 内核、UA 写成 Chrome 的第三方浏览器，
  // 或者侧边栏被策略禁用了。这时让用户"更新"没用，要换正版 Chrome / Edge。
  if (new URLSearchParams(location.search).get('reason') === 'noapi') {
    document.getElementById('title').textContent = '当前浏览器不支持侧边栏';
    document.getElementById('requirement').textContent =
      '版本号已经够了，但这个浏览器没有提供侧边栏（Side Panel）接口。常见于 360、QQ、搜狗等国产浏览器，或被公司策略禁用了侧边栏。';
    document.getElementById('advice').textContent =
      '请改用谷歌官方 Chrome 或微软 Edge 打开 GGPoker 网站，再使用本助手。';
    document.title = '浏览器不支持侧边栏';
  }
})();
