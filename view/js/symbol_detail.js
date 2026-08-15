    const manifestUrl = "../test/web/data/manifest.json";
    const targetNames = { target_5d: "5日", target_20d: "20日" };
    const topNValues = [1, 5, 10, 20, 50, 100];
    const number = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
    const price = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
    const money = new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 2 });
    let manifest = null;
    let symbolNames = Object.create(null);
    let activeTarget = "target_5d";
    const predictionByTarget = new Map();
    const rankingByTarget = new Map();
    const probabilitiesByTarget = new Map();
    let priceHistoryPayload = null;
    let chartGeometry = null;

    function normalizeSymbol(value) {
      const raw = String(value ?? "").trim().toUpperCase();
      const code = raw.endsWith(".T") ? raw.slice(0, -2) : raw;
      return /^\d{4}$/.test(code) ? `${code}.T` : raw;
    }
    const params = new URLSearchParams(location.search);
    const selectedSymbol = normalizeSymbol(params.get("symbol") || "2929");
    const requestedIntervals = new Set(
      params.has("interval") ? params.getAll("interval") : ["95"]
    );

    function logicalFile(name) {
      return manifest?.files?.find((file) => file.logical_name === name);
    }
    async function fetchLogical(name) {
      const file = logicalFile(name);
      if (!file) return null;
      const response = await fetch(`../test/web/data/${file.path}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      return response.json();
    }
    function numeric(value) {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    function percent(value, signed = false) {
      const parsed = numeric(value);
      if (parsed === null) return "-";
      const scaled = parsed * 100;
      return `${signed && scaled > 0 ? "+" : ""}${number.format(scaled)}%`;
    }
    function setText(id, value) { document.getElementById(id).textContent = value ?? "-"; }
    function showNotice(message) {
      const notice = document.getElementById("notice");
      notice.textContent = message;
      notice.classList.toggle("visible", Boolean(message));
    }

    function renderIdentity(row) {
      setText("symbol-code", selectedSymbol);
      setText("symbol-name", symbolNames[selectedSymbol] || "銘柄名未登録");
      setText("base-close", row ? `${price.format(row.base_close)}円` : "-");
      setText("median-traded-value", row ? `${money.format(row.median_traded_value_20d)}円` : "-");
      setText("signal-date", row?.signal_date || manifest?.as_of_date || "-");
      setText("score-version", row?.score_version || manifest?.score_version || "-");

      const liquidity = document.getElementById("liquidity-badge");
      const liquid = Number(row?.liquidity_eligible) === 1;
      liquidity.textContent = liquid ? "流動性条件通過" : "流動性条件対象外";
      liquidity.className = `badge ${liquid ? "good" : "warn"}`;

      const status = document.getElementById("data-status-badge");
      status.textContent = row?.data_status === "official" ? "データ確定" : "暫定データ";
      status.className = `badge ${row?.data_status === "official" ? "good" : "warn"}`;
    }

    function renderRange(row) {
      const lower = numeric(row.prediction_interval_lower);
      const upper = numeric(row.prediction_interval_upper);
      const forecast = numeric(row.prediction_return_calibrated ?? row.prediction_return);
      setText("range-lower", percent(lower, true));
      setText("range-upper", percent(upper, true));
      if (lower === null || upper === null || forecast === null || lower >= upper) {
        document.getElementById("range-zero").style.left = "50%";
        document.getElementById("range-point").style.left = "50%";
        return;
      }
      const position = (value) => Math.min(100, Math.max(0, (value - lower) / (upper - lower) * 100));
      document.getElementById("range-zero").style.left = `${position(0)}%`;
      document.getElementById("range-point").style.left = `${position(forecast)}%`;
    }

    function renderDetailTable(row, rankings) {
      const table = document.getElementById("detail-table");
      table.replaceChildren();
      const allRank = rankings.find((item) => item.liquidity_profile === "all")?.rank;
      const liquidRank = rankings.find((item) => item.liquidity_profile === "liquid_100m_20d")?.rank;
      const values = [
        ["10モデル平均予測", percent(row.prediction_return_ensemble_mean, true)],
        ["校正予測", percent(row.prediction_return_calibrated ?? row.prediction_return, true)],
        ["予測終値", numeric(row.predicted_close) === null ? "-" : `${price.format(row.predicted_close)}円`],
        ["上昇確率", percent(row.up_probability)],
        ["10モデル平均順位", numeric(row.ensemble_rank_mean) === null ? "-" : `${number.format(row.ensemble_rank_mean)}位`],
        ["順位ぶれ", numeric(row.ensemble_rank_std) === null ? "-" : `${number.format(row.ensemble_rank_std)}位`],
        ["全銘柄順位", allRank ? `${allRank}位` : "-"],
        ["流動性あり順位", liquidRank ? `${liquidRank}位` : "-"],
        ["モデル状態", row.model_status === "validated" ? "検証済み" : "暫定"],
        ["データ状態", row.data_status === "official" ? "確定" : "暫定"],
      ];
      values.forEach(([label, value]) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        const td = document.createElement("td");
        th.scope = "row";
        th.textContent = label;
        td.textContent = value;
        tr.append(th, td);
        table.append(tr);
      });
    }

    function renderTopN(rows) {
      const table = document.getElementById("top-n-table");
      table.replaceChildren();
      [
        ["all", "全銘柄"],
        ["liquid_100m_20d", "流動性あり"],
      ].forEach(([profile, label]) => {
        const tr = document.createElement("tr");
        const heading = document.createElement("th");
        heading.scope = "row";
        heading.textContent = label;
        tr.append(heading);
        topNValues.forEach((topN) => {
          const record = rows.find((item) => item.liquidity_profile === profile && Number(item.top_n) === topN);
          const probability = numeric(record?.top_n_probability) ?? 0;
          const td = document.createElement("td");
          const span = document.createElement("span");
          span.className = `probability ${probability >= 0.7 ? "pass" : ""}`;
          span.textContent = percent(probability);
          td.append(span);
          tr.append(td);
        });
        table.append(tr);
      });
    }

    function chartData() {
      const five = predictionByTarget.get("target_5d");
      const twenty = predictionByTarget.get("target_20d");
      const signalDate = five?.signal_date ?? twenty?.signal_date;
      const history = priceHistoryPayload?.series_by_signal_date?.[signalDate]?.[selectedSymbol] ?? [];
      const predictionPoint = (row, target, session) => {
        if (!row) return null;
        const baseClose = Number(row.base_close);
        const intervalReturns = row.prediction_intervals ?? {
          95: {
            lower: row.prediction_interval_lower,
            upper: row.prediction_interval_upper,
          },
        };
        const intervals = Object.fromEntries(
          Object.entries(intervalReturns).flatMap(([key, value]) => {
            const lowerReturn = Number(value?.lower);
            const upperReturn = Number(value?.upper);
            if (
              !Number.isFinite(baseClose)
              || !Number.isFinite(lowerReturn)
              || !Number.isFinite(upperReturn)
            ) return [];
            return [[key, {
              lowerClose: baseClose * (1 + lowerReturn),
              upperClose: baseClose * (1 + upperReturn),
            }]];
          }),
        );
        return {
          target,
          session,
          date: row.target_date,
          close: Number(row.predicted_close),
          intervals,
        };
      };
      return {
        history: history.map(([date, close]) => ({ date, close: Number(close) })),
        predictions: [
          predictionPoint(five, "target_5d", 5),
          predictionPoint(twenty, "target_20d", 20),
        ].filter((item) => item && Number.isFinite(item.close)),
      };
    }

    function drawPriceChart() {
      const canvas = document.getElementById("price-chart");
      const shell = document.getElementById("price-chart-shell");
      const empty = document.getElementById("price-chart-empty");
      const { history, predictions } = chartData();
      if (!history.length) {
        empty.classList.add("visible");
        chartGeometry = null;
        return;
      }
      empty.classList.remove("visible");
      const rect = shell.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(320, rect.width - 24);
      const height = Math.max(260, rect.height - 20);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const padding = { top: 22, right: 30, bottom: 45, left: 68 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const values = [...history.map((item) => item.close), ...predictions.map((item) => item.close)];
      const selectedIntervals = [
        ...document.querySelectorAll('input[name="prediction-interval"]:checked'),
      ].map((input) => input.value).sort((left, right) => Number(right) - Number(left));
      if (selectedIntervals.length) {
        predictions.forEach((item) => {
          selectedIntervals.forEach((coverage) => {
            const interval = item.intervals?.[coverage];
            if (Number.isFinite(interval?.lowerClose)) values.push(interval.lowerClose);
            if (Number.isFinite(interval?.upperClose)) values.push(interval.upperClose);
          });
        });
      }
      let minimum = Math.min(...values);
      let maximum = Math.max(...values);
      const margin = Math.max((maximum - minimum) * 0.12, maximum * 0.015, 1);
      minimum -= margin;
      maximum += margin;
      const startSession = -(history.length - 1);
      const x = (session) => padding.left + (session - startSession) / (20 - startSession) * plotWidth;
      const y = (value) => padding.top + (maximum - value) / (maximum - minimum) * plotHeight;

      context.font = '11px "Segoe UI", "Yu Gothic UI", sans-serif';
      context.textBaseline = "middle";
      context.strokeStyle = "#e2e7eb";
      context.fillStyle = "#66717d";
      context.lineWidth = 1;
      for (let index = 0; index <= 4; index += 1) {
        const value = maximum - (maximum - minimum) * index / 4;
        const gridY = y(value);
        context.beginPath();
        context.moveTo(padding.left, gridY);
        context.lineTo(width - padding.right, gridY);
        context.stroke();
        context.textAlign = "right";
        context.fillText(`${price.format(value)}円`, padding.left - 9, gridY);
      }

      const signalX = x(0);
      context.setLineDash([4, 4]);
      context.strokeStyle = "#aeb8c2";
      context.beginPath();
      context.moveTo(signalX, padding.top);
      context.lineTo(signalX, padding.top + plotHeight);
      context.stroke();
      context.setLineDash([]);

      const historyPoints = history.map((item, index) => ({
        ...item,
        session: startSession + index,
        x: x(startSession + index),
        y: y(item.close),
        kind: "history",
      }));
      context.strokeStyle = "#18212b";
      context.lineWidth = 2;
      context.beginPath();
      historyPoints.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.stroke();

      const latest = historyPoints.at(-1);
      const colors = { target_5d: "#245ea8", target_20d: "#08775c" };
      const predictionPoints = predictions.map((item) => ({
        ...item,
        x: x(item.session),
        y: y(item.close),
        kind: "prediction",
      }));
      selectedIntervals.forEach((coverage, coverageIndex) => {
        const intervalPoints = predictionPoints
          .map((point) => ({ ...point, ...point.intervals?.[coverage] }))
          .filter((point) => (
            Number.isFinite(point.lowerClose) && Number.isFinite(point.upperClose)
          ));
        if (!intervalPoints.length) return;
        const opacity = Math.min(0.08 + coverageIndex * 0.025, 0.18);
        context.save();
        context.fillStyle = `rgba(36, 94, 168, ${opacity})`;
        context.beginPath();
        context.moveTo(latest.x, latest.y);
        intervalPoints.forEach((point) => context.lineTo(point.x, y(point.upperClose)));
        [...intervalPoints].reverse().forEach((point) => context.lineTo(point.x, y(point.lowerClose)));
        context.closePath();
        context.fill();
        context.strokeStyle = `rgba(73, 104, 137, ${0.58 + coverageIndex * 0.07})`;
        context.lineWidth = 1.25;
        context.beginPath();
        context.moveTo(latest.x, latest.y);
        intervalPoints.forEach((point) => context.lineTo(point.x, y(point.upperClose)));
        context.stroke();
        context.beginPath();
        context.moveTo(latest.x, latest.y);
        intervalPoints.forEach((point) => context.lineTo(point.x, y(point.lowerClose)));
        context.stroke();
        context.restore();
      });
      const zeroReturnY = y(latest.close);
      context.save();
      context.setLineDash([3, 4]);
      context.strokeStyle = "rgba(90, 102, 114, 0.88)";
      context.lineWidth = 1.25;
      context.beginPath();
      context.moveTo(latest.x, zeroReturnY);
      context.lineTo(x(20), zeroReturnY);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#596672";
      context.font = '11px "Segoe UI", "Yu Gothic UI", sans-serif';
      context.textAlign = "right";
      context.textBaseline = "bottom";
      context.fillText("0%", x(20) - 3, zeroReturnY - 5);
      context.restore();
      predictionPoints.forEach((point) => {
        context.setLineDash([6, 5]);
        context.strokeStyle = colors[point.target];
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(latest.x, latest.y);
        context.lineTo(point.x, point.y);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = colors[point.target];
        context.beginPath();
        context.arc(point.x, point.y, 5, 0, Math.PI * 2);
        context.fill();
      });

      const labels = [
        { x: historyPoints[0].x, text: historyPoints[0].date, align: "left" },
        { x: latest.x, text: latest.date, align: "center" },
        ...predictionPoints.map((point) => ({ x: point.x, text: point.target === "target_5d" ? "+5日" : "+20日", align: "center" })),
      ];
      context.fillStyle = "#66717d";
      context.textBaseline = "top";
      labels.forEach((label) => {
        context.textAlign = label.align;
        context.fillText(label.text, label.x, padding.top + plotHeight + 13);
      });
      chartGeometry = { points: [...historyPoints, ...predictionPoints], width, height };
    }

    function renderPriceChartTooltip(event) {
      if (!chartGeometry) return;
      const shell = document.getElementById("price-chart-shell");
      const tooltip = document.getElementById("price-chart-tooltip");
      const rect = shell.getBoundingClientRect();
      const cursorX = event.clientX - rect.left - 12;
      const nearest = chartGeometry.points.reduce((best, point) => (
        Math.abs(point.x - cursorX) < Math.abs(best.x - cursorX) ? point : best
      ));
      tooltip.replaceChildren();
      const label = document.createElement("span");
      label.textContent = nearest.kind === "history"
        ? nearest.date
        : `${nearest.target === "target_5d" ? "5日" : "20日"}予測 ${nearest.date}`;
      const value = document.createElement("strong");
      value.textContent = `${price.format(nearest.close)}円`;
      tooltip.append(label, value);
      if (nearest.kind === "prediction") {
        [
          ...document.querySelectorAll('input[name="prediction-interval"]:checked'),
        ].sort((left, right) => Number(right.value) - Number(left.value)).forEach((input) => {
          const interval = nearest.intervals?.[input.value];
          if (!Number.isFinite(interval?.lowerClose) || !Number.isFinite(interval?.upperClose)) return;
          const range = document.createElement("span");
          range.className = "tooltip-range";
          range.textContent = `${input.value}%: ${price.format(interval.lowerClose)}〜${price.format(interval.upperClose)}円`;
          tooltip.append(range);
        });
      }
      tooltip.hidden = false;
      const left = Math.min(Math.max(nearest.x + 18, 6), rect.width - tooltip.offsetWidth - 6);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, nearest.y - 15)}px`;
    }

    function renderTarget(target) {
      const row = predictionByTarget.get(target);
      const content = document.getElementById("detail-content");
      const empty = document.getElementById("empty");
      if (!row) {
        content.hidden = true;
        empty.classList.add("visible");
        renderIdentity(null);
        return;
      }
      content.hidden = false;
      empty.classList.remove("visible");
      renderIdentity(row);

      const score = numeric(row.confidence_score);
      const forecast = numeric(row.prediction_return_calibrated ?? row.prediction_return);
      const upProbability = numeric(row.up_probability);
      setText("confidence-score", score === null ? "-" : number.format(score));
      setText("final-rank", row.final_rank ? `#${row.final_rank}` : "-");
      setText("calibrated-return", percent(forecast, true));
      const returnNode = document.getElementById("calibrated-return");
      returnNode.className = `large-value ${forecast !== null && forecast < 0 ? "value-down" : "value-up"}`;
      setText("predicted-close", numeric(row.predicted_close) === null ? "予測終値 -" : `予測終値 ${price.format(row.predicted_close)}円`);
      setText("up-probability", percent(upProbability));
      setText("target-date-caption", `${targetNames[target]}後対象日 ${row.target_date ?? "-"}`);
      document.getElementById("score-meter").style.width = `${Math.min(100, Math.max(0, score ?? 0))}%`;
      document.getElementById("probability-meter").style.width = `${Math.min(100, Math.max(0, (upProbability ?? 0) * 100))}%`;
      renderRange(row);
      renderDetailTable(row, rankingByTarget.get(target) ?? []);
      renderTopN(probabilitiesByTarget.get(target) ?? []);
      drawPriceChart();
    }

    function renderIntervalOptions() {
      const root = document.getElementById("interval-options");
      root.querySelectorAll("label").forEach((label) => label.remove());
      const coverages = new Set();
      predictionByTarget.forEach((row) => {
        Object.keys(row?.prediction_intervals ?? {}).forEach((key) => coverages.add(key));
      });
      if (!coverages.size) coverages.add("95");
      [...coverages].sort((left, right) => Number(right) - Number(left)).forEach((coverage) => {
        const label = document.createElement("label");
        label.className = "interval-option";
        const input = document.createElement("input");
        input.name = "prediction-interval";
        input.type = "checkbox";
        input.value = coverage;
        input.checked = requestedIntervals.has(coverage);
        label.append(input, `${coverage}%`);
        root.append(label);
      });
    }

    async function load() {
      document.getElementById("symbol-input").value = selectedSymbol.replace(".T", "");
      try {
        const manifestResponse = await fetch(`${manifestUrl}?t=${Date.now()}`, { cache: "no-store" });
        if (!manifestResponse.ok) throw new Error(`manifest: HTTP ${manifestResponse.status}`);
        manifest = await manifestResponse.json();
        document.getElementById("publication-status").textContent = `基準日 ${manifest.as_of_date ?? "-"}`;

        const namesResponse = await fetch(`symbol_names_jp.json?t=${Date.now()}`, { cache: "no-store" });
        if (namesResponse.ok) symbolNames = await namesResponse.json();

        const priceHistoryPromise = fetchLogical("symbol_price_history.json");
        await Promise.all(["target_5d", "target_20d"].map(async (target) => {
          const [predictionData, rankingData, probabilityData] = await Promise.all([
            fetchLogical(`latest_predictions_${target}.json`),
            fetchLogical(`rankings_${target}.json`),
            fetchLogical(`top_n_probabilities_${target}.json`),
          ]);
          predictionByTarget.set(target, (predictionData?.rows ?? []).find((row) => row.symbol === selectedSymbol));
          rankingByTarget.set(target, (rankingData?.rows ?? []).filter((row) => row.symbol === selectedSymbol));
          probabilitiesByTarget.set(target, (probabilityData?.rows ?? []).filter((row) => row.symbol === selectedSymbol));
        }));
        priceHistoryPayload = await priceHistoryPromise;
        renderIntervalOptions();
        renderTarget(activeTarget);
      } catch (error) {
        showNotice(`詳細データを読み込めませんでした: ${error.message}`);
        document.getElementById("publication-status").textContent = "読込エラー";
      }
    }

    document.querySelectorAll(".horizon-tab").forEach((button) => {
      button.addEventListener("click", () => {
        activeTarget = button.dataset.target;
        document.querySelectorAll(".horizon-tab").forEach((item) => item.classList.toggle("active", item === button));
        renderTarget(activeTarget);
      });
    });
    document.getElementById("symbol-search").addEventListener("submit", (event) => {
      event.preventDefault();
      const symbol = normalizeSymbol(document.getElementById("symbol-input").value);
      if (!/^\d{4}\.T$/.test(symbol)) {
        showNotice("4桁の銘柄コードを入力してください");
        return;
      }
      location.href = `symbol_detail.html?symbol=${encodeURIComponent(symbol.replace(".T", ""))}`;
    });
    document.getElementById("price-chart-shell").addEventListener("mousemove", renderPriceChartTooltip);
    document.getElementById("price-chart-shell").addEventListener("mouseleave", () => {
      document.getElementById("price-chart-tooltip").hidden = true;
    });
    document.getElementById("interval-options").addEventListener("change", () => {
      document.getElementById("price-chart-tooltip").hidden = true;
      const nextParams = new URLSearchParams(location.search);
      nextParams.delete("interval");
      const checkedIntervals = document.querySelectorAll('input[name="prediction-interval"]:checked');
      checkedIntervals.forEach((checked) => {
        nextParams.append("interval", checked.value);
      });
      if (!checkedIntervals.length) nextParams.set("interval", "none");
      history.replaceState(null, "", `${location.pathname}?${nextParams.toString()}`);
      drawPriceChart();
    });
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawPriceChart, 100);
    });
    load();