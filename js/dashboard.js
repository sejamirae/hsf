/* ============================================================
   DASHBOARD.JS  —  Motor de renderizacao do BI
   ------------------------------------------------------------
   Le os dados em memoria (Data), aplica os filtros de periodo,
   visao e categoria, e renderiza KPIs, graficos e tabela.
   Toda filtragem e local: a planilha e lida uma unica vez.
   ============================================================ */

const Dashboard = (() => {

  const C = CONFIG.CORES;
  const estado = {
    periodo:   CONFIG.PERIODO_INICIAL,   // hoje|ontem|7dias|semana|mes|total|custom
    visao:     CONFIG.VISAO_INICIAL,     // diario|semanal|mensal|total
    categoria: "ambos",                  // ambos|sf|ext
    custom:    { ini: null, fim: null },
    ordem:     { col: "data", asc: false },
    busca:     "",
    pagina:    1
  };
  const graficos = {};
  let _filtrados = [];   // registros diarios apos filtro de periodo

  /* ===================== INICIO ===================== */
  async function iniciar() {
    aplicarTemaCharts();
    ligarEventos();
    await Data.carregar();
    document.getElementById("ultima-atualizacao").textContent =
      "Atualizado em " + new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    removerSkeleton();
    renderTudo();
  }

  /* ===================== EVENTOS ===================== */
  function ligarEventos() {
    document.querySelectorAll(".btn-periodo").forEach(b =>
      b.addEventListener("click", () => {
        estado.periodo = b.dataset.periodo;
        marcarAtivo(".btn-periodo", b);
        document.getElementById("custom-range").classList.toggle("oculto", estado.periodo !== "custom");
        if (estado.periodo !== "custom") { estado.pagina = 1; renderTudo(); }
      }));

    document.querySelectorAll(".btn-cat").forEach(b =>
      b.addEventListener("click", () => {
        estado.categoria = b.dataset.cat;
        marcarAtivo(".btn-cat", b);
        renderTudo();
      }));

    document.getElementById("btn-aplicar-custom").addEventListener("click", () => {
      const i = document.getElementById("data-ini").value;
      const f = document.getElementById("data-fim").value;
      if (i && f) { estado.custom = { ini: i, fim: f }; estado.pagina = 1; renderTudo(); }
    });

    document.getElementById("busca").addEventListener("input", (e) => {
      estado.busca = e.target.value.toLowerCase(); estado.pagina = 1; renderTabela();
    });

    document.querySelectorAll("th[data-col]").forEach(th =>
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        if (estado.ordem.col === col) estado.ordem.asc = !estado.ordem.asc;
        else estado.ordem = { col, asc: true };
        renderTabela();
      }));

    document.getElementById("btn-csv").addEventListener("click", exportarCSV);
    document.getElementById("btn-xlsx").addEventListener("click", exportarXLSX);
    document.getElementById("btn-sair").addEventListener("click", Auth.encerrarSessao);
  }

  function marcarAtivo(seletor, btn) {
    document.querySelectorAll(seletor).forEach(b => b.classList.remove("ativo"));
    btn.classList.add("ativo");
  }

  /* ===================== RENDER GERAL ===================== */
  function renderTudo() {
    _filtrados = Data.filtrarPeriodo(Data.registros(), estado.periodo, estado.custom);
    estado.visao = derivarVisao(estado.periodo, _filtrados);
    atualizarLabelPeriodo();
    renderKPIs();
    renderGraficos();
    renderTabela();
  }

  function derivarVisao(periodo, regs) {
    if (periodo === "semana") return "diario";
    if (periodo === "mes")    return "semanal";
    // custom: por amplitude
    if (!regs.length) return "diario";
    if (regs.length <= 14) return "diario";
    if (regs.length <= 90) return "semanal";
    return "mensal";
  }

  function atualizarLabelPeriodo() {
    const map = { semana: "Semana atual", mes: "Mês atual", custom: "Período personalizado" };
    let txt = map[estado.periodo] || "";
    if (_filtrados.length) {
      const a = _filtrados[0].data, b = _filtrados[_filtrados.length - 1].data;
      txt += `  ·  ${Data.fmtDiaLongo(a)} a ${Data.fmtDiaLongo(b)}`;
    } else {
      txt += "  ·  sem registros neste período";
    }
    document.getElementById("periodo-label").textContent = txt;
  }

  /* ---------- seletores de metrica por categoria ---------- */
  function totalAt(r)  { return estado.categoria === "sf" ? r.atSF : estado.categoria === "ext" ? r.atExt : r.atTotal; }
  function totalInt(r) { return estado.categoria === "sf" ? r.intSF : estado.categoria === "ext" ? r.intExt : r.intTotal; }

  /* ===================== KPIs ===================== */
  function renderKPIs() {
    const f = _filtrados;
    const soma = f.reduce((a, r) => {
      a.atSF += r.atSF; a.atExt += r.atExt; a.intSF += r.intSF; a.intExt += r.intExt; return a;
    }, { atSF: 0, atExt: 0, intSF: 0, intExt: 0 });
    const agg = Data.enriquecer(soma);

    const totAt  = estado.categoria === "sf" ? agg.atSF  : estado.categoria === "ext" ? agg.atExt  : agg.atTotal;
    const totInt = estado.categoria === "sf" ? agg.intSF : estado.categoria === "ext" ? agg.intExt : agg.intTotal;

    // media diaria considerando APENAS dias preenchidos (com algum movimento)
    const diasPreenchidos = f.filter(r => (r.atSF + r.atExt + r.intSF + r.intExt) > 0).length || 1;
    const medSF  = Math.round(soma.atSF  / diasPreenchidos);
    const medExt = Math.round(soma.atExt / diasPreenchidos);
    const medTot = estado.categoria === "sf" ? medSF : estado.categoria === "ext" ? medExt : medSF + medExt;
    const subMedia = estado.categoria === "ambos" ? `SF ${fmtInt(medSF)} · Ext ${fmtInt(medExt)}`
                   : estado.categoria === "sf" ? "SF" : "Externos";

    // variacao no periodo (atual x periodo anterior equivalente)
    const ant = intervaloAnterior();
    const antAt  = ant ? somaNoIntervalo(ant.ini, ant.fim, "at")  : 0;
    const antInt = ant ? somaNoIntervalo(ant.ini, ant.fim, "int") : 0;
    const varAt  = variacao(totAt, antAt);
    const varInt = variacao(totInt, antInt);

    const cards = [
      kpi("Atendimentos", totAt, "", subBreak(agg.atSF, agg.atExt)),
      kpi("Internações", totInt, "", subBreak(agg.intSF, agg.intExt)),
      kpiCor("Conversão SF", agg.convSF, avaliarConvSF(agg.convSF)),
      kpiCor("Conversão Ext", agg.convExt, avaliarConvExt(agg.convExt)),
      kpi("Média Diária", medTot, "", subMedia),
      kpiVar("Variação de Atendimentos", varAt, "no período vs. anterior"),
      kpiVar("Variação de Internações", varInt, "no período vs. anterior")
    ];
    document.getElementById("kpis").innerHTML = cards.join("");
    document.querySelectorAll(".kpi-num[data-alvo]").forEach(animarNumero);
  }

  /* faixas de cor da conversao */
  function avaliarConvSF(v) {
    if (v < 2)  return { cor: "#2E8C66", rotulo: "dentro da meta (< 2%)" };
    if (v <= 4) return { cor: "#D4920F", rotulo: "atenção (2–4%)" };
    return { cor: "#C03540", rotulo: "acima do limite (> 4%)" };
  }
  function avaliarConvExt(v) {
    if (v < 4)  return { cor: "#C03540", rotulo: "crítico (< 4%)" };
    if (v < 6)  return { cor: "#D4920F", rotulo: "regular (4–6%)" };
    if (v <= 8) return { cor: "#2E8C66", rotulo: "bom (6–8%)" };
    return { cor: "#2D78B4", rotulo: "ótimo (> 8%)" };
  }

  const fmtInt = (n) => Math.round(n).toLocaleString("pt-BR");
  const subBreak = (sf, ext) =>
    estado.categoria === "ambos" ? `SF ${fmtInt(sf)} · Ext ${fmtInt(ext)}`
    : estado.categoria === "sf" ? "SF" : "Externos";

  function kpi(titulo, valor, sufixo, sub, _) {
    return `<article class="kpi">
      <span class="kpi-titulo">${titulo}</span>
      <span class="kpi-num" data-alvo="${valor}" data-sufixo="${sufixo}">0</span>
      <span class="kpi-sub">${sub}</span></article>`;
  }

  function kpiCor(titulo, valor, av) {
    return `<article class="kpi">
      <span class="kpi-titulo">${titulo}</span>
      <span class="kpi-num" style="color:${av.cor}" data-alvo="${valor}" data-sufixo="%" data-dec="1">0</span>
      <span class="kpi-sub"><span class="pill" style="color:${av.cor};background:${av.cor}1f">${av.rotulo}</span></span></article>`;
  }

  function kpiVar(titulo, v, sub) {
    const up = v >= 0;
    const cls = up ? "ok" : "alerta";
    const seta = up ? "▲" : "▼";
    return `<article class="kpi">
      <span class="kpi-titulo">${titulo}</span>
      <span class="kpi-num ${cls}">${seta} ${Math.abs(v).toFixed(1)}%</span>
      <span class="kpi-sub">${sub}</span></article>`;
  }

  /* intervalo do periodo anterior equivalente ao filtro atual */
  function intervaloSemana(offset) {
    const ini = Data.inicioSemana(new Date());
    ini.setDate(ini.getDate() + offset * 7);
    const fim = new Date(ini); fim.setDate(fim.getDate() + 6); fim.setHours(23, 59, 59, 999);
    return { ini, fim };
  }
  function intervaloMes(offset) {
    const h = new Date();
    const ini = new Date(h.getFullYear(), h.getMonth() + offset, 1);
    const fim = new Date(h.getFullYear(), h.getMonth() + offset + 1, 0, 23, 59, 59, 999);
    return { ini, fim };
  }
  function intervaloAnterior() {
    if (estado.periodo === "semana") return intervaloSemana(-1);
    if (estado.periodo === "mes")    return intervaloMes(-1);
    // custom/outros: desloca pelo mesmo numero de dias do periodo selecionado
    if (_filtrados.length) {
      const ini = _filtrados[0].data, fim = _filtrados[_filtrados.length - 1].data;
      const dias = Math.round((fim - ini) / 86400000) + 1;
      const pIni = new Date(ini); pIni.setDate(pIni.getDate() - dias);
      const pFim = new Date(ini); pFim.setDate(pFim.getDate() - 1); pFim.setHours(23, 59, 59, 999);
      return { ini: pIni, fim: pFim };
    }
    return null;
  }
  function somaNoIntervalo(ini, fim, tipo) {
    return Data.registros()
      .filter(r => r.data >= ini && r.data <= fim)
      .reduce((s, r) => s + (tipo === "at" ? totalAt(r) : totalInt(r)), 0);
  }
  function variacao(atual, anterior) {
    if (!anterior) return atual ? 100 : 0;
    return (atual - anterior) / anterior * 100;
  }

  function animarNumero(el) {
    const alvo = parseFloat(el.dataset.alvo) || 0;
    const dec = parseInt(el.dataset.dec || "0", 10);
    const suf = el.dataset.sufixo || "";
    const dur = 900; const t0 = performance.now();
    function passo(t) {
      const p = Math.min((t - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const val = alvo * e;
      el.textContent = (dec ? val.toFixed(dec) : Math.round(val).toLocaleString("pt-BR")) + suf;
      if (p < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  }

  /* ===================== GRAFICOS ===================== */
  let _pluginRegistrado = false;
  function aplicarTemaCharts() {
    if (!window.Chart) return;
    if (!_pluginRegistrado) {
      Chart.register({
        id: "bandas",
        beforeDatasetsDraw(chart) {
          const cfg = chart.options.plugins && chart.options.plugins.bandas;
          if (!cfg || !cfg.faixas) return;
          const y = chart.scales.y; if (!y) return;
          const { ctx, chartArea } = chart;
          ctx.save();
          cfg.faixas.forEach(b => {
            const yTopo = y.getPixelForValue(Math.min(b.ate, y.max));
            const yBase = y.getPixelForValue(Math.max(b.de, y.min));
            ctx.fillStyle = b.cor;
            ctx.fillRect(chartArea.left, yTopo, chartArea.right - chartArea.left, yBase - yTopo);
          });
          ctx.restore();
        }
      });
      _pluginRegistrado = true;
    }
    Chart.defaults.color = "rgba(6,47,58,0.7)";
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(255,255,255,0.98)";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(6,47,58,0.16)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.titleColor = "#062F3A";
    Chart.defaults.plugins.tooltip.bodyColor = "#062F3A";
  }

  const grid = { color: "rgba(6,47,58,0.07)" };
  const COR_SF = "#B58B4C", COR_EXT = "#2A7A8C", COR_INT_SF = "#D7B377", COR_INT_EXT = "#4C9AB0";

  function destruir(id) { if (graficos[id]) { graficos[id].destroy(); delete graficos[id]; } }

  function mostraSF()  { return estado.categoria !== "ext"; }
  function mostraExt() { return estado.categoria !== "sf"; }

  function renderGraficos() {
    const ag = Data.agregar(_filtrados, estado.visao === "total" ? "diario" : estado.visao);
    const labels = ag.map(g => g.label);

    /* 1. Evolucao de atendimentos (linha) */
    const ds1 = [];
    if (mostraSF())  ds1.push(linha("Atendimentos SF", ag.map(g => g.atSF), COR_SF, true));
    if (mostraExt()) ds1.push(linha("Atendimentos Externos", ag.map(g => g.atExt), COR_EXT, true));
    criar("g-evolucao", "line", labels, ds1);

    /* 2. Internacoes por periodo (barras agrupadas) */
    const ds2 = [];
    if (mostraSF())  ds2.push(barra("Internações SF", ag.map(g => g.intSF), COR_INT_SF));
    if (mostraExt()) ds2.push(barra("Internações Externos", ag.map(g => g.intExt), COR_INT_EXT));
    criar("g-internacoes", "bar", labels, ds2);

    /* 3. Taxa de conversao + faixas de cor */
    const ds3 = [];
    if (mostraSF())  ds3.push(linha("Conversão SF", ag.map(g => g.convSF), "#062F3A", false));
    if (mostraExt()) ds3.push(linha("Conversão Ext", ag.map(g => g.convExt), "#062F3A", false));
    // faixas coloridas conforme a origem selecionada (cada canal tem regras diferentes)
    let faixas = null, ymax;
    if (estado.categoria === "sf") {
      faixas = [
        { de: 0, ate: 2,   cor: "rgba(46,140,102,.16)" },   // verde
        { de: 2, ate: 4,   cor: "rgba(212,146,15,.16)"  },   // laranja
        { de: 4, ate: 999, cor: "rgba(192,53,64,.14)"   }    // vermelho
      ];
      ymax = 6;
    } else if (estado.categoria === "ext") {
      faixas = [
        { de: 0, ate: 4,   cor: "rgba(192,53,64,.14)"   },   // vermelho
        { de: 4, ate: 6,   cor: "rgba(232,196,40,.20)"  },   // amarelo
        { de: 6, ate: 8,   cor: "rgba(46,140,102,.16)"  },   // verde
        { de: 8, ate: 999, cor: "rgba(45,120,180,.15)"  }    // azul
      ];
      ymax = 14;
    }
    criar("g-conversao", "line", labels, ds3,
      { y: { ticks: { callback: v => v + "%" }, suggestedMax: ymax } },
      faixas ? { plugins: { bandas: { faixas } } } : null);

    /* 4. Distribuicao SF x Externos (donut com %) */
    const tSF = _filtrados.reduce((s, r) => s + r.atSF, 0);
    const tEX = _filtrados.reduce((s, r) => s + r.atExt, 0);
    const totalDist = (tSF + tEX) || 1;
    destruir("g-distribuicao");
    graficos["g-distribuicao"] = new Chart(ctx("g-distribuicao"), {
      type: "doughnut",
      data: { labels: ["SF", "Externos"],
        datasets: [{ data: [tSF, tEX], backgroundColor: [COR_SF, COR_EXT],
          borderColor: C.fundo, borderWidth: 3, hoverOffset: 8 }] },
      options: {
        cutout: "62%", responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (it) =>
            ` ${it.label}: ${fmtInt(it.parsed)} (${Math.round(it.parsed / totalDist * 100)}%)` } }
        }
      },
      plugins: [{
        id: "pctDonut",
        afterDraw(chart) {
          const { ctx } = chart;
          const arcs = chart.getDatasetMeta(0).data;
          const dados = chart.data.datasets[0].data;
          ctx.save();
          ctx.font = "700 15px Inter, sans-serif";
          ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          arcs.forEach((arc, i) => {
            const pct = Math.round(dados[i] / totalDist * 100);
            if (pct < 6) return;
            const ang = (arc.startAngle + arc.endAngle) / 2;
            const r = (arc.innerRadius + arc.outerRadius) / 2;
            ctx.fillText(pct + "%", arc.x + Math.cos(ang) * r, arc.y + Math.sin(ang) * r);
          });
          // total no centro
          const c = arcs[0];
          if (c) {
            ctx.fillStyle = "#062F3A"; ctx.font = "800 20px Inter, sans-serif";
            ctx.fillText(fmtInt(totalDist === 1 && tSF + tEX === 0 ? 0 : tSF + tEX), c.x, c.y - 6);
            ctx.fillStyle = "#5A7280"; ctx.font = "600 10px Inter, sans-serif";
            ctx.fillText("ATENDIMENTOS", c.x, c.y + 12);
          }
          ctx.restore();
        }
      }]
    });
  }

  const ctx = (id) => document.getElementById(id).getContext("2d");
  function hexA(hex, a) {
    if (hex.startsWith("rgba")) return hex;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function linha(label, dados, cor, preenche, alpha) {
    return { label, data: dados, borderColor: cor, backgroundColor: hexA(cor, alpha ?? 0.12),
      fill: !!preenche, tension: 0.38, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5,
      pointBackgroundColor: cor };
  }
  function barra(label, dados, cor) {
    return { label, data: dados, backgroundColor: cor, borderRadius: 6, borderSkipped: false,
      maxBarThickness: 34 };
  }

  function criar(id, tipo, labels, datasets, escalasExtra, opcoesExtra) {
    destruir(id);
    const escalas = {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      y: { grid, beginAtZero: true, ...(escalasExtra ? escalasExtra.y : {}) }
    };
    const opts = {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: { duration: 700 },
      plugins: { legend: { display: datasets.length > 1, position: "bottom" } },
      scales: escalas
    };
    if (opcoesExtra) {
      if (opcoesExtra.plugins) opts.plugins = { ...opts.plugins, ...opcoesExtra.plugins };
      for (const k in opcoesExtra) if (k !== "plugins") opts[k] = opcoesExtra[k];
    }
    graficos[id] = new Chart(ctx(id), { type: tipo, data: { labels, datasets }, options: opts });
  }

  /* ===================== TABELA ===================== */
  function dadosTabela() {
    let arr = _filtrados.slice();
    if (estado.busca) arr = arr.filter(r => Data.fmtDiaLongo(r.data).includes(estado.busca));
    const { col, asc } = estado.ordem;
    arr.sort((a, b) => {
      const va = col === "data" ? a.data.getTime() : a[col];
      const vb = col === "data" ? b.data.getTime() : b[col];
      return asc ? va - vb : vb - va;
    });
    return arr;
  }

  function renderTabela() {
    const arr = dadosTabela();
    const ipp = CONFIG.ITENS_POR_PAGINA;
    const totalPag = Math.max(1, Math.ceil(arr.length / ipp));
    estado.pagina = Math.min(estado.pagina, totalPag);
    const ini = (estado.pagina - 1) * ipp;
    const pag = arr.slice(ini, ini + ipp);

    document.getElementById("tabela-corpo").innerHTML = pag.map(r => `
      <tr>
        <td>${Data.fmtDiaLongo(r.data)}</td>
        <td>${fmtInt(r.atSF)}</td>
        <td>${fmtInt(r.atExt)}</td>
        <td>${fmtInt(r.intSF)}</td>
        <td>${fmtInt(r.intExt)}</td>
        <td class="${r.convSF >= CONFIG.META_CONVERSAO_SF ? "td-ok" : "td-alerta"}">${r.convSF.toFixed(1)}%</td>
        <td class="${r.convExt >= CONFIG.META_CONVERSAO_EXT ? "td-ok" : "td-alerta"}">${r.convExt.toFixed(1)}%</td>
      </tr>`).join("") || `<tr><td colspan="7" class="vazio">Nenhum registro no período.</td></tr>`;

    document.getElementById("tabela-info").textContent =
      arr.length ? `${ini + 1}–${Math.min(ini + ipp, arr.length)} de ${arr.length} registros` : "0 registros";

    const pg = document.getElementById("paginacao");
    pg.innerHTML = "";
    const btn = (txt, alvo, dis, ativo) => {
      const b = document.createElement("button");
      b.textContent = txt; b.disabled = dis; if (ativo) b.classList.add("ativo");
      b.addEventListener("click", () => { estado.pagina = alvo; renderTabela(); });
      return b;
    };
    pg.appendChild(btn("‹", estado.pagina - 1, estado.pagina === 1));
    const janela = paginasVisiveis(estado.pagina, totalPag);
    janela.forEach(p => pg.appendChild(btn(p, p, false, p === estado.pagina)));
    pg.appendChild(btn("›", estado.pagina + 1, estado.pagina === totalPag));

    // indicadores de ordenacao
    document.querySelectorAll("th[data-col]").forEach(th => {
      th.classList.remove("ord-asc", "ord-desc");
      if (th.dataset.col === estado.ordem.col) th.classList.add(estado.ordem.asc ? "ord-asc" : "ord-desc");
    });
  }

  function paginasVisiveis(atual, total) {
    const arr = [];
    let ini = Math.max(1, atual - 2), fim = Math.min(total, ini + 4);
    ini = Math.max(1, fim - 4);
    for (let i = ini; i <= fim; i++) arr.push(i);
    return arr;
  }

  /* ===================== EXPORTACAO ===================== */
  function matrizExport() {
    const cab = ["Dia", "Atendimentos SF", "Atendimentos Externos", "Internacoes SF",
      "Internacoes Externos", "Conversao SF (%)", "Conversao Ext (%)"];
    const linhas = dadosTabela().map(r => [
      Data.fmtDiaLongo(r.data), r.atSF, r.atExt, r.intSF, r.intExt,
      r.convSF.toFixed(2), r.convExt.toFixed(2)
    ]);
    return [cab, ...linhas];
  }

  function exportarCSV() {
    const csv = matrizExport().map(l => l.join(";")).join("\n");
    baixar(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }), "HSF_dados.csv");
  }

  function exportarXLSX() {
    if (!window.XLSX) { exportarCSV(); return; }
    const ws = XLSX.utils.aoa_to_sheet(matrizExport());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "HSF");
    XLSX.writeFile(wb, "HSF_dados.xlsx");
  }

  function baixar(blob, nome) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ===================== UI auxiliar ===================== */
  function removerSkeleton() {
    document.querySelectorAll(".skeleton").forEach(s => s.classList.remove("skeleton"));
    document.getElementById("app").classList.add("pronto");
  }

  return { iniciar };
})();

/* ===================== BOOTSTRAP ===================== */
window.addEventListener("DOMContentLoaded", async () => {
  await Auth.iniciar();      // bloqueia ate o login
  Dashboard.iniciar();
});
