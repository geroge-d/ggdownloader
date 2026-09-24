// rtgto-bridge.js
// 和同一台机器上的实时GTO（RtGTO）通信，核对下载是否完整。侧边栏使用。
//
// 实时GTO 在「手牌分析 / 资金分析 → GG数据导入」里开着一个只监听本机（127.0.0.1）的服务，
// 只接受浏览器扩展发来的请求（看 Origin 是不是 chrome-extension://）。
//
//   GET  /gg-bridge/v1/hello   -> { app, protocol, appVersion, downloadDir, backupDir }
//   POST /gg-bridge/v1/verify  -> 按每次"点了下载"对应的浏览器下载文件逐个核对，
//                                 导入并备份下到的文件，返回每条的结果和漏下的区间
//
// 端口固定从 47651 开始试，被占用时实时GTO 会顺延到后面两个。

(function () {
  "use strict";

  const PORTS = [47651, 47652, 47653];
  const BASE = "/gg-bridge/v1";
  const PROTOCOL = 1;
  const HELLO_TIMEOUT_MS = 1500;
  // 核对时实时GTO 要解析、导入、备份文件，文件多时要一会儿
  const VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

  let port = null;   // 上次连通的端口

  // 探测时带上扩展版本，实时GTO 据此显示「扩展已连接（v…）」
  function extVersion() {
    try {
      return (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
        ? chrome.runtime.getManifest().version : "";
    } catch (e) {
      return "";
    }
  }

  async function request(p, path, opts, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${p}${BASE}${path}`, Object.assign({ signal: ctrl.signal }, opts));
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (body && body.error) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  const Bridge = {
    PORTS,
    PROTOCOL,

    /** 找到正在运行的实时GTO。连不上返回 { ok: false }，不抛异常。 */
    async hello() {
      const order = port ? [port].concat(PORTS.filter((x) => x !== port)) : PORTS;
      for (const p of order) {
        try {
          const info = await request(p, `/hello?ext=${encodeURIComponent(extVersion())}`, { method: "GET" }, HELLO_TIMEOUT_MS);
          if (info && info.app === "RtGTO") {
            port = p;
            return { ok: true, port: p, info };
          }
        } catch (e) {
          /* 这个端口没有，试下一个 */
        }
      }
      port = null;
      return { ok: false };
    },

    /**
     * 把"点了下载"的记录交给实时GTO核对。
     * entries 里每条带 download（浏览器下载的文件路径和状态），实时GTO 按文件逐个检查。
     */
    async verify(payload) {
      if (!port) {
        const h = await Bridge.hello();
        if (!h.ok) throw new Error("not_connected");
      }
      return request(
        port,
        "/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ protocol: PROTOCOL }, payload)),
        },
        VERIFY_TIMEOUT_MS
      );
    },
  };

  if (typeof window !== "undefined") window.GG_RTGTO = Bridge;
  if (typeof self !== "undefined") self.GG_RTGTO = Bridge;
})();
