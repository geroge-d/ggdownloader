// tools/gg-mock/selection-tests.js
// 在装了 gg-selection-mock.js 的页面上跑 pokercraft-dom.js 的勾选 / 清勾，结果写进 window.__ggTestResults 和页面标题。
(async function () {
  "use strict";
  const D = window.GGDom;
  const M = window.__ggMock;
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const N = M.rows.length;
  const count = () => D.downloadCount(D.findSummaryButton());
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

  const selectAllByHeader = async () => {
    D.findSelectAllCheckbox().click();
    await tick();
  };
  // 1.3.4 ~ 1.3.9 的清勾：先点表头，同一刻再把勾着的行点掉
  const oldClear = () => {
    const h = D.findSelectAllCheckbox();
    const rows = D.findRowCheckboxes();
    if (h.checked && rows.every((b) => b.checked)) h.click();
    D.findRowCheckboxes().forEach((b) => { if (b.checked) b.click(); });
  };
  const makeGhost = async () => {
    M.reset();
    await selectAllByHeader();
    oldClear();
    await tick();
  };

  check("找得到所有行的复选框", D.findRowCheckboxes().length === N, `${D.findRowCheckboxes().length} / ${N}`);

  await makeGhost();
  const visiblyChecked = D.findRowCheckboxes().filter((b) => b.checked).length;
  check("模拟能复现：旧清勾之后按钮仍是全部、行上看不出勾", count() === N && visiblyChecked === 0,
    `按钮 ${count()}，行上勾着 ${visiblyChecked}，表头 ${D.selectAllState()}`);

  M.reset();
  await selectAllByHeader();
  D.clearSelection();
  await tick();
  check("整张表全选后 clearSelection 清得掉", count() === 0, `按钮 ${count()}`);

  // 和 content-script.js 里 pick 的 tryClear 一样：只点行，还有选中就单独点表头，最多两次
  const clearLikePick = async () => {
    D.clearSelection();
    await tick();
    for (let t = 0; t < 2 && count() > 0 && D.clickSelectAllAlone(); t++) await tick();
    return count();
  };

  await makeGhost();
  check("全选残留：只点行清不掉，单独点表头清得掉", await clearLikePick() === 0, `之后 ${count()}`);

  M.reset();
  const all = D.findRowCheckboxes();
  for (let i = 0; i < 30; i++) D.toggleRow(all[i]);
  await tick();
  for (let i = 0; i < 30; i++) all[i].checked = false;   // 行上的勾和选中对不上（部分选中的残留）
  check("部分选中的残留：表头点两次（全选 → 清空）清得掉", await clearLikePick() === 0, `之后 ${count()}`);

  await makeGhost();
  await clearLikePick();

  // 接着上面（行上的勾和选中刚对不上过）：按行勾 0..19
  const boxes = D.findRowCheckboxes();
  for (let i = 0; i < 20; i++) D.toggleRow(boxes[i]);
  await tick();
  check("toggleRow 只勾上指定的 20 行", count() === 20 && [...M.selected].every((r) => M.rows.indexOf(r) < 20),
    `按钮 ${count()}`);

  D.clearSelection();
  await tick();
  check("勾了一部分后 clearSelection 清得掉", count() === 0, `按钮 ${count()}`);

  M.reset();
  for (let i = 100; i < 150; i++) D.toggleRow(boxes[i]);
  await tick();
  check("从空选中勾第 101-150 行", count() === 50 && [...M.selected].every((r) => { const k = M.rows.indexOf(r); return k >= 100 && k < 150; }),
    `按钮 ${count()}`);

  window.__ggTestResults = results;
  const bad = results.filter((r) => !r.ok).length;
  document.title = bad ? `FAIL ${bad}/${results.length}` : `PASS ${results.length}`;
  console.log(JSON.stringify(results, null, 1));
})();
