    const manifestUrl = "../test/web/data/manifest.json";
    const TOP_N_VALUES = [1, 5, 10, 20, 50, 100];
    const chartColors = { ai: "#245ea8", matched: "#c47b12", buyHold: "#65727e" };
    const topNAssetColors = {
      1: "#245ea8", 5: "#08775c", 10: "#c47b12",
      20: "#9b3f75", 50: "#0087a8", 100: "#52606c",
    };
    const topNMetrics = {
      prediction_actual: { label: "平均予測・実績リターン", scale: 100, unit: "%", description: "Top Nの平均予測リターンと平均実績リターン" },
      market_returns: { label: "市場リターン比較", scale: 100, unit: "%", description: "Top N実績、1306.T、全対象銘柄平均の同期間リターン" },
      excess_returns: { label: "超過リターン", scale: 100, unit: "%", description: "Top N実績の1306.Tおよび全対象銘柄平均に対する超過" },
      positive_actual_ratio: { label: "Precision@N", scale: 100, unit: "%", domain: [0, 100], description: "Top N銘柄のうち実績リターンがプラスだった割合" },
      mean_prediction_error: { label: "平均予測誤差", scale: 100, unit: "%", description: "平均予測リターン - 平均実績リターン" },
    };
    const modelMetrics = {
      mae: { label: "MAE", scale: 100, unit: "%", description: "予測リターンと実績リターンの絶対誤差平均" },
      rmse: { label: "RMSE", scale: 100, unit: "%", description: "大きな誤差へ強く反応する二乗平均平方根誤差" },
      direction_accuracy: { label: "方向性一致率", scale: 100, unit: "%", domain: [0, 100], description: "上昇・下落の符号が一致した割合" },
      rank_correlation: { label: "Rank IC", scale: 1, unit: "", domain: [-1, 1], description: "予測順位と実績順位のSpearman相関" },
      mean_error: { label: "ME", scale: 100, unit: "%", description: "平均（予測リターン - 実績リターン）" },
      median_absolute_error: { label: "MedAE", scale: 100, unit: "%", description: "絶対誤差の中央値" },
      evaluation_coverage: { label: "Coverage", scale: 100, unit: "%", domain: [0, 100], description: "成熟済み予測のうち正式評価できた割合" },
    };
    let manifest = null;
    let activeTarget = "target_5d";
    let activePredictionLiquidity = "all";
    let chartDays = 7;
    let topNChartMode = "bar";
    let modelChartMode = "bar";
    let chartPayload = { portfolios: null, history: null, benchmark: null, topN: null, model: null, confidence: null, quantiles: null };
    let chartGeometry = null;
    const analysisChartGeometry = { topn: null, model: null };
    const predictionCache = new Map();
    const rankingCache = new Map();
    let symbolNames = Object.create(null);

    const number = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
    const money = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
    const assetValue = new Intl.NumberFormat("ja-JP", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

    function setStatus(type, value) {
      document.getElementById("status-dot").className = `status-dot ${type}`;
      document.getElementById("status-text").textContent = value;
    }
    function showNotice(message) {
      const notice = document.getElementById("notice");
      notice.textContent = message;
      notice.classList.toggle("visible", Boolean(message));
    }
    function text(id, value) { document.getElementById(id).textContent = value ?? "-"; }
    function formatValue(value, formatter = number) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? formatter.format(numeric) : "-";
    }
    function numericOrNull(value) {
      if (value === null || value === undefined || value === "") return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    function manifestFile(suffix) {
      return manifest?.files?.find((item) => (
        item.logical_name === suffix || item.path?.endsWith(suffix)
      ));
    }
    function publishedUrl(suffix) {
      const file = manifestFile(suffix);
      return file ? `../test/web/data/${file.path}` : null;
    }
    async function fetchPublicationPath(path) {
      const response = await fetch(`../test/web/data/${path}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return response.json();
    }
    function mergeYearShards(base, shards) {
      const merged = { ...base };
      shards.sort((left, right) => String(left.year ?? "").localeCompare(String(right.year ?? "")));
      shards.forEach((shard) => {
        if (shard.history) {
          merged.history ??= {};
          Object.entries(shard.history).forEach(([key, rows]) => {
            merged.history[key] ??= [];
            merged.history[key].push(...rows);
          });
        }
        if (shard.series) {
          merged.series ??= {};
          Object.entries(shard.series).forEach(([key, rows]) => {
            merged.series[key] ??= [];
            merged.series[key].push(...rows);
          });
        }
        if (shard.rows) {
          merged.rows ??= [];
          merged.rows.push(...shard.rows);
        }
      });
      Object.values(merged.history ?? {}).forEach((rows) => (
        rows.sort((left, right) => String(left.as_of_date ?? "").localeCompare(String(right.as_of_date ?? "")))
      ));
      Object.values(merged.series ?? {}).forEach((rows) => (
        rows.sort((left, right) => String(left.price_date ?? "").localeCompare(String(right.price_date ?? "")))
      ));
      if (merged.rows) {
        merged.rows.sort((left, right) => {
          const leftKey = [
            left.target ?? "",
            left.validation_start_date ?? "",
            left.as_of_date ?? left.price_date ?? "",
            Number(left.quantile ?? 0),
          ];
          const rightKey = [
            right.target ?? "",
            right.validation_start_date ?? "",
            right.as_of_date ?? right.price_date ?? "",
            Number(right.quantile ?? 0),
          ];
          return leftKey[0].localeCompare(rightKey[0])
            || leftKey[1].localeCompare(rightKey[1])
            || leftKey[2].localeCompare(rightKey[2])
            || leftKey[3] - rightKey[3];
        });
      }
      return merged;
    }
    async function fetchPublished(suffix) {
      const file = manifestFile(suffix);
      if (!file) return null;
      if (file.format !== "year_shards_v1") {
        return fetchPublicationPath(file.path);
      }
      const [base, ...shards] = await Promise.all([
        fetchPublicationPath(file.path),
        ...(file.shards ?? []).map((shard) => fetchPublicationPath(shard.path)),
      ]);
      return mergeYearShards(base, shards);
    }

    async function loadSymbolNames() {
      try {
        const response = await fetch(`symbol_names_jp.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        symbolNames = await response.json();
      } catch (error) {
        symbolNames = Object.create(null);
        console.warn(`銘柄名一覧を取得できません: ${error.message}`);
      }
    }

    function symbolColumnWidth(rows) {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return 220;
      const fontFamily = getComputedStyle(document.body).fontFamily;
      let widest = 0;
      rows.slice(0, 100).forEach((row) => {
        const symbol = String(row.symbol ?? "-");
        const name = String(symbolNames[symbol] ?? "");
        context.font = `700 13px ${fontFamily}`;
        const codeWidth = context.measureText(symbol).width;
        context.font = `400 12px ${fontFamily}`;
        const nameWidth = name ? context.measureText(name).width + 8 : 0;
        widest = Math.max(widest, codeWidth + nameWidth + 24);
      });
      return Math.ceil(Math.max(160, widest));
    }

    function renderFiles() {
      const root = document.getElementById("files");
      const empty = document.getElementById("files-empty");
      root.replaceChildren();
      const files = manifest?.files ?? [];
      empty.hidden = files.length > 0;
      files.forEach((file) => {
        const row = document.createElement("div");
        row.className = "file-row";
        const name = document.createElement("div");
        name.className = "file-name";
        name.textContent = file.logical_name ?? file.path.split("/").at(-1);
        const meta = document.createElement("div");
        meta.className = "file-meta";
        meta.textContent = `${formatValue(file.bytes, money)} bytes | ${file.sha256.slice(0, 12)}`;
        row.append(name, meta);
        root.append(row);
      });
    }

    async function renderPredictions(target) {
      const body = document.getElementById("prediction-body");
      const empty = document.getElementById("prediction-empty");
      body.replaceChildren();
      const url = publishedUrl(`latest_predictions_${target}.json`);
      const rankingUrl = publishedUrl(`rankings_${target}.json`);
      if (!url || !rankingUrl) {
        empty.hidden = false;
        text("prediction-ranking-count", "-");
        return;
      }
      try {
        const requests = [];
        if (!predictionCache.has(target)) {
          requests.push(
            fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).then(async (response) => {
              if (!response.ok) throw new Error(`latest predictions: HTTP ${response.status}`);
              predictionCache.set(target, await response.json());
            }),
          );
        }
        if (!rankingCache.has(target)) {
          requests.push(
            fetch(`${rankingUrl}?t=${Date.now()}`, { cache: "no-store" }).then(async (response) => {
              if (!response.ok) throw new Error(`rankings: HTTP ${response.status}`);
              rankingCache.set(target, await response.json());
            }),
          );
        }
        await Promise.all(requests);
        const predictionRows = predictionCache.get(target)?.rows ?? [];
        const predictionsBySymbol = new Map(
          predictionRows.map((row) => [String(row.symbol), row]),
        );
        const rows = (rankingCache.get(target)?.rows ?? [])
          .filter((row) => row.liquidity_profile === activePredictionLiquidity)
          .sort((left, right) => Number(left.rank) - Number(right.rank))
          .map((ranking) => {
            const prediction = predictionsBySymbol.get(String(ranking.symbol));
            return prediction
              ? { ...prediction, ...ranking, final_rank: ranking.rank }
              : null;
          })
          .filter(Boolean);
        const visibleRows = rows.slice(0, 100);
        const profileLabel = activePredictionLiquidity === "all" ? "全銘柄" : "流動性あり";
        text(
          "prediction-ranking-count",
          `${profileLabel} ${money.format(rows.length)}銘柄中 上位${money.format(visibleRows.length)}件`,
        );
        document.querySelector(".prediction-table").style.setProperty(
          "--symbol-column-width",
          `${symbolColumnWidth(visibleRows)}px`,
        );
        empty.hidden = rows.length > 0;
        empty.textContent = `${profileLabel}ランキングはまだありません`;
        visibleRows.forEach((row) => {
          const tr = document.createElement("tr");
          const rawPrediction = row.prediction_return_raw == null ? Number.NaN : Number(row.prediction_return_raw) * 100;
          const ensemblePrediction = row.prediction_return_ensemble_mean == null ? Number.NaN : Number(row.prediction_return_ensemble_mean) * 100;
          const prediction = Number(row.prediction_return_calibrated ?? row.prediction_return) * 100;
          const upProbability = row.up_probability == null ? Number.NaN : Number(row.up_probability) * 100;
          const intervalLower = row.prediction_interval_lower == null ? Number.NaN : Number(row.prediction_interval_lower) * 100;
          const intervalUpper = row.prediction_interval_upper == null ? Number.NaN : Number(row.prediction_interval_upper) * 100;
          const confidenceScore = row.confidence_score == null ? Number.NaN : Number(row.confidence_score);
          const rankMean = row.ensemble_rank_mean == null ? Number.NaN : Number(row.ensemble_rank_mean);
          const rankStd = row.ensemble_rank_std == null ? Number.NaN : Number(row.ensemble_rank_std);
          const rankPctStd = row.ensemble_rank_pct_std == null ? Number.NaN : Number(row.ensemble_rank_pct_std) * 100;
          const values = [
            row.final_rank ?? row.rank, row.raw_rank ?? "-", row.symbol, formatValue(row.base_close),
            Number.isFinite(rawPrediction) ? `${rawPrediction >= 0 ? "+" : ""}${number.format(rawPrediction)}%` : "-",
            Number.isFinite(ensemblePrediction) ? `${ensemblePrediction >= 0 ? "+" : ""}${number.format(ensemblePrediction)}%` : "-",
            Number.isFinite(prediction) ? `${prediction >= 0 ? "+" : ""}${number.format(prediction)}%` : "-",
            Number.isFinite(upProbability) ? `${number.format(upProbability)}%` : "-",
            Number.isFinite(intervalLower) && Number.isFinite(intervalUpper)
              ? `${number.format(intervalLower)}% ～ ${number.format(intervalUpper)}%`
              : "-",
            Number.isFinite(rankMean) ? `${number.format(rankMean)}位` : "-",
            Number.isFinite(rankStd) ? `${number.format(rankStd)}位` : "-",
            Number.isFinite(rankPctStd) ? `${number.format(rankPctStd)}%` : "-",
            Number.isFinite(confidenceScore) ? `${number.format(confidenceScore)} / 100` : "-",
            formatValue(row.predicted_close), formatValue(row.median_traded_value_20d, money), row.data_status ?? "-",
          ];
          values.forEach((value, index) => {
            const td = document.createElement("td");
            if (index === 2) {
              td.className = "symbol-cell";
              const link = document.createElement("a");
              link.className = "symbol-line symbol-link";
              link.href = `symbol_detail.html?symbol=${encodeURIComponent(String(value ?? "").replace(".T", ""))}`;
              const code = document.createElement("span");
              code.className = "symbol-code";
              code.textContent = value ?? "-";
              link.append(code);
              const nameValue = symbolNames[String(value)] ?? "";
              if (nameValue) {
                const name = document.createElement("span");
                name.className = "symbol-name";
                name.textContent = nameValue;
                link.append(name);
              }
              td.append(link);
            } else {
              const content = document.createElement("span");
              if (index === 0) content.className = "edge-score-content";
              if (index === 15) content.className = "edge-status-content";
              content.textContent = value ?? "-";
              td.append(content);
            }
            if (index === 6 && Number.isFinite(prediction)) td.className = prediction >= 0 ? "positive" : "negative";
            tr.append(td);
          });
          body.append(tr);
        });
      } catch (error) {
        empty.hidden = false;
        empty.textContent = `予測データを取得できません: ${error.message}`;
        text("prediction-ranking-count", "-");
      }
    }

    function selectedTopNs() {
      return [...document.querySelectorAll('input[name="chart-top-n"]:checked')]
        .map((input) => Number(input.value))
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
    }

    function selectedChartSeries() {
      return new Set(
        [...document.querySelectorAll('input[name="chart-series"]:checked')]
          .map((input) => input.value)
      );
    }

    function selectedSeries(topN) {
      const target = document.getElementById("chart-target").value;
      const liquidity = document.getElementById("chart-liquidity").value;
      return (chartPayload.portfolios?.rows ?? []).find((item) =>
        item.target === target && item.liquidity_profile === liquidity && Number(item.top_n) === topN
      );
    }

    function renderChartLegend(lines) {
      const root = document.getElementById("chart-legend");
      root.replaceChildren();
      lines.forEach((line) => {
        const item = document.createElement("span");
        item.className = "legend-item";
        item.style.color = line.color;
        const sample = document.createElement("span");
        sample.className = "legend-line";
        if (line.dash?.length) {
          sample.style.background = `repeating-linear-gradient(to right, ${line.color} 0 7px, transparent 7px 11px)`;
        }
        const label = document.createElement("span");
        label.textContent = line.label;
        item.append(sample, label);
        root.append(item);
      });
    }

    function chartData() {
      const visibleSeries = selectedChartSeries();
      const target = document.getElementById("chart-target").value;
      const entries = selectedTopNs().map((topN) => {
        const series = selectedSeries(topN);
        const seriesId = series?.series_id ?? null;
        const firstEntryDate = series?.first_entry_date ?? null;
        const rows = seriesId
          ? (chartPayload.history?.series?.[seriesId] ?? []).filter(
              (row) => firstEntryDate && row.price_date >= firstEntryDate
            )
          : [];
        return { topN, series, seriesId, firstEntryDate, rows };
      });
      const canonicalSeries = (chartPayload.portfolios?.rows ?? []).find((item) =>
        item.target === target
        && item.liquidity_profile === "all"
        && Number(item.top_n) === 1
      ) ?? entries.find((entry) => entry.series)?.series;
      const canonicalRows = canonicalSeries?.series_id
        ? (chartPayload.history?.series?.[canonicalSeries.series_id] ?? [])
        : [];
      const buyHoldStarts = Object.keys(chartPayload.benchmark?.series ?? {}).sort();
      const buyHoldRows = buyHoldStarts.length
        ? chartPayload.benchmark.series[buyHoldStarts[0]]
        : (chartPayload.benchmark?.rows ?? []);
      const allDates = [...new Set([
        ...entries.flatMap((entry) => entry.rows.map((row) => row.price_date)),
        ...canonicalRows.map((row) => row.price_date),
        ...buyHoldRows.map((row) => row.price_date),
      ].filter(Boolean))].sort();
      const dates = allDates.slice(-chartDays);
      const visible = new Set(dates);
      const finiteOrNull = (value) => Number.isFinite(value) ? value : null;
      const lines = visibleSeries.has("ai") ? entries.map((entry) => {
        const values = new Map(entry.rows.filter((row) => visible.has(row.price_date)).map((row) => [row.price_date, numericOrNull(row.portfolio_value)]));
        return {
          key: `ai-${entry.topN}`,
          label: `AI Top ${entry.topN}`,
          color: topNAssetColors[entry.topN],
          values: dates.map((date) => finiteOrNull(values.get(date))),
        };
      }) : [];

      if (visibleSeries.has("matched")) {
        const matchedMap = new Map(canonicalRows.filter((row) => visible.has(row.price_date)).map((row) => [row.price_date, numericOrNull(row.matched_benchmark_value)]));
        lines.push({
          key: "matched",
          label: `同一日程1306.T (${target === "target_5d" ? "5d" : "20d"})`,
          color: chartColors.matched,
          dash: [7, 4],
          values: dates.map((date) => finiteOrNull(matchedMap.get(date))),
        });
      }
      if (visibleSeries.has("buyHold")) {
        const buyHoldMap = new Map(buyHoldRows.filter((row) => visible.has(row.price_date)).map((row) => [row.price_date, numericOrNull(row.benchmark_value)]));
        lines.push({
          key: "buyHold",
          label: "1306.T買いっぱなし",
          color: chartColors.buyHold,
          dash: [2, 4],
          values: dates.map((date) => finiteOrNull(buyHoldMap.get(date))),
        });
      }
      return {
        seriesIds: entries.map((entry) => entry.seriesId).filter(Boolean),
        selectedTopNs: entries.map((entry) => entry.topN),
        dates,
        lines,
      };
    }

    function drawChart() {
      const canvas = document.getElementById("performance-chart");
      const shell = document.getElementById("chart-shell");
      const empty = document.getElementById("chart-empty");
      const tooltip = document.getElementById("chart-tooltip");
      tooltip.hidden = true;
      const data = chartData();
      renderChartLegend(data.lines);
      const finiteValues = data.lines.flatMap((line) => line.values.filter(Number.isFinite));
      const available = data.dates.length;
      const start = data.dates.at(0);
      const end = data.dates.at(-1);
      const selection = data.selectedTopNs.length > 1 ? ` | Top ${data.selectedTopNs.join(", ")}比較` : "";
      text("chart-window", available ? `${start} - ${end} | ${available}営業日${selection}` : "データなし");

      const rect = shell.getBoundingClientRect();
      const width = Math.max(Math.floor(rect.width), 320);
      const height = Math.max(Math.floor(rect.height), 280);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (!data.seriesIds.length) {
        empty.hidden = false;
        empty.textContent = "選択した系列の公開データはまだありません";
        chartGeometry = null;
        return;
      }
      if (!finiteValues.length || !available) {
        empty.hidden = false;
        empty.textContent = "ポートフォリオ開始後にグラフを表示します";
        chartGeometry = null;
        return;
      }
      empty.hidden = true;

      const padding = { left: width < 520 ? 52 : 66, right: 20, top: 12, bottom: 38 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      let min = Math.min(...finiteValues);
      let max = Math.max(...finiteValues);
      const span = max - min || Math.max(Math.abs(max) * 0.02, 0.02);
      min -= span * 0.12;
      max += span * 0.12;
      const xAt = (index) => padding.left + (available <= 1 ? plotWidth / 2 : index * plotWidth / (available - 1));
      const yAt = (value) => padding.top + (max - value) * plotHeight / (max - min);

      ctx.font = "11px Segoe UI, Yu Gothic UI, sans-serif";
      ctx.textBaseline = "middle";
      for (let index = 0; index <= 4; index += 1) {
        const value = min + (max - min) * index / 4;
        const y = yAt(value);
        ctx.beginPath();
        ctx.strokeStyle = "#e3e8ed";
        ctx.lineWidth = 1;
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.fillStyle = "#66717d";
        ctx.textAlign = "right";
        ctx.fillText(assetValue.format(value), padding.left - 8, y);
      }

      const tickCount = Math.min(5, available);
      for (let tick = 0; tick < tickCount; tick += 1) {
        const index = tickCount === 1 ? 0 : Math.round(tick * (available - 1) / (tickCount - 1));
        ctx.fillStyle = "#66717d";
        ctx.textAlign = tick === 0 ? "left" : tick === tickCount - 1 ? "right" : "center";
        ctx.fillText(data.dates[index].slice(5), xAt(index), height - 16);
      }

      data.lines.forEach((line) => {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.key.startsWith("ai-") ? 2.5 : 2;
        ctx.setLineDash(line.dash ?? []);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        let drawing = false;
        ctx.beginPath();
        line.values.forEach((value, index) => {
          if (!Number.isFinite(value)) { drawing = false; return; }
          const x = xAt(index);
          const y = yAt(value);
          if (!drawing) { ctx.moveTo(x, y); drawing = true; } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
        ctx.setLineDash([]);
      });
      chartGeometry = { data, padding, width, height, plotWidth, plotHeight, min, max, xAt, yAt };
    }

    function drawBarChart({ canvasId, shellId, emptyId, labels, values, metric, colors, geometryKey, dates = [] }) {
      const canvas = document.getElementById(canvasId);
      const shell = document.getElementById(shellId);
      const empty = document.getElementById(emptyId);
      const scaled = values.map((value) => Number.isFinite(value) ? value * metric.scale : null);
      const finite = scaled.filter(Number.isFinite);
      const rect = shell.getBoundingClientRect();
      const width = Math.max(Math.floor(rect.width), 320);
      const height = Math.max(Math.floor(rect.height), 260);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (geometryKey) analysisChartGeometry[geometryKey] = null;
      if (!finite.length) {
        empty.hidden = false;
        return;
      }
      empty.hidden = true;

      const padding = { left: width < 520 ? 54 : 68, right: 20, top: 28, bottom: 42 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      let min;
      let max;
      if (metric.domain) {
        [min, max] = metric.domain;
      } else {
        min = Math.min(0, ...finite);
        max = Math.max(0, ...finite);
        const span = max - min || Math.max(Math.abs(max) * 0.1, 1);
        min -= span * 0.12;
        max += span * 0.12;
      }
      const yAt = (value) => padding.top + (max - value) * plotHeight / (max - min);
      const zeroY = yAt(Math.min(max, Math.max(min, 0)));
      ctx.font = "11px Segoe UI, Yu Gothic UI, sans-serif";
      ctx.textBaseline = "middle";
      for (let index = 0; index <= 4; index += 1) {
        const value = min + (max - min) * index / 4;
        const y = yAt(value);
        ctx.beginPath();
        ctx.strokeStyle = Math.abs(value) < 1e-10 ? "#aeb8c2" : "#e3e8ed";
        ctx.lineWidth = 1;
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.fillStyle = "#66717d";
        ctx.textAlign = "right";
        ctx.fillText(`${number.format(value)}${metric.unit}`, padding.left - 8, y);
      }

      const slot = plotWidth / Math.max(labels.length, 1);
      const barWidth = Math.min(Math.max(slot * 0.54, 18), 72);
      labels.forEach((label, index) => {
        const center = padding.left + slot * (index + 0.5);
        const value = scaled[index];
        ctx.fillStyle = "#52606c";
        ctx.textAlign = "center";
        ctx.fillText(label, center, height - 17);
        if (!Number.isFinite(value)) {
          ctx.fillStyle = "#89949e";
          ctx.fillText("-", center, zeroY - 12);
          return;
        }
        const valueY = yAt(value);
        const top = Math.min(valueY, zeroY);
        const barHeight = Math.max(Math.abs(zeroY - valueY), 1);
        ctx.fillStyle = colors[index] ?? "#245ea8";
        ctx.fillRect(center - barWidth / 2, top, barWidth, barHeight);
        ctx.fillStyle = value < 0 ? "#b42318" : "#18212b";
        ctx.fillText(
          `${number.format(value)}${metric.unit}`,
          center,
          value >= 0 ? Math.max(valueY - 12, 10) : Math.min(valueY + 12, height - padding.bottom - 5),
        );
      });
      if (geometryKey) {
        analysisChartGeometry[geometryKey] = {
          mode: "bar",
          labels,
          dates,
          series: [{ label: metric.label, values: scaled, colors }],
          metric,
          padding,
          plotWidth,
          slot,
        };
      }
    }

    function chartCanvas(canvasId, shellId, emptyId, hasData) {
      const canvas = document.getElementById(canvasId);
      const shell = document.getElementById(shellId);
      const empty = document.getElementById(emptyId);
      const rect = shell.getBoundingClientRect();
      const width = Math.max(Math.floor(rect.width), 320);
      const height = Math.max(Math.floor(rect.height), 280);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      empty.hidden = hasData;
      return { ctx, width, height };
    }

    function metricDomain(values, metric) {
      if (metric.domain) return metric.domain;
      const finite = values.filter(Number.isFinite);
      let min = Math.min(0, ...finite);
      let max = Math.max(0, ...finite);
      const span = max - min || Math.max(Math.abs(max) * 0.1, 1);
      min -= span * 0.12;
      max += span * 0.12;
      return [min, max];
    }

    function drawAxes(ctx, { width, height, padding, min, max, metric }) {
      const plotHeight = height - padding.top - padding.bottom;
      const yAt = (value) => padding.top + (max - value) * plotHeight / (max - min);
      ctx.font = "11px Segoe UI, Yu Gothic UI, sans-serif";
      ctx.textBaseline = "middle";
      for (let index = 0; index <= 4; index += 1) {
        const value = min + (max - min) * index / 4;
        const y = yAt(value);
        ctx.beginPath();
        ctx.strokeStyle = Math.abs(value) < 1e-10 ? "#aeb8c2" : "#e3e8ed";
        ctx.lineWidth = 1;
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.fillStyle = "#66717d";
        ctx.textAlign = "right";
        ctx.fillText(`${number.format(value)}${metric.unit}`, padding.left - 8, y);
      }
      return yAt;
    }

    function drawLegend(ctx, series, startX = 68, y = 14) {
      let x = startX;
      ctx.font = "11px Segoe UI, Yu Gothic UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      series.forEach((item) => {
        ctx.fillStyle = item.color;
        ctx.fillRect(x, y - 4, 10, 8);
        ctx.fillStyle = "#3e4954";
        ctx.fillText(item.label, x + 15, y);
        x += 25 + ctx.measureText(item.label).width;
      });
    }

    function drawGroupedBarChart({ canvasId, shellId, emptyId, labels, series, metric, geometryKey, dates = [] }) {
      const scaledSeries = series.map((item) => ({
        ...item,
        values: item.values.map((value) => Number.isFinite(value) ? value * metric.scale : null),
      }));
      const finite = scaledSeries.flatMap((item) => item.values).filter(Number.isFinite);
      const { ctx, width, height } = chartCanvas(canvasId, shellId, emptyId, finite.length > 0);
      if (geometryKey) analysisChartGeometry[geometryKey] = null;
      if (!finite.length) return;
      const padding = { left: width < 520 ? 54 : 68, right: 20, top: 42, bottom: 42 };
      const plotWidth = width - padding.left - padding.right;
      const [min, max] = metricDomain(finite, metric);
      const yAt = drawAxes(ctx, { width, height, padding, min, max, metric });
      const zeroY = yAt(Math.min(max, Math.max(min, 0)));
      const slot = plotWidth / Math.max(labels.length, 1);
      const groupWidth = Math.min(slot * 0.76, 104);
      const barWidth = Math.max(Math.min(groupWidth / Math.max(series.length, 1) - 2, 28), 4);
      drawLegend(ctx, scaledSeries, padding.left, 15);
      labels.forEach((label, labelIndex) => {
        const center = padding.left + slot * (labelIndex + 0.5);
        ctx.fillStyle = "#52606c";
        ctx.textAlign = "center";
        ctx.fillText(label, center, height - 17);
        scaledSeries.forEach((item, seriesIndex) => {
          const value = item.values[labelIndex];
          if (!Number.isFinite(value)) return;
          const groupStart = center - (barWidth * scaledSeries.length) / 2;
          const x = groupStart + seriesIndex * barWidth;
          const valueY = yAt(value);
          ctx.fillStyle = item.color;
          ctx.fillRect(x, Math.min(valueY, zeroY), Math.max(barWidth - 1, 1), Math.max(Math.abs(zeroY - valueY), 1));
        });
      });
      if (geometryKey) {
        analysisChartGeometry[geometryKey] = {
          mode: "bar",
          labels,
          dates,
          series: scaledSeries,
          metric,
          padding,
          plotWidth,
          slot,
        };
      }
    }

    function drawMetricLineChart({ canvasId, shellId, emptyId, series, metric, geometryKey }) {
      const allDates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
      const datesIndex = new Map(allDates.map((date, index) => [date, index]));
      const normalized = series.map((item) => {
        const values = Array(allDates.length).fill(null);
        item.points.forEach((point) => {
          const value = Number.isFinite(point.value) ? point.value * metric.scale : null;
          values[datesIndex.get(point.date)] = value;
        });
        return { ...item, values };
      });
      const finite = normalized.flatMap((item) => item.values).filter(Number.isFinite);
      const { ctx, width, height } = chartCanvas(canvasId, shellId, emptyId, allDates.length > 0 && finite.length > 0);
      if (geometryKey) analysisChartGeometry[geometryKey] = null;
      if (!allDates.length || !finite.length) return;
      const padding = { left: width < 520 ? 54 : 68, right: 20, top: 42, bottom: 42 };
      const plotWidth = width - padding.left - padding.right;
      const [min, max] = metricDomain(finite, metric);
      const yAt = drawAxes(ctx, { width, height, padding, min, max, metric });
      const xAt = (index) => padding.left + (allDates.length === 1 ? plotWidth / 2 : index * plotWidth / (allDates.length - 1));
      drawLegend(ctx, normalized, padding.left, 15);
      const tickCount = Math.min(5, allDates.length);
      for (let tick = 0; tick < tickCount; tick += 1) {
        const index = tickCount === 1 ? 0 : Math.round(tick * (allDates.length - 1) / (tickCount - 1));
        ctx.fillStyle = "#66717d";
        ctx.textAlign = tick === 0 ? "left" : tick === tickCount - 1 ? "right" : "center";
        ctx.fillText(allDates[index].slice(5), xAt(index), height - 17);
      }
      normalized.forEach((item) => {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        let drawing = false;
        ctx.beginPath();
        item.values.forEach((value, index) => {
          if (!Number.isFinite(value)) { drawing = false; return; }
          if (drawing) ctx.lineTo(xAt(index), yAt(value));
          else { ctx.moveTo(xAt(index), yAt(value)); drawing = true; }
        });
        ctx.stroke();
      });
      if (geometryKey) {
        analysisChartGeometry[geometryKey] = {
          mode: "line",
          dates: allDates,
          series: normalized,
          metric,
          padding,
          plotWidth,
        };
      }
    }

    function topNValue(row, key) {
      if (!row) return null;
      if (key === "benchmark_return") {
        const actual = numericOrNull(row.mean_actual_return);
        const excess = numericOrNull(row.benchmark_excess_return);
        return Number.isFinite(actual) && Number.isFinite(excess) ? actual - excess : null;
      }
      if (key === "all_symbols_return") {
        const actual = numericOrNull(row.mean_actual_return);
        const excess = numericOrNull(row.all_symbols_excess_return);
        return Number.isFinite(actual) && Number.isFinite(excess) ? actual - excess : null;
      }
      return numericOrNull(row[key]);
    }

    function topNSeries(metricKey) {
      const definitions = {
        prediction_actual: [
          ["平均予測", "mean_prediction_return", "#245ea8"],
          ["平均実績", "mean_actual_return", "#08775c"],
        ],
        market_returns: [
          ["Top N実績", "mean_actual_return", "#08775c"],
          ["1306.T", "benchmark_return", "#c47b12"],
          ["全銘柄平均", "all_symbols_return", "#65727e"],
        ],
        excess_returns: [
          ["対1306.T超過", "benchmark_excess_return", "#c47b12"],
          ["対全銘柄平均超過", "all_symbols_excess_return", "#65727e"],
        ],
        positive_actual_ratio: [["Precision@N", "positive_actual_ratio", "#245ea8"]],
        mean_prediction_error: [["平均予測誤差", "mean_prediction_error", "#245ea8"]],
      };
      return definitions[metricKey].map(([label, key, color]) => ({ label, key, color }));
    }

    function setChartMode(containerId, mode) {
      document.querySelectorAll(`#${containerId} [data-chart-mode]`).forEach((button) => {
        button.classList.toggle("active", button.dataset.chartMode === mode);
      });
    }

    function drawTopNChart() {
      document.getElementById("topn-chart-tooltip").hidden = true;
      const target = document.getElementById("topn-target").value;
      const liquidity = document.getElementById("topn-liquidity").value;
      const metricKey = document.getElementById("topn-metric").value;
      const metric = topNMetrics[metricKey];
      const lineButton = document.querySelector('#topn-chart-modes [data-chart-mode="line"]');
      lineButton.disabled = metricKey === "mean_prediction_error";
      if (lineButton.disabled && topNChartMode === "line") topNChartMode = "bar";
      setChartMode("topn-chart-modes", topNChartMode);
      document.getElementById("topn-line-n-field").hidden = topNChartMode !== "line";
      const definitions = topNSeries(metricKey);

      if (topNChartMode === "bar") {
        const rows = (chartPayload.topN?.rows ?? []).filter(
          (row) => row.target === target && row.liquidity_profile === liquidity
        );
        const byN = new Map(rows.map((row) => [Number(row.top_n), row]));
        const orderedRows = TOP_N_VALUES.map((topN) => byN.get(topN));
        const statusCount = rows.filter((row) => row.data_status === "official").length;
        text("topn-caption", `${metric.description} | 最新比較 | official ${statusCount}/${rows.length}`);
        drawGroupedBarChart({
          canvasId: "topn-chart",
          shellId: "topn-chart-shell",
          emptyId: "topn-chart-empty",
          labels: TOP_N_VALUES.map((value) => `Top ${value}`),
          series: definitions.map((definition) => ({
            ...definition,
            values: orderedRows.map((row) => topNValue(row, definition.key)),
          })),
          metric,
          geometryKey: "topn",
          dates: orderedRows.map((row) => row?.as_of_date ?? null),
        });
        return;
      }

      const topN = Number(document.getElementById("topn-line-n").value);
      const key = `${target}|${liquidity}|${topN}`;
      const rows = chartPayload.topN?.history?.[key] ?? [];
      const officialCount = rows.filter((row) => row.data_status === "official").length;
      text("topn-caption", `${metric.description} | Top ${topN} 時系列 | official ${officialCount}/${rows.length}`);
      drawMetricLineChart({
        canvasId: "topn-chart",
        shellId: "topn-chart-shell",
        emptyId: "topn-chart-empty",
        series: definitions.map((definition) => ({
          ...definition,
          points: rows.map((row) => ({ date: row.as_of_date, value: topNValue(row, definition.key) })),
        })),
        metric,
        geometryKey: "topn",
      });
    }

    function drawModelChart() {
      document.getElementById("model-chart-tooltip").hidden = true;
      const metricKey = document.getElementById("model-metric").value;
      const rankScopeField = document.getElementById("model-rank-scope-field");
      const rankScope = document.getElementById("model-rank-scope").value;
      const usesTopNRank = metricKey === "rank_correlation" && rankScope !== "all";
      rankScopeField.hidden = metricKey !== "rank_correlation";
      const metric = usesTopNRank
        ? { ...modelMetrics[metricKey], label: `Rank IC@${rankScope}`, description: `通常ランキングTop ${rankScope}内の予測順位と実績順位のSpearman相関` }
        : modelMetrics[metricKey];
      const barButton = document.querySelector('#model-chart-modes [data-chart-mode="bar"]');
      const lineButton = document.querySelector('#model-chart-modes [data-chart-mode="line"]');
      barButton.disabled = metricKey === "evaluation_coverage";
      lineButton.disabled = metricKey === "mean_error";
      if (barButton.disabled && modelChartMode === "bar") modelChartMode = "line";
      if (lineButton.disabled && modelChartMode === "line") modelChartMode = "bar";
      setChartMode("model-chart-modes", modelChartMode);

      const targets = ["target_5d", "target_20d"];
      if (modelChartMode === "bar") {
        const rows = usesTopNRank
          ? (chartPayload.topN?.rows ?? []).filter((row) => row.liquidity_profile === "all" && Number(row.top_n) === Number(rankScope))
          : chartPayload.model?.rows ?? [];
        const byTarget = new Map(rows.map((row) => [row.target, row]));
        const values = targets.map((target) => numericOrNull(byTarget.get(target)?.[metricKey]));
        const counts = targets.map((target) => Number(byTarget.get(target)?.evaluated_count ?? 0));
        text("model-caption", `${metric.description} | 最新比較 | 評価件数 5d: ${money.format(counts[0])} / 20d: ${money.format(counts[1])}`);
        drawBarChart({
          canvasId: "model-chart",
          shellId: "model-chart-shell",
          emptyId: "model-chart-empty",
          labels: ["5d", "20d"],
          values,
          metric,
          colors: ["#245ea8", "#08775c"],
          geometryKey: "model",
          dates: targets.map((target) => byTarget.get(target)?.as_of_date ?? null),
        });
        return;
      }

      const colors = { target_5d: "#245ea8", target_20d: "#08775c" };
      const history = usesTopNRank
        ? chartPayload.topN?.history ?? {}
        : chartPayload.model?.history ?? {};
      const series = targets.map((target) => ({
        label: target === "target_5d" ? "5d" : "20d",
        color: colors[target],
        points: (history[usesTopNRank ? `${target}|all|${rankScope}` : target] ?? []).map((row) => ({ date: row.as_of_date, value: numericOrNull(row[metricKey]) })),
      }));
      const pointCount = series.reduce((total, item) => total + item.points.length, 0);
      text("model-caption", `${metric.description} | 時系列 | 履歴点数 ${money.format(pointCount)}`);
      drawMetricLineChart({
        canvasId: "model-chart",
        shellId: "model-chart-shell",
        emptyId: "model-chart-empty",
        series,
        metric,
        geometryKey: "model",
      });
    }

    function drawConfidenceChart() {
      document.getElementById("confidence-chart-tooltip").hidden = true;
      const target = document.getElementById("confidence-target").value;
      const metricKey = document.getElementById("confidence-metric").value;
      const confidenceRows = (chartPayload.confidence?.rows ?? []).filter((row) => row.target === target);
      if (metricKey === "quantile_actual") {
        const targetRows = (chartPayload.quantiles?.rows ?? []).filter((row) => row.target === target);
        const latestDate = targetRows.map((row) => row.as_of_date).sort().at(-1);
        const rows = targetRows.filter((row) => row.as_of_date === latestDate).sort((left, right) => Number(left.quantile) - Number(right.quantile));
        text("confidence-caption", `Confidence Scoreの十分位別平均 | ${latestDate ?? "未評価"}`);
        drawGroupedBarChart({
          canvasId: "confidence-chart",
          shellId: "confidence-chart-shell",
          emptyId: "confidence-chart-empty",
          labels: rows.map((row) => `D${row.quantile}`),
          series: [
            { label: "平均予測", color: "#245ea8", values: rows.map((row) => numericOrNull(row.mean_prediction_return)) },
            { label: "平均実績", color: "#08775c", values: rows.map((row) => numericOrNull(row.mean_actual_return)) },
          ],
          metric: { label: "平均リターン", scale: 100, unit: "%", description: "十分位別平均" },
          geometryKey: "confidence",
          dates: rows.map(() => latestDate),
        });
        return;
      }

      const definitions = metricKey === "rank_compare"
        ? [
            ["raw順位 Rank IC", "raw_rank_correlation", "#65727e"],
            ["Score順位 Rank IC", "score_rank_correlation", "#245ea8"],
          ]
        : [[
            {
              calibration_error: "上昇確率の校正誤差",
              prediction_interval_coverage: "95%予測区間 coverage",
              top_bottom_spread: "Top 10% - Bottom 10%実績差",
            }[metricKey],
            metricKey,
            "#245ea8",
          ]];
      const metric = metricKey === "rank_compare"
        ? { label: "Rank IC", scale: 1, unit: "", domain: [-1, 1], description: "raw順位とConfidence Score順位のSpearman相関比較" }
        : metricKey === "top_bottom_spread"
          ? { label: "実績差", scale: 100, unit: "%", description: "Score上位10%と下位10%の平均実績リターン差" }
          : { label: metricKey === "calibration_error" ? "校正誤差" : "coverage", scale: 100, unit: "%", domain: [0, 100], description: metricKey === "calibration_error" ? "上昇確率と実際の上昇率の差。小さいほど良い" : "実績が95%予測区間へ収まった割合" };
      text("confidence-caption", `${metric.description} | ${target === "target_5d" ? "5d" : "20d"} | 履歴 ${money.format(confidenceRows.length)}点`);
      drawMetricLineChart({
        canvasId: "confidence-chart",
        shellId: "confidence-chart-shell",
        emptyId: "confidence-chart-empty",
        series: definitions.map(([label, key, color]) => ({
          label,
          key,
          color,
          points: confidenceRows.map((row) => ({ date: row.as_of_date, value: numericOrNull(row[key]) })),
        })),
        metric,
        geometryKey: "confidence",
      });
    }

    function renderTooltip(event) {
      if (!chartGeometry) return;
      const shell = document.getElementById("chart-shell");
      const tooltip = document.getElementById("chart-tooltip");
      const rect = shell.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const { data, padding, plotWidth } = chartGeometry;
      if (x < padding.left || x > padding.left + plotWidth) { tooltip.hidden = true; return; }
      const index = data.dates.length <= 1 ? 0 : Math.round((x - padding.left) / plotWidth * (data.dates.length - 1));
      const values = data.lines.map((line) => ({ ...line, value: line.values[index] }));
      tooltip.replaceChildren();
      const date = document.createElement("div");
      date.className = "tooltip-date";
      date.textContent = data.dates[index];
      tooltip.append(date);
      values.forEach((line) => {
        const row = document.createElement("div");
        row.className = "tooltip-value";
        const label = document.createElement("span");
        label.textContent = line.label;
        label.style.color = line.color;
        const value = document.createElement("strong");
        value.textContent = Number.isFinite(line.value) ? assetValue.format(line.value) : "-";
        row.append(label, value);
        tooltip.append(row);
      });
      tooltip.hidden = false;
      const tooltipWidth = tooltip.offsetWidth;
      const left = Math.min(Math.max(x + 12, 6), rect.width - tooltipWidth - 6);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = "12px";
    }

    function renderAnalysisTooltip(event, geometryKey, shellId, tooltipId) {
      const geometry = analysisChartGeometry[geometryKey];
      if (!geometry) return;
      const shell = document.getElementById(shellId);
      const tooltip = document.getElementById(tooltipId);
      const rect = shell.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const { padding, plotWidth } = geometry;
      if (x < padding.left || x > padding.left + plotWidth) {
        tooltip.hidden = true;
        return;
      }
      let index;
      let title;
      if (geometry.mode === "line") {
        index = geometry.dates.length <= 1
          ? 0
          : Math.round((x - padding.left) / plotWidth * (geometry.dates.length - 1));
        title = geometry.dates[index];
      } else {
        index = Math.min(
          geometry.labels.length - 1,
          Math.max(0, Math.floor((x - padding.left) / geometry.slot)),
        );
        title = [geometry.dates[index], geometry.labels[index]].filter(Boolean).join(" | ");
      }

      tooltip.replaceChildren();
      const heading = document.createElement("div");
      heading.className = "tooltip-date";
      heading.textContent = title || "集計値";
      tooltip.append(heading);
      geometry.series.forEach((item) => {
        const row = document.createElement("div");
        row.className = "tooltip-value";
        const label = document.createElement("span");
        label.textContent = item.label;
        label.style.color = item.colors?.[index] ?? item.color ?? "#245ea8";
        const value = document.createElement("strong");
        const numeric = item.values[index];
        value.textContent = Number.isFinite(numeric)
          ? `${number.format(numeric)}${geometry.metric.unit}`
          : "-";
        row.append(label, value);
        tooltip.append(row);
      });
      tooltip.hidden = false;
      const tooltipWidth = tooltip.offsetWidth;
      const left = Math.min(Math.max(x + 12, 6), rect.width - tooltipWidth - 6);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = "12px";
    }

    async function loadChartPayload() {
      try {
        const [portfolios, history, benchmark, topN, model, confidence, quantiles] = await Promise.all([
          fetchPublished("portfolios.json"),
          fetchPublished("portfolio_history.json"),
          fetchPublished("benchmark_buy_and_hold.json"),
          fetchPublished("top_n_metrics.json"),
          fetchPublished("model_evaluation_summary.json"),
          fetchPublished("confidence_metrics.json"),
          fetchPublished("prediction_quantiles.json"),
        ]);
        chartPayload = { portfolios, history, benchmark, topN, model, confidence, quantiles };
        drawChart();
        drawTopNChart();
        drawModelChart();
        drawConfidenceChart();
      } catch (error) {
        chartPayload = { portfolios: null, history: null, benchmark: null, topN: null, model: null, confidence: null, quantiles: null };
        document.getElementById("chart-empty").hidden = false;
        document.getElementById("chart-empty").textContent = `グラフデータを取得できません: ${error.message}`;
        document.getElementById("topn-chart-empty").hidden = false;
        document.getElementById("topn-chart-empty").textContent = `Top N評価を取得できません: ${error.message}`;
        document.getElementById("model-chart-empty").hidden = false;
        document.getElementById("model-chart-empty").textContent = `モデル評価を取得できません: ${error.message}`;
        document.getElementById("confidence-chart-empty").hidden = false;
        document.getElementById("confidence-chart-empty").textContent = `v2信頼度評価を取得できません: ${error.message}`;
      }
    }

    async function loadManifest() {
      setStatus("", "読み込み中");
      showNotice("");
      predictionCache.clear();
      rankingCache.clear();
      try {
        await loadSymbolNames();
        const response = await fetch(`${manifestUrl}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        manifest = await response.json();
        text("as-of-date", manifest.as_of_date);
        text("run-id", manifest.pipeline_run_id);
        text("file-count", manifest.files?.length ?? 0);
        text("data-status", manifest.has_provisional_data ? "provisional" : "official");
        text("generated-at", `生成日時: ${manifest.generated_at ?? "-"}`);
        setStatus(manifest.has_provisional_data ? "warn" : "ok", "公開データ読み込み済み");
        renderFiles();
        await Promise.all([renderPredictions(activeTarget), loadChartPayload()]);
      } catch (error) {
        manifest = null;
        text("as-of-date", "-"); text("run-id", "-"); text("file-count", "0"); text("data-status", "未生成");
        text("generated-at", "公開データはまだありません");
        setStatus("error", "manifest未取得");
        showNotice(`test/web/data/manifest.jsonを取得できません: ${error.message}`);
        renderFiles();
        drawChart();
        drawTopNChart();
        drawModelChart();
        drawConfidenceChart();
      }
    }

    document.querySelectorAll(".tab[data-target]").forEach((button) => {
      button.addEventListener("click", async () => {
        activeTarget = button.dataset.target;
        document.querySelectorAll(".tab[data-target]").forEach((item) => item.classList.toggle("active", item === button));
        await renderPredictions(activeTarget);
      });
    });
    document.querySelectorAll("[data-prediction-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const isDetail = button.dataset.predictionView === "detail";
        document.querySelector(".prediction-table").classList.toggle("detail-view", isDetail);
        document.querySelectorAll("[data-prediction-view]").forEach((item) => {
          const isActive = item === button;
          item.classList.toggle("active", isActive);
          item.setAttribute("aria-pressed", String(isActive));
        });
      });
    });
    document.querySelectorAll("[data-prediction-liquidity]").forEach((button) => {
      button.addEventListener("click", async () => {
        activePredictionLiquidity = button.dataset.predictionLiquidity;
        document.querySelectorAll("[data-prediction-liquidity]").forEach((item) => {
          const isActive = item === button;
          item.classList.toggle("active", isActive);
          item.setAttribute("aria-pressed", String(isActive));
        });
        await renderPredictions(activeTarget);
      });
    });
    document.querySelectorAll("#topn-chart-modes [data-chart-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        topNChartMode = button.dataset.chartMode;
        drawTopNChart();
      });
    });
    document.querySelectorAll("#model-chart-modes [data-chart-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        modelChartMode = button.dataset.chartMode;
        drawModelChart();
      });
    });
    document.querySelectorAll(".period").forEach((button) => {
      button.addEventListener("click", () => {
        chartDays = button.dataset.days === "all"
          ? Number.MAX_SAFE_INTEGER
          : Number(button.dataset.days);
        document.querySelectorAll(".period").forEach((item) => item.classList.toggle("active", item === button));
        drawChart();
      });
    });
    ["chart-target", "chart-liquidity"].forEach((id) => document.getElementById(id).addEventListener("change", drawChart));
    document.getElementById("chart-top-n").addEventListener("change", (event) => {
      const all = document.getElementById("chart-top-n-all");
      const choices = [...document.querySelectorAll('input[name="chart-top-n"]')];
      if (event.target === all) {
        choices.forEach((input) => { input.checked = all.checked; });
      } else {
        if (!choices.some((input) => input.checked)) event.target.checked = true;
        all.checked = choices.every((input) => input.checked);
      }
      drawChart();
    });
    document.getElementById("chart-series-options").addEventListener("change", (event) => {
      const choices = [...document.querySelectorAll('input[name="chart-series"]')];
      if (!choices.some((input) => input.checked)) event.target.checked = true;
      drawChart();
    });
    ["topn-target", "topn-liquidity", "topn-metric", "topn-line-n"].forEach((id) => document.getElementById(id).addEventListener("change", drawTopNChart));
    document.getElementById("model-metric").addEventListener("change", drawModelChart);
    document.getElementById("model-rank-scope").addEventListener("change", drawModelChart);
    ["confidence-target", "confidence-metric"].forEach((id) => document.getElementById(id).addEventListener("change", drawConfidenceChart));
    document.getElementById("apply-custom-days").addEventListener("click", () => {
      const input = document.getElementById("custom-days");
      const days = Math.floor(Number(input.value));
      if (!Number.isFinite(days) || days < 1) { input.setCustomValidity("1以上の日数を入力してください"); input.reportValidity(); return; }
      input.setCustomValidity("");
      chartDays = days;
      document.querySelectorAll(".period").forEach((item) => item.classList.remove("active"));
      drawChart();
    });
    document.getElementById("custom-days").addEventListener("keydown", (event) => {
      if (event.key === "Enter") document.getElementById("apply-custom-days").click();
    });
    document.getElementById("chart-shell").addEventListener("mousemove", renderTooltip);
    document.getElementById("chart-shell").addEventListener("mouseleave", () => { document.getElementById("chart-tooltip").hidden = true; });
    document.getElementById("topn-chart-shell").addEventListener("mousemove", (event) => {
      renderAnalysisTooltip(event, "topn", "topn-chart-shell", "topn-chart-tooltip");
    });
    document.getElementById("topn-chart-shell").addEventListener("mouseleave", () => {
      document.getElementById("topn-chart-tooltip").hidden = true;
    });
    document.getElementById("model-chart-shell").addEventListener("mousemove", (event) => {
      renderAnalysisTooltip(event, "model", "model-chart-shell", "model-chart-tooltip");
    });
    document.getElementById("model-chart-shell").addEventListener("mouseleave", () => {
      document.getElementById("model-chart-tooltip").hidden = true;
    });
    document.getElementById("confidence-chart-shell").addEventListener("mousemove", (event) => {
      renderAnalysisTooltip(event, "confidence", "confidence-chart-shell", "confidence-chart-tooltip");
    });
    document.getElementById("confidence-chart-shell").addEventListener("mouseleave", () => {
      document.getElementById("confidence-chart-tooltip").hidden = true;
    });
    document.getElementById("reload").addEventListener("click", loadManifest);
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { drawChart(); drawTopNChart(); drawModelChart(); drawConfidenceChart(); }, 100);
    });
    loadManifest();
