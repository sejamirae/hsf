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
    const mediaDia = f.length ? totAt / f.length : 0;

    // melhor / pior dia (por atendimentos da categoria)
    let melhor = null, pior = null;
    for (const r of f) {
      const v = totalAt(r);
      if (!melhor || v > totalAt(melhor)) melhor = r;
      if (!pior   || v < totalAt(pior))   pior = r;
    }

    // crescimento semanal e mensal (base completa, independente do filtro)
    const cw = somaIntervalo(intervaloSemana(0)), pw = somaIntervalo(intervaloSemana(-1));
    const cm = somaIntervalo(intervaloMes(0)),   pm = somaIntervalo(intervaloMes(-1));
    const crescSem = variacao(cw, pw);
    const crescMes = variacao(cm, pm);

    const cards = [
      kpi("Atendimentos", totAt, "", subBreak(agg.atSF, agg.atExt), null),
      kpi("Internações", totInt, "", subBreak(agg.intSF, agg.intExt), null),
      kpiMeta("Conversão SF", agg.convSF, CONFIG.META_CONVERSAO_SF),
      kpiMeta("Conversão Ext", agg.convExt, CONFIG.META_CONVERSAO_EXT),
      kpi("Média Diária", Math.round(mediaDia), "", "atendimentos por dia", null),
      kpi("Melhor Dia", melhor ? totalAt(melhor) : 0, "",
          melhor ? `${Data.fmtDiaLongo(melhor.data)} · pior: ${pior ? totalAt(pior) : 0}` : "—", null),
      kpiVar("Cresc. Semanal", crescSem, "semana atual × anterior"),
      kpiVar("Cresc. Mensal", crescMes, "mês atual × anterior")
    ];
    document.getElementById("kpis").innerHTML = cards.join("");
    document.querySelectorAll(".kpi-num[data-alvo]").forEach(animarNumero);
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

  function kpiMeta(titulo, valor, meta) {
    const ok = valor >= meta;
    const cls = ok ? "ok" : "alerta";
    const seta = ok ? "▲" : "▼";
    return `<article class="kpi">
      <span class="kpi-titulo">${titulo}</span>
      <span class="kpi-num ${cls}" data-alvo="${valor}" data-sufixo="%" data-dec="1">0</span>
      <span class="kpi-sub"><span class="pill ${cls}">${seta} meta ${meta}%</span></span></article>`;
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

  /* intervalos para crescimento (a partir de hoje) */
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
  function somaIntervalo({ ini, fim }) {
    return Data.registros()
      .filter(r => r.data >= ini && r.data <= fim)
      .reduce((s, r) => s + totalAt(r), 0);
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
  function aplicarTemaCharts() {
    if (!window.Chart) return;
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

    /* 3. Taxa de conversao + linhas de meta */
    const ds3 = [];
    if (mostraSF()) {
      ds3.push(linha("Conversão SF", ag.map(g => g.convSF), COR_SF, false));
      ds3.push(metaLinha(`Meta SF ${CONFIG.META_CONVERSAO_SF}%`, labels.length, CONFIG.META_CONVERSAO_SF, COR_SF));
    }
    if (mostraExt()) {
      ds3.push(linha("Conversão Ext", ag.map(g => g.convExt), COR_EXT, false));
      ds3.push(metaLinha(`Meta Ext ${CONFIG.META_CONVERSAO_EXT}%`, labels.length, CONFIG.META_CONVERSAO_EXT, COR_EXT));
    }
    criar("g-conversao", "line", labels, ds3, { y: { ticks: { callback: v => v + "%" } } });

    /* 4. Comparativo semanal (semana atual x anterior, por categoria) */
    const sa = Data.agregar(Data.filtrarPeriodo(Data.registros(), "semana"), "diario");
    const semAnt = Data.filtrarPeriodo(Data.registros(), "custom", customSemAnterior());
    const sant = Data.agregar(semAnt, "diario");
    const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const porDow = (arr) => { const m = {}; arr.forEach(g => m[g.data.getDay()] = totalAt(g)); return m; };
    const ma = porDow(sa), mn = porDow(sant);
    const ordem = CONFIG.INICIO_SEMANA === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    criar("g-comparativo", "bar", ordem.map(d => DOW[d]), [
      barra("Semana anterior", ordem.map(d => mn[d] || 0), hexA(COR_EXT, 0.55)),
      barra("Semana atual", ordem.map(d => ma[d] || 0), COR_SF)
    ]);

    /* 5. Distribuicao SF x Externos (donut) */
    const tSF = _filtrados.reduce((s, r) => s + r.atSF, 0);
    const tEX = _filtrados.reduce((s, r) => s + r.atExt, 0);
    destruir("g-distribuicao");
    graficos["g-distribuicao"] = new Chart(ctx("g-distribuicao"), {
      type: "doughnut",
      data: { labels: ["SF", "Externos"],
        datasets: [{ data: [tSF, tEX], backgroundColor: [COR_SF, COR_EXT],
          borderColor: C.fundo, borderWidth: 3, hoverOffset: 8 }] },
      options: { cutout: "64%", plugins: { legend: { position: "bottom" } },
        responsive: true, maintainAspectRatio: false }
    });

    /* 6. Ranking dos melhores periodos (barra horizontal) */
    const rank = [...ag].sort((a, b) => totalAt(b) - totalAt(a)).slice(0, 7).reverse();
    criar("g-ranking", "bar", rank.map(g => g.label),
      [barra("Atendimentos", rank.map(g => totalAt(g)), COR_SF)],
      null, { indexAxis: "y" });

    /* 7. Tendencia acumulada (area) */
    let acc = 0; const cum = ag.map(g => (acc += totalAt(g)));
    criar("g-tendencia", "line", labels,
      [linha("Acumulado", cum, COR_SF, true, 0.28)]);
  }

  function customSemAnterior() {
    const ini = Data.inicioSemana(new Date()); ini.setDate(ini.getDate() - 7);
    const fim = new Date(ini); fim.setDate(fim.getDate() + 6);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { ini: iso(ini), fim: iso(fim) };
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
  function metaLinha(label, n, valor, cor) {
    return { label, data: Array(n).fill(valor), borderColor: hexA(cor, 0.6),
      borderDash: [6, 6], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 };
  }

  function criar(id, tipo, labels, datasets, escalasExtra, opcoesExtra) {
    destruir(id);
    const escalas = {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      y: { grid, beginAtZero: true, ...(escalasExtra ? escalasExtra.y : {}) }
    };
    graficos[id] = new Chart(ctx(id), {
      type: tipo,
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: { duration: 700 },
        plugins: { legend: { display: datasets.length > 1, position: "bottom" } },
        scales: escalas, ...(opcoesExtra || {})
      }
    });
  }

  const ctx = (id) => document.getElementById(id).getContext("2d");
  function hexA(hex, a) {
    if (hex.startsWith("rgba")) return hex;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
