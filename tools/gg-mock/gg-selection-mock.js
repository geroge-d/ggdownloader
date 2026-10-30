// tools/gg-mock/gg-selection-mock.js
// 在保存下来的 PokerCraft 锦标赛页面上模拟 GG 的勾选逻辑，用来在本地检查 pokercraft-dom.js 的勾选 / 清勾。
//
// 照 GG 前端代码（chunk-24MXYWPP，app-sessions + GameService）写的：
//   - 选中存在一个 SelectionModel 里（按行对象），按钮上的数字从它算：概要 = 选中且没在进行中的场数，手牌 = 选中行的手数之和
//   - 行复选框：(change) → selection.toggle(row)，只翻，不看自己显示的勾；整行 (click) → selection.toggle(row)
//   - 表头：(change) → selectionMasterToggle()：先转圈，await setTimeout(0)，再看 isAllSelected，全选就 clear()，否则全选
//   - 绑定 [checked]="selection.isSelected(row)"、表头 [checked]/[indeterminate]：只有算出来的值和上次推给它的不一样才推
//     （所以复选框自己翻过、模型又变回原值时，显示会和选中对不上）
//   - 渲染（变更检测）排在 setTimeout(0)，同一轮里的多次变化合并成一次
// 模拟不了的：GG 的下载、"下载限制"弹窗、重新查询。
(function () {
  "use strict";

  const rows = Array.from(document.querySelectorAll("tbody tr.mat-mdc-row"));
  const header = document.querySelector("thead .mat-mdc-header-row input[type='checkbox']");
  const smallSummary = document.querySelector("app-download-button-game-session-summary small");
  const smallHand = document.querySelector("app-download-button-game-session-hand small");
  const btnSummary = document.querySelector("app-download-button-game-session-summary button");
  const btnHand = document.querySelector("app-download-button-game-session-hand button");
  const spinner = document.querySelector("#session-spinner");

  const selected = new Set();
  const hands = new Map(rows.map((r, i) => [r, 50 + (i % 7) * 10]));
  const isAllSelected = () => selected.size === rows.length;

  const inputOf = (r) => r.querySelector("input[type='checkbox']");
  const pushed = new Map(rows.map((r) => [r, false]));
  let pushedHeader = { checked: false, indeterminate: false };
  let renderQueued = false;
  let renders = 0;

  function render() {
    renderQueued = false;
    renders++;
    for (const r of rows) {
      const v = selected.has(r);
      if (v !== pushed.get(r)) {
        pushed.set(r, v);
        inputOf(r).checked = v;
      }
    }
    const h = { checked: selected.size > 0 && isAllSelected(), indeterminate: selected.size > 0 && !isAllSelected() };
    if (h.checked !== pushedHeader.checked) header.checked = h.checked;
    if (h.indeterminate !== pushedHeader.indeterminate) header.indeterminate = h.indeterminate;
    pushedHeader = h;
    let total = 0;
    selected.forEach((r) => { total += hands.get(r); });
    smallSummary.textContent = `${selected.size} Game Summaries`;
    smallHand.textContent = `${total} Game Histories`;
    btnSummary.disabled = selected.size === 0;
    btnHand.disabled = selected.size === 0;
  }
  function changed() {
    if (!renderQueued) {
      renderQueued = true;
      setTimeout(render, 0);
    }
  }
  const toggle = (r) => { if (selected.has(r)) selected.delete(r); else selected.add(r); changed(); };

  for (const r of rows) {
    const input = inputOf(r);
    // 复选框：原生点击已经翻了 checked（MatCheckbox 的 _checked 跟着翻），再发 change → toggle
    input.addEventListener("click", (e) => { e.stopPropagation(); toggle(r); });
    r.addEventListener("click", () => toggle(r));
  }
  header.addEventListener("click", async () => {
    if (spinner) spinner.style.display = "flex";
    await new Promise((res) => setTimeout(res, 0));
    if (isAllSelected()) selected.clear();
    else rows.forEach((r) => selected.add(r));
    changed();
    if (spinner) spinner.style.display = "none";
  });

  // 初始：什么都没选，复选框都没勾
  rows.forEach((r) => { inputOf(r).checked = false; });
  header.checked = false;
  header.indeterminate = false;
  render();

  window.__ggMock = {
    rows,
    selected,
    reset() { selected.clear(); rows.forEach((r) => pushed.set(r, false)); pushedHeader = { checked: false, indeterminate: false }; rows.forEach((r) => { inputOf(r).checked = false; }); header.checked = false; header.indeterminate = false; render(); },
    renders: () => renders,
  };
})();
