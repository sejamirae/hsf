/* ============================================================
   DASHBOARD.JS  —  Motor de renderizacao do BI
   ------------------------------------------------------------
   Le os dados em memoria (Data), aplica os filtros de periodo,
   visao e categoria, e renderiza KPIs, graficos e tabela.
   Toda filtragem e local: a planilha e lida uma unica vez.
   ============================================================ */

const Dashboard = (() => {

  const C = CONFIG.CORES;
  let FAIXAS = JSON.parse(JSON.stringify(CONFIG.FAIXAS_PADRAO));  // pode ser sobrescrito pela config remota
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
  let _drill = false;    // indica drill-down via clique em grafico

  /* ===================== INICIO ===================== */
  async function iniciar() {
    aplicarTemaCharts();
    ligarEventos();
    await Data.carregar();
    const cfg = Data.config && Data.config();
    if (cfg && cfg.sf && cfg.ext && Array.isArray(cfg.sf.bandas) && Array.isArray(cfg.ext.bandas)) {
      FAIXAS = cfg;
    }
    document.getElementById("ultima-atualizacao").textContent =
      "Atualizado em " + new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    removerSkeleton();
    renderTudo();
  }

  /* ===================== EVENTOS ===================== */
  function ligarEventos() {
    document.querySelectorAll(".btn-periodo").forEach(b =>
      b.addEventListener("click", () => {
        _drill = false;
        estado.periodo = b.dataset.periodo;
        marcarAtivo(".btn-periodo", b);
        document.getElementById("custom-range").classList.toggle("oculto", estado.periodo !== "custom");
        if (estado.periodo === "custom") {
          document.getElementById("periodo-label").textContent =
            "Selecione as datas e clique em Aplicar";
        } else {
          estado.pagina = 1; renderTudo();
        }
      }));

    document.getElementById("btn-config").addEventListener("click", abrirConfig);
    document.getElementById("cfg-fechar").addEventListener("click", fecharConfig);
    document.getElementById("cfg-cancelar").addEventListener("click", fecharConfig);
    document.getElementById("cfg-salvar").addEventListener("click", salvarConfigModal);
    document.getElementById("btn-voltar").addEventListener("click", () => voltarParaPeriodo(CONFIG.PERIODO_INICIAL));

    document.querySelectorAll(".btn-cat").forEach(b =>
      b.addEventListener("click", () => aplicarCategoria(b.dataset.cat)));

    document.getElementById("btn-aplicar-custom").addEventListener("click", () => {
      const i = document.getElementById("data-ini").value;
      const f = document.getElementById("data-fim").value;
      if (i && f) { estado.custom = { ini: i, fim: f }; estado.pagina = 1; renderTudo(); }
    });
    document.getElementById("btn-limpar-custom").addEventListener("click", () => {
      document.getElementById("data-ini").value = "";
      document.getElementById("data-fim").value = "";
      estado.custom = { ini: null, fim: null };
      voltarParaPeriodo("semana");
    });

    document.getElementById("busca").addEventListener("change", (e) => {
      estado.busca = e.target.value; estado.pagina = 1; renderTabela();
    });
    document.getElementById("btn-limpar-busca").addEventListener("click", () => {
      document.getElementById("busca").value = ""; estado.busca = ""; estado.pagina = 1; renderTabela();
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

  /* ---------- interatividade entre graficos ---------- */
  function aplicarCategoria(cat) {
    estado.categoria = cat;
    document.querySelectorAll(".btn-cat").forEach(b => b.classList.toggle("ativo", b.dataset.cat === cat));
    renderTudo();
  }
  function voltarParaPeriodo(p) {
    _drill = false;
    estado.periodo = p;
    document.querySelectorAll(".btn-periodo").forEach(b => b.classList.toggle("ativo", b.dataset.periodo === p));
    document.getElementById("custom-range").classList.toggle("oculto", p !== "custom");
    estado.pagina = 1; renderTudo();
  }
  function drillTempo(els, ag) {
    if (!els.length) return;
    const g = ag[els[0].index]; if (!g) return;
    let ini, fim;
    if (estado.visao === "diario") { ini = new Date(g.data); fim = new Date(g.data); }
    else if (estado.visao === "mensal") {
      ini = new Date(g.data.getFullYear(), g.data.getMonth(), 1);
      fim = new Date(g.data.getFullYear(), g.data.getMonth() + 1, 0);
    } else {
      ini = Data.inicioSemana(g.data); fim = new Date(ini); fim.setDate(fim.getDate() + 6);
    }
    estado.custom = { ini: localISO(ini), fim: localISO(fim) };
    estado.periodo = "custom"; _drill = true;
    document.querySelectorAll(".btn-periodo").forEach(b => b.classList.remove("ativo"));
    document.getElementById("custom-range").classList.add("oculto");
    estado.pagina = 1; renderTudo();
  }
  const aoPassar = (e, els) => { if (e.native) e.native.target.style.cursor = els.length ? "pointer" : "default"; };

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
    let txt = (_drill ? "Detalhe do período" : (map[estado.periodo] || ""));
    if (_filtrados.length) {
      const a = _filtrados[0].data, b = _filtrados[_filtrados.length - 1].data;
      txt += `  ·  ${Data.fmtDiaLongo(a)} a ${Data.fmtDiaLongo(b)}`;
    } else {
      txt += "  ·  sem registros neste período";
    }
    document.getElementById("periodo-label").textContent = txt;
    document.getElementById("btn-voltar").classList.toggle("oculto", !_drill);
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
      kpiCor("Conversão SF", agg.convSF, avaliar(agg.convSF, "sf")),
      kpiCor("Conversão Ext", agg.convExt, avaliar(agg.convExt, "ext")),
      kpi("Média Diária", medTot, "", subMedia),
      kpiVar("Variação de Atendimentos", varAt, "no período vs. anterior"),
      kpiVar("Variação de Internações", varInt, "no período vs. anterior")
    ];
    document.getElementById("kpis").innerHTML = cards.join("");
    document.querySelectorAll(".kpi-num[data-alvo]").forEach(animarNumero);
  }

  /* avaliacao da conversao conforme as faixas configuradas */
  function avaliar(v, g) {
    const bandas = FAIXAS[g].bandas;
    for (const b of bandas) if (v < b.ate) return { cor: b.cor, rotulo: b.rotulo };
    const ult = bandas[bandas.length - 1];
    return { cor: ult.cor, rotulo: ult.rotulo };
  }
  function faixasGrafico(g) {
    let de = 0; const out = [];
    FAIXAS[g].bandas.forEach(b => { out.push({ de, ate: b.ate, cor: hexA(b.cor, 0.16) }); de = b.ate; });
    return out;
  }
  function ymaxGrafico(g) {
    const bandas = FAIXAS[g].bandas; let m = 0;
    for (let i = 0; i < bandas.length - 1; i++) m = Math.max(m, bandas[i].ate);
    return Math.max(6, Math.ceil(m * 1.5));
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
    criar("g-evolucao", "line", labels, ds1, null,
      { onClick: (e, els) => drillTempo(els, ag), onHover: aoPassar });

    /* 2. Internacoes por periodo (barras agrupadas) */
    const ds2 = [];
    if (mostraSF())  ds2.push(barra("Internações SF", ag.map(g => g.intSF), COR_INT_SF));
    if (mostraExt()) ds2.push(barra("Internações Externos", ag.map(g => g.intExt), COR_INT_EXT));
    criar("g-internacoes", "bar", labels, ds2, null,
      { onClick: (e, els) => drillTempo(els, ag), onHover: aoPassar });

    /* 3. Taxa de conversao + faixas de cor */
    const ds3 = [];
    if (mostraSF())  ds3.push(linha("Conversão SF", ag.map(g => g.convSF), COR_SF, false));
    if (mostraExt()) ds3.push(linha("Conversão Ext", ag.map(g => g.convExt), COR_EXT, false));
    let faixas = null, ymax;
    if (estado.categoria === "sf")  { faixas = faixasGrafico("sf");  ymax = ymaxGrafico("sf"); }
    else if (estado.categoria === "ext") { faixas = faixasGrafico("ext"); ymax = ymaxGrafico("ext"); }
    else { faixas = null; ymax = Math.max(ymaxGrafico("sf"), ymaxGrafico("ext")); }
    criarConversao(labels, ds3, faixas, ymax);

    /* 4. Distribuicao — reage a Origem selecionada */
    let dLabels, dData, dCores, dTitulo, dCentro;
    const tSF = _filtrados.reduce((s, r) => s + r.atSF, 0);
    const tEX = _filtrados.reduce((s, r) => s + r.atExt, 0);
    if (estado.categoria === "ambos") {
      dLabels = ["SF", "Externos"]; dData = [tSF, tEX]; dCores = [COR_SF, COR_EXT];
      dTitulo = "Distribuição de Atendimentos · SF × Externos"; dCentro = tSF + tEX;
    } else {
      const at  = estado.categoria === "sf" ? tSF : tEX;
      const int = _filtrados.reduce((s, r) => s + (estado.categoria === "sf" ? r.intSF : r.intExt), 0);
      dLabels = ["Internações", "Sem internação"];
      dData = [int, Math.max(at - int, 0)];
      dCores = [COR_SF, hexA(COR_EXT, 0.45)];
      dTitulo = (estado.categoria === "sf" ? "SF" : "Externos") + " · Internações × Atendimentos";
      dCentro = at;
    }
    document.getElementById("titulo-distribuicao").textContent = dTitulo;
    const totalDist = dData.reduce((a, b) => a + b, 0) || 1;
    destruir("g-distribuicao");
    graficos["g-distribuicao"] = new Chart(ctx("g-distribuicao"), {
      type: "doughnut",
      data: { labels: dLabels,
        datasets: [{ data: dData, backgroundColor: dCores,
          borderColor: C.fundo, borderWidth: 3, hoverOffset: 8 }] },
      options: {
        cutout: "62%", responsive: true, maintainAspectRatio: false,
        onClick: (e, els) => {
          if (!els.length) return;
          if (estado.categoria === "ambos") aplicarCategoria(els[0].index === 0 ? "sf" : "ext");
          else aplicarCategoria("ambos");
        },
        onHover: aoPassar,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (it) =>
            ` ${it.label}: ${fmtInt(it.parsed)} (${Math.round(it.parsed / totalDist * 100)}%)` } }
        }
      },
      plugins: [{
        id: "pctDonut",
        afterDraw(chart) {
          const cx = chart.ctx;
          const arcs = chart.getDatasetMeta(0).data;
          const dados = chart.data.datasets[0].data;
          cx.save();
          cx.font = "700 14px Inter, sans-serif"; cx.fillStyle = "#FFFFFF";
          cx.textAlign = "center"; cx.textBaseline = "middle";
          arcs.forEach((arc, i) => {
            const pct = Math.round(dados[i] / totalDist * 100);
            if (pct < 7) return;
            const ang = (arc.startAngle + arc.endAngle) / 2;
            const r = (arc.innerRadius + arc.outerRadius) / 2;
            cx.fillText(pct + "%", arc.x + Math.cos(ang) * r, arc.y + Math.sin(ang) * r);
          });
          const c = arcs[0];
          if (c) {
            cx.fillStyle = "#062F3A"; cx.font = "800 20px Inter, sans-serif";
            cx.fillText(fmtInt(dCentro), c.x, c.y - 6);
            cx.fillStyle = "#5A7280"; cx.font = "600 10px Inter, sans-serif";
            cx.fillText("ATENDIMENTOS", c.x, c.y + 12);
          }
          cx.restore();
        }
      }]
    });
  }

  /* grafico de conversao com legenda clicavel que liga/desliga faixas */
  function criarConversao(labels, datasets, faixas, ymax) {
    destruir("g-conversao");
    graficos["g-conversao"] = new Chart(ctx("g-conversao"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: { duration: 700 },
        plugins: {
          legend: {
            display: datasets.length > 1, position: "bottom",
            onClick(e, item, legend) {
              const ci = legend.chart;
              ci.setDatasetVisibility(item.datasetIndex, !ci.isDatasetVisible(item.datasetIndex));
              atualizarBandasConv(ci);
              ci.update();
            }
          },
          bandas: { faixas }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: { grid, beginAtZero: true, suggestedMax: ymax, ticks: { callback: v => v + "%" } }
        }
      }
    });
  }

  function atualizarBandasConv(ci) {
    const vis = ci.data.datasets
      .map((d, i) => ({ label: d.label, vis: ci.isDatasetVisible(i) }))
      .filter(v => v.vis);
    let faixas = null, ymax = Math.max(ymaxGrafico("sf"), ymaxGrafico("ext"));
    if (vis.length === 1) {
      const g = /sf/i.test(vis[0].label) ? "sf" : "ext";
      faixas = faixasGrafico(g); ymax = ymaxGrafico(g);
    }
    ci.options.plugins.bandas = { faixas };
    ci.options.scales.y.suggestedMax = ymax;
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
  const localISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function dadosTabela() {
    let arr = _filtrados.slice();
    if (estado.busca) arr = arr.filter(r => localISO(r.data) === estado.busca);
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
        <td style="color:${avaliar(r.convSF, "sf").cor};font-weight:700">${r.convSF.toFixed(1)}%</td>
        <td style="color:${avaliar(r.convExt, "ext").cor};font-weight:700">${r.convExt.toFixed(1)}%</td>
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

  /* ===================== CONFIGURACOES (faixas) ===================== */
  function abrirConfig() {
    document.getElementById("cfg-corpo").innerHTML =
      grupoConfigHTML("sf", "Conversão SF") + grupoConfigHTML("ext", "Conversão Externa");
    document.getElementById("cfg-status").textContent = "";
    ligarEventosConfig();
    document.getElementById("tela-config").classList.remove("oculto");
  }
  function fecharConfig() { document.getElementById("tela-config").classList.add("oculto"); }

  function grupoConfigHTML(g, titulo) {
    const bandas = FAIXAS[g].bandas;
    const rows = bandas.map((b, i) => linhaConfigHTML(b, i === bandas.length - 1)).join("");
    return `<div class="cfg-grupo" data-grupo="${g}">
      <h4>${titulo} <span>(quanto ${g === "sf" ? "menor" : "maior"}, melhor)</span></h4>
      <div class="cfg-linhas">${rows}</div>
      <button type="button" class="cfg-add" data-grupo="${g}">+ Adicionar faixa</button>
    </div>`;
  }
  function linhaConfigHTML(b, ultimo) {
    return `<div class="cfg-linha">
      <input class="cfg-cor" type="color" value="${b.cor}" title="Cor da faixa">
      <input class="cfg-rotulo" type="text" value="${b.rotulo}" placeholder="nome do aviso">
      <span class="cfg-ate-lbl">abaixo de</span>
      <input class="cfg-ate" type="number" step="0.1" min="0" value="${ultimo ? "" : b.ate}"
        ${ultimo ? 'placeholder="∞" disabled' : ""}>
      <span class="cfg-pct">%</span>
      <button type="button" class="cfg-rem" ${ultimo ? 'disabled title="faixa final (fixa)"' : ""}>✕</button>
    </div>`;
  }
  function ligarEventosConfig() {
    document.querySelectorAll(".cfg-add").forEach(btn => btn.onclick = () => {
      const linhas = btn.parentElement.querySelector(".cfg-linhas");
      const nova = document.createElement("div");
      nova.className = "cfg-linha";
      nova.innerHTML = linhaConfigHTML({ cor: "#D4920F", rotulo: "nova faixa", ate: 1 }, false);
      linhas.insertBefore(nova, linhas.lastElementChild);   // antes da faixa final
      ligarRemocao();
    });
    ligarRemocao();
  }
  function ligarRemocao() {
    document.querySelectorAll(".cfg-rem").forEach(b => b.onclick = () => {
      if (!b.disabled) b.closest(".cfg-linha").remove();
    });
  }
  function lerConfigModal() {
    const novo = {};
    document.querySelectorAll(".cfg-grupo").forEach(gd => {
      const g = gd.dataset.grupo;
      const linhas = [...gd.querySelectorAll(".cfg-linha")].map(l => ({
        cor: l.querySelector(".cfg-cor").value,
        rotulo: (l.querySelector(".cfg-rotulo").value || "—").trim(),
        ate: parseFloat(l.querySelector(".cfg-ate").value)
      }));
      const comLim = linhas.filter(b => !isNaN(b.ate)).sort((a, b) => a.ate - b.ate);
      const catchAll = linhas.find(b => isNaN(b.ate)) || { cor: "#C03540", rotulo: "acima" };
      catchAll.ate = 9999;
      novo[g] = { titulo: FAIXAS[g].titulo, bandas: [...comLim, catchAll] };
    });
    return novo;
  }
  async function salvarConfigModal() {
    const novo = lerConfigModal();
    if (!novo.sf || !novo.ext) return;
    FAIXAS = novo;
    const status = document.getElementById("cfg-status");
    if (CONFIG.API_URL) {
      status.textContent = "Salvando para todos...";
      try { await Data.salvarConfig(novo); status.textContent = "✓ Salvo para todos"; }
      catch (e) { status.textContent = "Salvo nesta sessão (não sincronizou com a API)"; }
    } else {
      status.textContent = "Salvo nesta sessão (sem API configurada)";
    }
    renderTudo();
    setTimeout(fecharConfig, 900);
  }

  return { iniciar };
})();

/* ===================== BOOTSTRAP ===================== */
window.addEventListener("DOMContentLoaded", async () => {
  await Auth.iniciar();      // bloqueia ate o login
  Dashboard.iniciar();
  iniciarSidebar();
});

/* ===================== SIDEBAR + NAVEGAÇÃO ===================== */
const TITULOS_ABA = {
  painel: "KPI Conversão de Internações",
  nps:    "CX NPS · Hospital São Francisco Cotia"
};

function iniciarSidebar() {
  // toggle recolher/expandir
  const sidebar = document.getElementById("sidebar");
  const toggle  = document.getElementById("sb-toggle");
  toggle.addEventListener("click", () => {
    const colapsado = sidebar.classList.toggle("colapsado");
    toggle.title = colapsado ? "Expandir menu" : "Recolher menu";
  });

  // navegação entre abas
  document.querySelectorAll(".sb-item[data-aba]").forEach(btn =>
    btn.addEventListener("click", () => {
      const aba = btn.dataset.aba;

      // atualiza item ativo na sidebar
      document.querySelectorAll(".sb-item[data-aba]").forEach(b => b.classList.remove("ativo"));
      btn.classList.add("ativo");

      // mostra/oculta abas
      document.getElementById("aba-painel").classList.toggle("oculto", aba !== "painel");
      document.getElementById("aba-nps").classList.toggle("oculto", aba !== "nps");

      // atualiza título no topbar
      document.getElementById("topbar-titulo").textContent = TITULOS_ABA[aba] || "";

      // "Metas de Conversão" só faz sentido na aba KPI
      document.getElementById("btn-config").classList.toggle("oculto", aba !== "painel");

      // inicia NPS na primeira vez
      if (aba === "nps") NPS.iniciar();
    }));
}
