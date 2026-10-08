// sync-state.js
// 同步水位线的读写，侧边栏和 content script 共用。
//
// 水位线 = 这个页面类型上，已经成功同步到哪一天（含）。
// 下次同步从它的第二天开始，所以用户不用再选日期，点一下就把缺的补上。
//
// 按页面类型分开存：锦标赛 / 极速现金 / 德州扑克 / PLO 是各自独立的数据，
// 在锦标赛页同步完不代表现金局也同步过了。
//
// 只在一批真正下载成功之后才推进水位线 —— 宁可下次重下一批，
// 也不能因为中途失败却推进了水位线而永久漏掉那几天。
//
// 水位线存在实时GTO 的数据库里（和手牌放在一起），扩展自己不存：
// - 实时GTO 里没有这个分类的记录，就是没同步过，从头同步；
// - 用户在实时GTO 里清空牌局，同步记录跟着清空，下次从头同步；
// - 扩展里"清除同步记录"清的是实时GTO 里的同步记录，已经导入的数据不删。
// 读写经 background.js 转发（content script 在 https 页面上，连不了 127.0.0.1）。
//
// 连不上实时GTO / 实时GTO 太旧时抛异常（err.code = 'not_connected' / 'rtgto_outdated' / 'failed'），
// 绝不能当成"没同步过"——那样会把几个月的数据从头重下一遍。

(function () {
  "use strict";

  // 以前的版本把水位线存在扩展的 chrome.storage.local（ggSyncState）里；
  // 第一次读写时由 rtgto-bridge.js 一次性交给实时GTO（那边已有记录的不覆盖），然后删掉

  const EMPTY = Object.freeze({
    lastSyncedDate: null, // 已成功同步到哪一天（含）
    lastDataSyncAt: null, // 上次真正下载了数据的时间（不是点击同步的时间）
    batches: 0, // 累计批次数，纯粹给用户看
    days: 0, // 累计覆盖天数
  });

  const MESSAGES = {
    not_connected: "没有连上实时GTO，读不到同步记录（同步记录保存在实时GTO 里）。请先在本机打开实时GTO",
    rtgto_outdated: "实时GTO 版本太旧，还不能保存同步记录，请先更新实时GTO",
  };

  // 实时GTO 后台导入、备份时可能一时回不上（超时 / 探测不到），这时停掉整轮同步不值得：
  // 写同步记录（advance / rewind / clear 重复做也一样）隔一会儿再试几次；
  // 读只在出错时再试一次，连不上马上告诉用户。实时GTO 太旧再试也没用。
  const WRITE_RETRY_WAITS_MS = [3000, 8000, 15000];
  const READ_RETRY_WAITS_MS = [2000];

  async function call(body) {
    const write = body.op !== "get";
    const waits = write ? WRITE_RETRY_WAITS_MS : READ_RETRY_WAITS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return await callOnce(body);
      } catch (err) {
        const retryable = err.code === "failed" || (write && err.code === "not_connected");
        if (!retryable || attempt >= waits.length) throw err;
        console.warn(`[GGPoker助手] 同步记录 ${body.op} ${body.pageType || ""} 第 ${attempt + 1} 次失败（${err.message}），` +
          `${waits[attempt] / 1000} 秒后重试`);
        await new Promise((r) => setTimeout(r, waits[attempt]));
      }
    }
  }

  function callOnce(body) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "syncState", body }, (res) => {
        const lost = chrome.runtime.lastError;
        if (res && res.ok) return resolve(res.result);
        const code = (res && res.code) || "failed";
        const detail = (res && res.error) || (lost && lost.message) || "无回应";
        const err = new Error(MESSAGES[code] || `同步记录读写失败：${detail}`);
        err.code = code;
        err.syncState = true;   // 调用方据此认出"同步记录没读到 / 没保存"
        reject(err);
      });
    });
  }

  const SyncState = {
    MESSAGES,

    /** 取某个页面类型的同步记录；实时GTO 里没有就是没同步过。 */
    async get(pageType) {
      const all = await call({ op: "get" });
      return Object.assign({}, EMPTY, all[pageType] || {});
    },

    async getAll() {
      return call({ op: "get" });
    },

    /**
     * 推进水位线。
     * 只往前推，不往回退（实时GTO 那边保证）：一次同步里批次是从旧到新跑的，
     * 但万一有乱序（比如重试），也不能把已经同步过的日期"退回去"。
     * extra.downloaded：这一批真的下载了数据才更新"上次同步"时间 ——
     * 点了同步但已是最新、或某段确认没有对局都不算。
     */
    async advance(pageType, dateStr, extra) {
      const x = extra || {};
      const state = await call({
        op: "advance", pageType, date: dateStr,
        downloaded: !!x.downloaded, batches: x.batches || 0, days: x.days || 0,
      });
      return Object.assign({}, EMPTY, state || {});
    },

    /**
     * 把水位线退回到 dateStr（只往回退）。只在确认之前某段被误判成"没数据"时用：
     * 那段其实有对局，要重新下。
     */
    async rewind(pageType, dateStr) {
      return call({ op: "rewind", pageType, date: dateStr });
    },

    /**
     * 只清除这一个分类在实时GTO 里的同步记录（已导入的数据不删），其他分类不动。下次同步该分类从头来。
     * 分类必须给：以前"不传就全清"，页面还没识别出分类时点清除会把所有分类都清掉。
     */
    async clear(pageType) {
      if (!pageType) throw new Error("clear() 需要指定分类");
      await call({ op: "clear", pageType });
    },
  };

  if (typeof window !== "undefined") window.GG_SYNC = SyncState;
  if (typeof self !== "undefined") self.GG_SYNC = SyncState;
})();
