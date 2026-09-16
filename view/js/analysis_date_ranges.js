"use strict";

// Display-only date ranges; published metric values remain unchanged.
window.AnalysisDateRanges = (() => {
  const ranges = new Map();
  function parse(value) {
    if (!/^\d{8}$/.test(value)) return null;
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
  }
  function controls(scope, visible, redraw) {
    let panel = document.getElementById(`${scope}-date-range`);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = `${scope}-date-range`;
      panel.style.cssText = "display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:12px 0";
      panel.innerHTML = `
        <div class="field"><label for="${scope}-start-date">開始日</label><input id="${scope}-start-date" type="text" inputmode="numeric" maxlength="8" placeholder="YYYYMMDD" autocomplete="off" style="width:130px;max-width:100%"></div>
        <div class="field"><label for="${scope}-end-date">終了日</label><input id="${scope}-end-date" type="text" inputmode="numeric" maxlength="8" placeholder="YYYYMMDD" autocomplete="off" style="width:130px;max-width:100%"></div>
        <button type="button" class="control-button" data-action="apply">適用</button>
        <button type="button" class="control-button" data-action="reset">全期間</button>
        <span aria-live="polite" data-status>全期間</span>`;
      document.getElementById(`${scope}-caption`).before(panel);
      const start = panel.querySelector(`#${scope}-start-date`);
      const end = panel.querySelector(`#${scope}-end-date`);
      const status = panel.querySelector("[data-status]");
      const apply = panel.querySelector('[data-action="apply"]');
      apply.addEventListener("click", () => {
        const from = parse(start.value.trim());
        const to = parse(end.value.trim());
        start.setCustomValidity(from ? "" : "実在する日付をYYYYMMDDの8桁で入力してください");
        end.setCustomValidity(to ? "" : "実在する日付をYYYYMMDDの8桁で入力してください");
        if (!from) { start.reportValidity(); return; }
        if (!to) { end.reportValidity(); return; }
        if (from > to) {
          end.setCustomValidity("終了日は開始日以降を指定してください");
          end.reportValidity(); return;
        }
        ranges.set(scope, { start: from, end: to });
        status.textContent = `${from} ～ ${to}`;
        redraw();
      });
      panel.querySelector('[data-action="reset"]').addEventListener("click", () => {
        ranges.delete(scope);
        for (const input of [start, end]) { input.value = ""; input.setCustomValidity(""); }
        status.textContent = "全期間";
        redraw();
      });
      for (const input of [start, end]) {
        input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 8); input.setCustomValidity(""); });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") { event.preventDefault(); apply.click(); }
        });
      }
    }
    panel.style.display = visible ? "flex" : "none";
  }
  function filter(scope, rows) {
    const range = ranges.get(scope);
    return range ? rows.filter(row => row.as_of_date >= range.start && row.as_of_date <= range.end) : rows;
  }
  return { controls, filter };
})();
