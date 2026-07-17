/* ============================================================
   CORPO.JS  —  Gestao do Corpo Clinico (aba do painel)
   ------------------------------------------------------------
   - Lista os medicos da aba MEDICOS (DB HSF)
   - Edicao inline com auto-save no banco (action=upsertMedico)
   - Adicionar / excluir medico (action=deleteMedico)
   - Responsiva (cards que se adaptam a largura)
   ============================================================ */

const Corpo = (() => {

  let _iniciado = false;
  let _medicos = [];
  let _busca = "";

  /* ---- JSONP (grava sem CORS) ---- */
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "__cc_cb_" + Date.now() + Math.floor(Math.random() * 1e4);
      const s = document.createElement("script");
      const t = setTimeout(() => { limpar(); reject(new Error("timeout")); }, 20000);
      window[cb] = (d) => { clearTimeout(t); limpar(); resolve(d); };
      s.onerror = () => { clearTimeout(t); limpar(); reject(new Error("erro de rede")); };
      s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
      document.body.appendChild(s);
      function limpar() { try { delete window[cb]; } catch (e) {} s.remove(); }
    });
  }
  const api = (params) => {
    let u = CONFIG.API_URL + "?" + params;
    if (CONFIG.API_TOKEN) u += "&token=" + encodeURIComponent(CONFIG.API_TOKEN);
    return jsonp(u);
  };

  async function buscar() {
    const d = await api("action=medicos");
    _medicos = (d && d.medicos) || [];
    _medicos.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }

  const esc = (s) => String(s == null ? "" : s).replace(/"/g, "&quot;").replace(/</g, "&lt;");

  function render() {
    const cont = document.getElementById("cc-lista");
    const termo = _busca.trim().toLowerCase();
    const lista = termo
      ? _medicos.filter(m => (m.nome || "").toLowerCase().includes(termo)
        || (m.codigo || "").includes(termo) || (m.crm || "").toLowerCase().includes(termo))
      : _medicos;

    const comCod = _medicos.filter(m => m.codigo).length;
    document.getElementById("cc-resumo").textContent =
      `${_medicos.length} médicos · ${comCod} com código MV`;

    cont.innerHTML = lista.map(m => cardHTML(m)).join("")
      || `<p class="cc-vazio">Nenhum médico encontrado.</p>`;
  }

  function cardHTML(m) {
    const semCod = !m.codigo;
    return `<div class="cc-card${semCod ? " sem-cod" : ""}" data-id="${esc(m.id)}">
      <div class="cc-topo">
        <input class="cc-nome" data-f="nome" value="${esc(m.nome)}" placeholder="Nome completo">
        <button class="cc-del" title="Excluir médico" aria-label="Excluir">✕</button>
      </div>
      <div class="cc-campos">
        <label>Código MV
          <input data-f="codigo" value="${esc(m.codigo)}" inputmode="numeric" placeholder="—">
        </label>
        <label>CRM
          <input data-f="crm" value="${esc(m.crm)}" placeholder="—">
        </label>
        <label>Contato
          <input data-f="contato" value="${esc(m.contato)}" placeholder="—">
        </label>
        <label>Requisito
          <input data-f="requisito" value="${esc(m.requisito)}" placeholder="—">
        </label>
      </div>
      <div class="cc-rodape">
        ${semCod ? '<span class="cc-aviso">⚠ sem código — não entra na contagem de atendimentos</span>' : ""}
        <span class="cc-status"></span>
      </div>
    </div>`;
  }

  /* ---- salvar um card (auto-save, serializado para nao duplicar) ---- */
  function salvarCard(card) {
    card._chain = (card._chain || Promise.resolve()).then(() => doSave(card)).catch(() => {});
    return card._chain;
  }
  async function doSave(card) {
    const id = card.dataset.id;
    const g = (f) => (card.querySelector(`[data-f="${f}"]`).value || "").trim();
    const nome = g("nome");
    if (!nome && !g("codigo")) return;   // nada pra salvar
    const status = card.querySelector(".cc-status");
    status.textContent = "salvando…"; status.className = "cc-status salvando";
    const params = "action=upsertMedico"
      + "&id=" + encodeURIComponent(id || "")
      + "&nome=" + encodeURIComponent(nome)
      + "&crm=" + encodeURIComponent(g("crm"))
      + "&contato=" + encodeURIComponent(g("contato"))
      + "&codigo=" + encodeURIComponent(g("codigo"))
      + "&requisito=" + encodeURIComponent(g("requisito"));
    try {
      const r = await api(params);
      if (!r || !r.ok) throw new Error((r && r.erro) || "falha");
      if (r.id) card.dataset.id = r.id;
      // atualiza estado local
      const m = _medicos.find(x => x.id === card.dataset.id) || {};
      m.id = card.dataset.id; m.nome = nome; m.crm = g("crm"); m.contato = g("contato");
      m.codigo = g("codigo"); m.requisito = g("requisito");
      if (!_medicos.includes(m)) _medicos.push(m);
      card.classList.toggle("sem-cod", !g("codigo"));
      status.textContent = "✓ salvo"; status.className = "cc-status ok";
      setTimeout(() => { status.textContent = ""; }, 1600);
      atualizarResumo();
    } catch (e) {
      status.textContent = "erro ao salvar"; status.className = "cc-status erro";
    }
  }

  function atualizarResumo() {
    const comCod = _medicos.filter(m => m.codigo).length;
    document.getElementById("cc-resumo").textContent =
      `${_medicos.length} médicos · ${comCod} com código MV`;
  }

  async function excluirCard(card) {
    const id = card.dataset.id;
    const nome = card.querySelector('[data-f="nome"]').value || "este médico";
    if (!confirm(`Excluir ${nome} do corpo clínico?`)) return;
    if (id) {
      try { await api("action=deleteMedico&id=" + encodeURIComponent(id)); }
      catch (e) { alert("Não foi possível excluir: " + e.message); return; }
    }
    _medicos = _medicos.filter(m => m.id !== id);
    card.remove();
    atualizarResumo();
  }

  function adicionar() {
    const cont = document.getElementById("cc-lista");
    const vazio = cont.querySelector(".cc-vazio"); if (vazio) vazio.remove();
    const div = document.createElement("div");
    div.innerHTML = cardHTML({ id: "", nome: "", crm: "", contato: "", codigo: "", requisito: "Apenas Porta" });
    const card = div.firstElementChild;
    cont.prepend(card);
    card.querySelector('[data-f="nome"]').focus();
  }

  function ligarEventos() {
    document.getElementById("cc-add").addEventListener("click", adicionar);
    document.getElementById("cc-busca").addEventListener("input", (e) => { _busca = e.target.value; render(); });

    const lista = document.getElementById("cc-lista");
    // auto-save quando um campo perde o foco com alteracao
    lista.addEventListener("change", (e) => {
      const card = e.target.closest(".cc-card"); if (card) salvarCard(card);
    });
    lista.addEventListener("click", (e) => {
      if (e.target.closest(".cc-del")) excluirCard(e.target.closest(".cc-card"));
    });
  }

  async function iniciar() {
    if (_iniciado) return;
    _iniciado = true;
    ligarEventos();
    document.getElementById("cc-lista").innerHTML = '<p class="cc-carregando">Carregando…</p>';
    try { await buscar(); render(); }
    catch (e) { document.getElementById("cc-lista").innerHTML = `<p class="cc-vazio">Erro ao carregar: ${e.message}</p>`; }
  }

  return { iniciar };
})();
