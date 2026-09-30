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
})();
