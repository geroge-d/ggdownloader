// rtgto-bridge.js
// 和同一台机器上的实时GTO（RtGTO）通信，核对下载是否完整。侧边栏使用。
//
// 实时GTO 开着一个只监听本机（127.0.0.1）的服务，本机请求都接受，不做来源校验（本地便利通道）。
// X-GG-Extension 头只是告诉它扩展版本。
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

  // 构建编号（build.py 打包时写入 build-info.json）。版本号测试期间不变，
  // 实时GTO 靠它判断这份扩展是不是比它内置的旧。没有这个文件（旧版扩展）按 0 算。
  let buildInfo = null;
  async function loadBuildInfo() {
    if (buildInfo) return buildInfo;
    try {
      const res = await fetch(chrome.runtime.getURL("build-info.json"));
      buildInfo = res.ok ? await res.json() : {};
    } catch (e) {
      buildInfo = {};
    }
    return buildInfo;
  }

  async function request(p, path, opts, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // 顺带告诉实时GTO 扩展版本和构建编号（它据此显示「扩展已连接」和「版本过低」）
      const b = await loadBuildInfo();
      const headers = Object.assign(
        { "X-GG-Extension": `${extVersion() || "1"}+${b.build || 0}` },
        (opts && opts.headers) || {});
      const res = await fetch(`http://127.0.0.1:${p}${BASE}${path}`,
        Object.assign({ signal: ctrl.signal }, opts, { headers }));
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

    /** 这份扩展的构建信息 { version, build, commit }；旧版扩展没有，build 为 0。 */
    buildInfo: loadBuildInfo,

    /**
     * 实时GTO 内置的扩展是不是比这份新。hello 的回应里带着 bundledExtension。
     * 返回 null 表示没法判断（实时GTO 太旧、没带这个信息）。
     */
    async outdated(helloInfo) {
      const bundled = helloInfo && helloInfo.bundledExtension;
      if (!bundled || (!bundled.build && !bundled.version)) return null;
      const mine = (await loadBuildInfo()).build || 0;
      const old = { mine, latest: bundled.build || 0, mineVersion: extVersion(), latestVersion: bundled.version || "" };
      // 先比版本号：高于实时GTO 内置的不提醒，低于就提醒；相同再比构建编号的先后
      const cmp = Bridge.compareVersions(extVersion(), bundled.version || "");
      if (cmp > 0) return false;
      if (cmp < 0) return old;
      return mine < (bundled.build || 0) ? old : false;
    },

    /** "1.2.10" 和 "1.2.9" 按数字逐段比；返回 -1 / 0 / 1。空的算 0。 */
    compareVersions(a, b) {
      const pa = String(a || "").split(".").map((x) => parseInt(x, 10) || 0);
      const pb = String(b || "").split(".").map((x) => parseInt(x, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
      }
      return 0;
    },

    /** 找到正在运行的实时GTO。连不上返回 { ok: false }，不抛异常。 */
    async hello() {
      const order = port ? [port].concat(PORTS.filter((x) => x !== port)) : PORTS;
      for (const p of order) {
        try {
          const b = await loadBuildInfo();
          const info = await request(p,
            `/hello?ext=${encodeURIComponent(extVersion())}&build=${b.build || 0}`, { method: "GET" }, HELLO_TIMEOUT_MS);
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

  // —— 核对：侧边栏（手动 / 同步结束 / 刚连上）和后台（下载一完成就自动）共用 ——

  const DOWNLOADS_KEY = "ggDownloads";
  const LAST_VERIFY_KEY = "ggRtgtoLastVerify";
  const REPAIR_KEY = "ggRepairImport";
  // 两个地方（侧边栏、后台）可能同时想核对，用一个带时间的软锁错开；锁超时防止卡死
  const LOCK_KEY = "ggRtgtoVerifying";
  const LOCK_MS = 2 * 60 * 1000;
  // 点了下载之后 GG 要先在服务器上打包，浏览器过一会儿才开始下载。
  // 这段时间里还没对上下载的点击先不核对（否则会被判成"没出现下载"去白补一次）。
  const START_GRACE_MS = 3 * 60 * 1000;

  const storageGet = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
  const storageSet = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));
  const storageRemove = (keys) => new Promise((r) => chrome.storage.local.remove(keys, r));

  // 发给实时GTO 的字段：日期段、类别、点下载时的条数，以及浏览器下载的文件和状态
  function pickForVerify(e) {
    const d = e.download;
    return {
      id: e.id,
      mode: e.mode,
      pageType: e.pageType,
      kind: e.kind,
      from: e.from,
      to: e.to,
      count: e.count,
      chunk: e.chunk,
      clickedAt: e.clickedAt,
      download: d ? {
        id: d.id, file: d.file, state: d.state, error: d.error,
        bytes: d.bytes, totalBytes: d.totalBytes, startTime: d.startTime, endTime: d.endTime,
      } : null,
    };
  }

  function describe(e) {
    const d = e.download;
    return `[扩展] ${e.pageType}/${e.kind} ${e.from}~${e.to}${e.chunk ? " 第" + e.chunk + "趟" : ""} ` +
      `按钮 ${e.count == null ? "-" : e.count} 条，点击 ${e.clickedAt || "-"}，` +
      (d ? `下载 #${d.id} ${d.state}${d.error ? "(" + d.error + ")" : ""} ${d.file || "(无文件名)"}` : "没有对上浏览器下载");
  }

  /**
   * 把还没核对的"点了下载"交给实时GTO，结果写回下载记录，没下到的日期写进补下载清单。
   *
   * opts.onlyFinished  只发浏览器已经下完（或已中断）的 —— 后台"下载一完成就自动解析"用；
   *                    这时若实时GTO 关了自动解析就不发，留到同步结束再一起核对。
   * opts.trigger       记日志用：manual / run_end / connected / auto
   *
   * 返回 { status: 'nothing' | 'not_connected' | 'auto_off' | 'busy' | 'done' | 'error', counts, error }
   */
  Bridge.verifyPending = async function (opts) {
    const o = Object.assign({ onlyFinished: false, trigger: "manual" }, opts || {});
    const Ledger = (typeof window !== "undefined" && window.GG_LEDGER) || self.GG_LEDGER;
    if (!Ledger) return { status: "error", error: "no ledger" };

    const [list, dl] = await Promise.all([Ledger.getAll(), storageGet([DOWNLOADS_KEY])]);
    const downloads = Array.isArray(dl[DOWNLOADS_KEY]) ? dl[DOWNLOADS_KEY] : [];
    const attached = Ledger.attachDownloads(list, downloads);
    // 有点击时间（能和浏览器下载对上）、还没核对过或上次还在下载中的
    const now = Date.now();
    let toSend = attached.filter((e) =>
      e.status === "clicked" && e.clickedAtMs && (!e.verify || e.verify.status === "downloading") &&
      // 下载还没开始、但刚点不久：再等等
      !(!e.download && now - e.clickedAtMs < START_GRACE_MS));
    if (o.onlyFinished) toSend = toSend.filter((e) => e.download && e.download.state !== "in_progress");
    if (!toSend.length) return { status: "nothing" };

    const lock = (await storageGet([LOCK_KEY]))[LOCK_KEY];
    if (lock && Date.now() - lock < LOCK_MS) return { status: "busy" };

    const h = await Bridge.hello();
    if (!h.ok) return { status: "not_connected" };
    if (o.onlyFinished && h.info && h.info.autoParse === false) return { status: "auto_off" };

    await storageSet({ [LOCK_KEY]: Date.now() });
    const sent = toSend.map(describe);
    console.groupCollapsed(`[实时GTO核对] ${o.trigger}：发送 ${toSend.length} 条`);
    sent.forEach((l) => console.log(l));
    console.groupEnd();
    const saveLog = (extra) => storageSet({
      [LAST_VERIFY_KEY]: Object.assign({ at: Ledger.localIso(Date.now()), trigger: o.trigger, sent }, extra),
    });
    const done = downloads.find((d) => d.state === "complete" && d.file);
    const downloadDir = done ? done.file.replace(/[\\/][^\\/]*$/, "") : null;

    try {
      const res = await Bridge.verify({
        extensionVersion: extVersion() || null,
        trigger: o.trigger,
        downloadDir,
        entries: toSend.map(pickForVerify),
      });
      const results = new Map((res.results || []).map((r) => [r.id, r]));
      console.groupCollapsed(`[实时GTO核对] 结果 ${(res.results || []).length} 条`);
      (res.log || []).forEach((l) => console.log("[实时GTO] " + l));
      console.groupEnd();

      const attachedById = new Map(attached.map((e) => [e.id, e]));
      const at = Ledger.localIso(Date.now());
      await Ledger.update((all) => all.map((e) => {
        const a = attachedById.get(e.id);
        const r = results.get(e.id);
        if (!r && !(a && a.download)) return e;
        const n = Object.assign({}, e);
        if (a && a.download) n.download = a.download;   // 对上的下载固定下来，旧下载滚出列表后也不丢
        if (r) {
          n.verify = {
            status: r.status, detail: r.detail || "", items: r.items == null ? null : r.items,
            matchedBy: r.matchedBy || null, metrics: r.metrics || null, at,
          };
        }
        return n;
      }));

      const count = (pred) => (res.results || []).filter(pred).length;
      const counts = {
        ok: count((r) => r.status === "ok" || r.status === "count_diff"),
        bad: count((r) => Ledger.VERIFY_BAD.includes(r.status)),
        downloading: count((r) => r.status === "downloading"),
      };

      // 所有类别里"没下到、之后也没补上"的日期段，直接变成补下载清单
      const fresh = await Ledger.getAll();
      const pending = Ledger.summarize(Ledger.attachDownloads(fresh, downloads))
        .flatMap((c) => c.pending.map((r) => ({ pageType: c.pageType, kind: c.kind, from: r.from, to: r.to })));
      if (pending.length) {
        await storageSet({ [REPAIR_KEY]: { importedAt: Ledger.localIso(Date.now()), source: "rtgto", items: pending } });
      }
      await saveLog({ log: res.log || [], counts, imported: res.import || null });
      return { status: "done", counts, imported: res.import || null };
    } catch (e) {
      const error = String((e && e.message) || e);
      console.warn("[实时GTO核对] 失败", e);
      await saveLog({ error });
      return { status: "error", error };
    } finally {
      await storageRemove([LOCK_KEY]);
    }
  };

  /**
   * 还在等的：点了但下载还没开始（宽限期内）、或正在下载 / 实时GTO 说还在下载。
   * bytes 是正在下载的已收字节数，用来判断有没有进展。
   */
  Bridge.waitingDownloads = async function () {
    const Ledger = (typeof window !== "undefined" && window.GG_LEDGER) || self.GG_LEDGER;
    const [list, dl] = await Promise.all([Ledger.getAll(), storageGet([DOWNLOADS_KEY])]);
    const attached = Ledger.attachDownloads(list, Array.isArray(dl[DOWNLOADS_KEY]) ? dl[DOWNLOADS_KEY] : []);
    const now = Date.now();
    const mine = attached.filter((e) => e.status === "clicked" && e.clickedAtMs);
    const notStarted = mine.filter((e) => !e.verify && !e.download && now - e.clickedAtMs < START_GRACE_MS);
    const downloading = mine.filter((e) => e.verify
      ? e.verify.status === "downloading"
      : e.download && e.download.state === "in_progress");
    return {
      notStarted: notStarted.length,
      downloading: downloading.length,
      bytes: downloading.reduce((n, e) => n + ((e.download && e.download.bytes) || 0), 0),
    };
  };

  Bridge.START_GRACE_MS = START_GRACE_MS;
  Bridge.LAST_VERIFY_KEY = LAST_VERIFY_KEY;
  Bridge.LOCK_KEY = LOCK_KEY;

  if (typeof window !== "undefined") window.GG_RTGTO = Bridge;
  if (typeof self !== "undefined") self.GG_RTGTO = Bridge;
})();
