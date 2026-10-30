// tools/test_ledger.js
// 下载记录（download-ledger.js）怎么算"这段日期下过"的检查。打包前 build.py 会跑。
//
//   node tools/test_ledger.js

const path = require("path");
const assert = require("assert");

global.self = global;
global.chrome = { storage: { local: {} } };
require(path.join(__dirname, "..", "download-ledger.js"));
const L = self.GG_LEDGER;

const base = { pageType: "tournament", status: "clicked", runId: "r1", batch: 2, from: "2026-09-05", to: "2026-09-10" };
const rec = (o) => Object.assign({}, base, o);
const covered = (list, kind) => {
  const c = L.summarize(list).find((x) => x.kind === kind);
  return c ? c.covered.map((r) => `${r.from}~${r.to}`) : [];
};
const WHOLE = ["2026-09-05~2026-09-10"];

const cases = {
  "普通记录算下过": () => {
    assert.deepStrictEqual(covered([rec({ kind: "summary" })], "summary"), WHOLE);
  },
  "旧版分趟记录（没有 chunkOf）照旧算": () => {
    assert.deepStrictEqual(covered([rec({ kind: "history", chunk: "1", rowRange: "1-20" })], "history"), WHOLE);
  },
  "分趟没走完、也没标 chunkDone：不算": () => {
    const list = [
      rec({ kind: "history", chunk: "2", rowRange: "1-86", chunkOf: 279 }),
      rec({ kind: "history", chunk: "3", rowRange: "87-142", chunkOf: 279 }),
    ];
    assert.deepStrictEqual(covered(list, "history"), []);
  },
  "标了 chunkDone：算": () => {
    const list = [
      rec({ kind: "history", chunk: "2", rowRange: "1-86", chunkOf: 279, chunkDone: true }),
      rec({ kind: "history", chunk: "3", rowRange: "87-279", chunkOf: 279, chunkDone: true }),
    ];
    assert.deepStrictEqual(covered(list, "history"), WHOLE);
  },
  "没标 chunkDone 但各趟的行连起来是整张表（1.3.7 概要那遍下完、手牌失败）：概要算，手牌不算": () => {
    const list = [
      rec({ kind: "summary", chunk: "1", rowRange: "1-175", chunkOf: 175 }),
      rec({ kind: "history", status: "failed", chunk: "未完成" }),
    ];
    assert.deepStrictEqual(covered(list, "summary"), WHOLE);
    assert.deepStrictEqual(covered(list, "history"), []);
  },
  "同一组里有一趟浏览器下载中断：行连不起来，不算": () => {
    const list = [
      rec({ kind: "history", chunk: "1", rowRange: "1-100", chunkOf: 200 }),
      rec({ kind: "history", chunk: "2", rowRange: "101-200", chunkOf: 200, download: { state: "interrupted" } }),
    ];
    assert.deepStrictEqual(covered(list, "history"), []);
  },
  "别的批次（runId 不同）的趟不能拼进这一组": () => {
    const list = [
      rec({ kind: "history", chunk: "1", rowRange: "1-100", chunkOf: 200 }),
      rec({ kind: "history", runId: "r2", chunk: "2", rowRange: "101-200", chunkOf: 200 }),
    ];
    assert.deepStrictEqual(covered(list, "history"), []);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + "\n     " + e.message.split("\n").join("\n     "));
  }
}
if (failed) {
  console.log(`下载记录检查：${failed} 项没通过`);
  process.exit(1);
}
console.log(`下载记录检查通过：${Object.keys(cases).length} 项`);
