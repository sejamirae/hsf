/* ============================================================
   NPS.JS  —  Módulo de análise NPS · HSF
   Consome action=nps da API (planilha separada via openById)
   ============================================================ */

const NPS = (() => {

  let _todos     = [];
  let _filtrados = [];
  let _periodo   = 'mes';
  let _custom    = { ini: null, fim: null };
  let _soComent  = false;
  let _pagina    = 1;
  let _iniciado  = false;
  let _pIni      = null;   // inicio do periodo (para o rotulo)
  let _pFim      = null;   // fim do periodo, limitado a hoje
  const _graficos = {};
  const IPP = 10;

  const COR_PROM = '#2E8C66';
  const COR_PASS = '#D4920F';
  const COR_DET  = '#C03540';
  const MESES    = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  /* ---- carregamento ---- */
  async function carregar() {
    if (!CONFIG.API_URL) { _todos = gerarDemo(); return; }
    try {
      let url = CONFIG.API_URL
        + (CONFIG.API_URL.includes('?') ? '&' : '?')
        + 'action=nps';
      if (CONFIG.API_TOKEN) url += '&token=' + encodeURIComponent(CONFIG.API_TOKEN);

      let json;
      if (CONFIG.API_JSONP) {
        json = await lerJSONP(url);
      } else {
        const resp = await fetch(url);
        json = await resp.json();
      }
      if (!json || !json.ok) throw new Error(json?.erro || 'falha na API NPS');
      _todos = (json.registros || []).map(normalizar).filter(Boolean)
               .sort((a, b) => a.data - b.data);
    } catch (e) {
      console.warn('NPS: falha na API, usando demo.', e.message);
      _todos = gerarDemo();
    }
  }

  function lerJSONP(url) {
    return new Promise((resolve, reject) => {
      const cb = '__nps_cb_' + Date.now();
      const s = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('NPS JSONP timeout')); }, 15000);
      window[cb] = data => { clearTimeout(timer); cleanup(); resolve(data); };
      s.onerror   = () => { clearTimeout(timer); cleanup(); reject(new Error('NPS JSONP erro')); };
      s.src = url + '&callback=' + cb;
      document.body.appendChild(s);
      function cleanup() { try { delete window[cb]; } catch (_) {} s.remove(); }
    });
  }

  function normalizar(r) {
    const d = new Date(r.data + 'T00:00:00');
    if (isNaN(d)) return null;
    return {
      data:       d,
      nps:        Math.min(10, Math.max(0, +r.nps || 0)),
      medico:     Math.min(5,  Math.max(0, +r.medico || 0)),
      enfermagem: Math.min(5,  Math.max(0, +r.enfermagem || 0)),
      infra:      Math.min(5,  Math.max(0, +r.infra || 0)),
      comentario: String(r.comentario || '').trim(),
      token:      r.token
    };
  }

  function gerarDemo() {
    const regs = [];
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const rand = (a, b) => a + Math.random() * (b - a);
    const comentarios = [
      'Atendimento excelente, equipe muito atenciosa.',
      'Espera um pouco longa, mas médico foi ótimo.',
      'Infraestrutura precisa melhorar.',
      'Muito satisfeito com o atendimento!',
      '','',' ',''
    ];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(hoje.getDate() - i);
      const n = Math.floor(rand(0, 4));
      for (let j = 0; j < n; j++) {
        const nps = Math.floor(rand(0, 11));
        regs.push({
          data: d,
          nps,
          medico:     Math.round(rand(2, 5)),
          enfermagem: Math.round(rand(2, 5)),
          infra:      Math.round(rand(2, 5)),
          comentario: comentarios[Math.floor(Math.random() * comentarios.length)],
          token: 'demo_' + i + '_' + j
        });
      }
    }
    return regs;
  }

  /* ---- filtragem por período ---- */
  function filtrar() {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    let ini, fim;
    switch (_periodo) {
      case 'semana':
        ini = inicioSemana(hoje);
        fim = new Date(ini); fim.setDate(fim.getDate() + 6);
        break;
      case 'mes':
        ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
        break;
      case 'custom':
        if (_custom.ini && _custom.fim) {
          ini = new Date(_custom.ini + 'T00:00:00');
          fim = new Date(_custom.fim + 'T00:00:00');
        }
        break;
    }
    if (!ini) { _filtrados = _todos.slice(); _pIni = null; _pFim = null; return; }
    fim.setHours(23, 59, 59, 999);
    // limites do periodo para o rotulo (fim limitado a hoje, como no KPI)
    const hojeFim = new Date(hoje); hojeFim.setHours(23, 59, 59, 999);
    _pIni = new Date(ini);
    _pFim = fim > hojeFim ? hojeFim : new Date(fim);
    _filtrados = _todos.filter(r => r.data >= ini && r.data <= fim);
  }

  function inicioSemana(d) {
    const x = new Date(d); x.setHours(0,0,0,0);
    const diff = (x.getDay() - (CONFIG.INICIO_SEMANA || 0) + 7) % 7;
    x.setDate(x.getDate() - diff);
    return x;
  }

  /* ---- métricas NPS ---- */
  function calcNPS(regs) {
    const total = regs.length;
    if (!total) return { score: null, promotores: 0, passivos: 0, detratores: 0, pProm: 0, pPass: 0, pDet: 0, total: 0 };
    const prom = regs.filter(r => r.nps >= 9).length;
    const pass = regs.filter(r => r.nps >= 7 && r.nps <= 8).length;
    const det  = regs.filter(r => r.nps <= 6).length;
    return {
      score: Math.round((prom - det) / total * 100),
      promotores: prom, passivos: pass, detratores: det,
      pProm: Math.round(prom / total * 100),
      pPass: Math.round(pass / total * 100),
      pDet:  Math.round(det  / total * 100),
      total
    };
  }

  function mediasDims(regs) {
    const n = regs.length || 1;
    return {
      medico:     +(regs.reduce((s, r) => s + r.medico,     0) / n).toFixed(2),
      enfermagem: +(regs.reduce((s, r) => s + r.enfermagem, 0) / n).toFixed(2),
      infra:      +(regs.reduce((s, r) => s + r.infra,      0) / n).toFixed(2)
    };
  }

  function zonaLabel(score) {
    if (score === null) return '—';
    if (score >= 75) return 'Excelente';
    if (score >= 50) return 'Muito Bom';
    if (score >= 0)  return 'Razoável';
    return 'Crítico';
  }
  function corNPS(score) {
    if (score === null) return 'var(--texto-sec)';
    if (score >= 50) return COR_PROM;
    if (score >= 0)  return COR_PASS;
    return COR_DET;
  }

  /* ---- render geral ---- */
  function renderTudo() {
    filtrar();
    atualizarLabel();
    renderKPIs();
    renderGraficos();
    renderTabela();
  }

  function atualizarLabel() {
    const map = { semana: 'Semana atual', mes: 'Mês atual', custom: 'Período personalizado' };
    let txt = map[_periodo] || '';
    // mostra o intervalo do PERIODO (como no painel KPI), nao o dos dados
    const a = _pIni || (_filtrados.length ? _filtrados[0].data : null);
    const b = _pFim || (_filtrados.length ? _filtrados[_filtrados.length - 1].data : null);
    if (a && b) {
      txt += `  ·  ${fmtData(a)} a ${fmtData(b)}`;
    } else {
      txt += '  ·  sem respostas neste período';
    }
    if (!_filtrados.length) txt += '  ·  sem respostas';
    document.getElementById('nps-periodo-label').textContent = txt;
  }

  /* ---- KPIs ---- */
  function renderKPIs() {
    const m = calcNPS(_filtrados);
    const d = _filtrados.length ? mediasDims(_filtrados) : { medico: 0, enfermagem: 0, infra: 0 };
    const cor = corNPS(m.score);
    const zona = zonaLabel(m.score);
    const scoreTexto = m.score === null ? '—' : m.score;

    document.getElementById('nps-kpis').innerHTML = `
      <article class="kpi">
        <span class="kpi-titulo">NPS Score</span>
        <span class="kpi-num" style="color:${cor};font-size:2.4rem">${scoreTexto}</span>
        <span class="kpi-sub"><span class="pill" style="color:${cor};background:${cor}1f">${zona}</span></span>
      </article>
      <article class="kpi">
        <span class="kpi-titulo">Total Respostas</span>
        <span class="kpi-num">${m.total}</span>
        <span class="kpi-sub">no período selecionado</span>
      </article>
      <article class="kpi">
        <span class="kpi-titulo">Promotores</span>
        <span class="kpi-num" style="color:${COR_PROM}">${m.pProm}%</span>
        <span class="kpi-sub">${m.promotores} resp. · nota 9–10</span>
      </article>
      <article class="kpi">
        <span class="kpi-titulo">Passivos</span>
        <span class="kpi-num" style="color:${COR_PASS}">${m.pPass}%</span>
        <span class="kpi-sub">${m.passivos} resp. · nota 7–8</span>
      </article>
      <article class="kpi">
        <span class="kpi-titulo">Detratores</span>
        <span class="kpi-num" style="color:${COR_DET}">${m.pDet}%</span>
        <span class="kpi-sub">${m.detratores} resp. · nota 0–6</span>
      </article>
      <article class="kpi">
        <span class="kpi-titulo">Atend. Médico</span>
        <span class="kpi-num">${_filtrados.length ? d.medico.toFixed(1) : '—'}<span style="font-size:.9rem;color:var(--texto-sec)">${_filtrados.length ? '/5' : ''}</span></span>
        <span class="kpi-sub nps-estrelas">${estrelas(d.medico, _filtrados.length)}</span>
      </article>
      <article class="kpi">
        <span class="kpi-titulo">Enfermagem</span>
        <span class="kpi-num">${_filtrados.length ? d.enfermagem.toFixed(1) : '—'}<span style="font-size:.9rem;color:var(--texto-sec)">${_filtrados.length ? '/5' : ''}</span></span>
        <span class="kpi-sub nps-estrelas">${estrelas(d.enfermagem, _filtrados.length)}</span>
      </article>
      <article class="kpi">
        <span class="kpi-titulo">Infraestrutura</span>
        <span class="kpi-num">${_filtrados.length ? d.infra.toFixed(1) : '—'}<span style="font-size:.9rem;color:var(--texto-sec)">${_filtrados.length ? '/5' : ''}</span></span>
        <span class="kpi-sub nps-estrelas">${estrelas(d.infra, _filtrados.length)}</span>
      </article>
    `;
  }

  function estrelas(v, total) {
    if (!total) return '';
    const cheias = Math.round(v);
    return '★'.repeat(cheias) + '☆'.repeat(5 - cheias);
  }

  /* ---- gráficos ---- */
  function destruir(id) { if (_graficos[id]) { _graficos[id].destroy(); delete _graficos[id]; } }
  const ctxEl = id => document.getElementById(id).getContext('2d');
  const grid  = { color: 'rgba(6,47,58,0.07)' };

  function renderGraficos() {
    renderEvolucao();
    renderDistribuicao();
    renderDimensoes();
  }

  function agruparPorTempo() {
    if (!_filtrados.length) return [];

    // decide granularidade pela amplitude
    const dias = new Set(_filtrados.map(r => localISO(r.data))).size;
    const porDia = new Map();

    if (dias <= 31) {
      for (const r of _filtrados) {
        const k = localISO(r.data);
        if (!porDia.has(k)) porDia.set(k, { label: fmtCurto(r.data), regs: [] });
        porDia.get(k).regs.push(r);
      }
      return [...porDia.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v);
    }

    // semanal
    const porSem = new Map();
    for (const r of _filtrados) {
      const ini = inicioSemana(r.data);
      const k   = localISO(ini);
      if (!porSem.has(k)) {
        const fim = new Date(ini); fim.setDate(fim.getDate() + 6);
        porSem.set(k, {
          label: `${String(ini.getDate()).padStart(2,'0')}/${MESES[fim.getMonth()]}`,
          regs: []
        });
      }
      porSem.get(k).regs.push(r);
    }
    return [...porSem.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v);
  }

  function renderEvolucao() {
    const grupos = agruparPorTempo();
    const labels  = grupos.map(g => g.label);
    const scores  = grupos.map(g => { const m = calcNPS(g.regs); return m.score; });
    const totais  = grupos.map(g => g.regs.length);

    destruir('g-nps-evolucao');
    _graficos['g-nps-evolucao'] = new Chart(ctxEl('g-nps-evolucao'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'NPS Score',
            data: scores,
            borderColor: '#B58B4C',
            backgroundColor: 'rgba(181,139,76,0.10)',
            fill: true, tension: 0.38, borderWidth: 2.5,
            pointRadius: 3, pointHoverRadius: 6,
            pointBackgroundColor: scores.map(s => corNPS(s)),
            yAxisID: 'y'
          },
          {
            label: 'Respostas',
            data: totais,
            type: 'bar',
            backgroundColor: 'rgba(42,122,140,0.22)',
            borderColor: 'rgba(42,122,140,0.45)',
            borderWidth: 1, borderRadius: 4,
            maxBarThickness: 32,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 700 },
        plugins: { legend: { display: true, position: 'bottom' } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: {
            type: 'linear', position: 'left', grid,
            min: -100, max: 100,
            ticks: { stepSize: 25 },
            title: { display: true, text: 'NPS', color: 'rgba(6,47,58,0.5)', font: { size: 11 } }
          },
          y2: {
            type: 'linear', position: 'right',
            grid: { display: false },
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: 'Respostas', color: 'rgba(6,47,58,0.5)', font: { size: 11 } }
          }
        }
      }
    });
  }

  function renderDistribuicao() {
    const m = calcNPS(_filtrados);
    const totalDist = m.total || 1;
    destruir('g-nps-dist');
    _graficos['g-nps-dist'] = new Chart(ctxEl('g-nps-dist'), {
      type: 'doughnut',
      data: {
        labels: ['Promotores', 'Passivos', 'Detratores'],
        datasets: [{
          data: [m.promotores, m.passivos, m.detratores],
          backgroundColor: [COR_PROM, COR_PASS, COR_DET],
          borderColor: '#FFFFFF', borderWidth: 3, hoverOffset: 8
        }]
      },
      options: {
        cutout: '62%', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: it => ` ${it.label}: ${it.parsed} (${Math.round(it.parsed / totalDist * 100)}%)`
            }
          }
        }
      },
      plugins: [{
        id: 'npsCenter',
        afterDraw(chart) {
          const cx = chart.ctx;
          const arcs = chart.getDatasetMeta(0).data;
          if (!arcs.length) return;
          const c = arcs[0];
          const scoreStr = m.score === null ? '—' : String(m.score);
          const cor = corNPS(m.score);
          cx.save();
          cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillStyle = cor; cx.font = '800 24px Inter, sans-serif';
          cx.fillText(scoreStr, c.x, c.y - 8);
          cx.fillStyle = '#5A7280'; cx.font = '600 10px Inter, sans-serif';
          cx.fillText('NPS SCORE', c.x, c.y + 11);
          cx.restore();
        }
      }]
    });
  }

  function renderDimensoes() {
    const d = _filtrados.length ? mediasDims(_filtrados) : { medico: 0, enfermagem: 0, infra: 0 };
    destruir('g-nps-dims');
    _graficos['g-nps-dims'] = new Chart(ctxEl('g-nps-dims'), {
      type: 'bar',
      data: {
        labels: ['Atend. Médico', 'Enfermagem', 'Infraestrutura'],
        datasets: [{
          label: 'Média (0–5)',
          data: [d.medico, d.enfermagem, d.infra],
          backgroundColor: ['rgba(181,139,76,0.85)', 'rgba(42,122,140,0.85)', 'rgba(90,114,128,0.85)'],
          borderRadius: 8, borderSkipped: false, maxBarThickness: 52
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: it => ` ${it.parsed.x.toFixed(2)} / 5` } }
        },
        scales: {
          x: { grid, min: 0, max: 5, ticks: { stepSize: 1 } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  /* ---- tabela de respostas ---- */
  function renderTabela() {
    let arr = _filtrados.slice();
    if (_soComent) arr = arr.filter(r => r.comentario);
    arr.sort((a, b) => b.data - a.data);

    const total    = arr.length;
    const totalPag = Math.max(1, Math.ceil(total / IPP));
    _pagina = Math.min(_pagina, totalPag);
    const ini = (_pagina - 1) * IPP;
    const pag = arr.slice(ini, ini + IPP);

    document.getElementById('nps-tabela-corpo').innerHTML = pag.map(r => {
      const corN = r.nps >= 9 ? COR_PROM : r.nps >= 7 ? COR_PASS : COR_DET;
      const med  = r.medico     ? r.medico.toFixed(1)     : '—';
      const enf  = r.enfermagem ? r.enfermagem.toFixed(1) : '—';
      const inf  = r.infra      ? r.infra.toFixed(1)      : '—';
      return `<tr>
        <td>${fmtData(r.data)}</td>
        <td class="nps-nota-cell" style="color:${corN}">${r.nps}</td>
        <td class="nps-dim-cell">${med}</td>
        <td class="nps-dim-cell">${enf}</td>
        <td class="nps-dim-cell">${inf}</td>
        <td class="nps-comment-cell">${r.comentario || '<span class="nps-sem-comment">—</span>'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="vazio">Nenhuma resposta no período.</td></tr>`;

    document.getElementById('nps-tabela-info').textContent =
      total ? `${ini + 1}–${Math.min(ini + IPP, total)} de ${total} respostas` : '0 respostas';

    const pg = document.getElementById('nps-paginacao');
    pg.innerHTML = '';
    const btn = (txt, alvo, dis, ativo) => {
      const b = document.createElement('button');
      b.textContent = txt; b.disabled = dis;
      if (ativo) b.classList.add('ativo');
      b.addEventListener('click', () => { _pagina = alvo; renderTabela(); });
      return b;
    };
    pg.appendChild(btn('‹', _pagina - 1, _pagina === 1));
    let pi = Math.max(1, _pagina - 2), pf = Math.min(totalPag, pi + 4);
    pi = Math.max(1, pf - 4);
    for (let i = pi; i <= pf; i++) pg.appendChild(btn(i, i, false, i === _pagina));
    pg.appendChild(btn('›', _pagina + 1, _pagina === totalPag));
  }

  /* ---- utilitários ---- */
  const localISO = d =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fmtData  = d =>
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtCurto = d =>
    `${String(d.getDate()).padStart(2,'0')}/${MESES[d.getMonth()]}`;

  /* ---- eventos ---- */
  function ligarEventos() {
    document.querySelectorAll('.btn-nps-periodo').forEach(b =>
      b.addEventListener('click', () => {
        _periodo = b.dataset.periodo;
        document.querySelectorAll('.btn-nps-periodo').forEach(x => x.classList.remove('ativo'));
        b.classList.add('ativo');
        document.getElementById('nps-custom-range').classList.toggle('oculto', _periodo !== 'custom');
        if (_periodo !== 'custom') { _pagina = 1; renderTudo(); }
      }));

    document.getElementById('nps-btn-aplicar').addEventListener('click', () => {
      const i = document.getElementById('nps-data-ini').value;
      const f = document.getElementById('nps-data-fim').value;
      if (i && f) { _custom = { ini: i, fim: f }; _pagina = 1; renderTudo(); }
    });

    document.getElementById('nps-btn-limpar').addEventListener('click', () => {
      document.getElementById('nps-data-ini').value = '';
      document.getElementById('nps-data-fim').value = '';
      _custom = { ini: null, fim: null };
      _periodo = 'mes';
      document.querySelectorAll('.btn-nps-periodo').forEach(x =>
        x.classList.toggle('ativo', x.dataset.periodo === 'mes'));
      document.getElementById('nps-custom-range').classList.add('oculto');
      _pagina = 1; renderTudo();
    });

    document.getElementById('nps-filtro-coment').addEventListener('change', e => {
      _soComent = e.target.checked; _pagina = 1; renderTabela();
    });
  }

  /* ---- inicializar (lazy, só na primeira ativação da aba) ---- */
  async function iniciar() {
    if (_iniciado) return;
    _iniciado = true;
    ligarEventos();
    document.getElementById('nps-kpis').innerHTML =
      Array(8).fill('<article class="kpi skeleton" style="height:118px"></article>').join('');
    await carregar();
    document.querySelectorAll('#nps-kpis .skeleton').forEach(s => s.classList.remove('skeleton'));
    renderTudo();
  }

  return { iniciar };
})();
