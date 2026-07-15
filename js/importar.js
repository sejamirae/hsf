/* ============================================================
   IMPORTAR.JS  —  Upload de relatorios do MV direto no BI
   ------------------------------------------------------------
   - Le os 2 .xls exportados do MV (atendimentos + internacoes)
     no proprio navegador (SheetJS, ja carregado)
   - Filtra pelos medicos Mirae "Porta" (codigos vindos da aba
     MEDICOS via action=medicos) e classifica SF (Sagrada)
   - Mostra uma previa e, ao confirmar, grava no DB (action=upsert)
   ============================================================ */

const Importar = (() => {

  let _bufAtend = null, _bufIntern = null;
  let _nomeAtend = "", _nomeIntern = "";
  let _registros = [];

  const reDate = /\b(\d{2})\/(\d{2})\/(\d{4})\b/, reTime = /^\d{1,2}:\d{2}$/, reId = /^\d{7}$/;

  const norm = (s) => String(s == null ? "" : s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();

  function aoaFrom(buf) {
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return { nome: wb.SheetNames[0], rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) };
  }

  /* similaridade Dice (bigramas) no comprimento do menor nome —
     tolera truncamento e pequenas diferencas de grafia */
  function simil(a, b) {
    const L = Math.min(a.length, b.length);
    a = a.slice(0, L); b = b.slice(0, L);
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    const bg = (s) => { const m = {}; for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m[g] = (m[g] || 0) + 1; } return m; };
    const A = bg(a), B = bg(b); let inter = 0, tot = 0;
    for (const g in A) { tot += A[g]; if (B[g]) inter += Math.min(A[g], B[g]); }
    for (const g in B) tot += B[g];
    return tot ? 2 * inter / tot : 0;
  }

  /* ------- nucleo: transforma os 2 arquivos em registros diarios ------- */
  function processar(bufAtend, bufIntern, medicos) {
    const codes = new Set(medicos.filter(m => m.codigo).map(m => String(m.codigo).trim()));
    const nomes = medicos.filter(m => m.nome).map(m => norm(m.nome));
    const isPorta = (nm) => { const m = norm(nm); return m ? nomes.some(f => simil(f, m) >= 0.90) : false; };
    const day = {};
    const get = (d) => day[d] || (day[d] = { dia: d, atSF: 0, atExt: 0, intSF: 0, intExt: 0 });

    if (bufAtend) {
      let cur = null;
      for (const raw of aoaFrom(bufAtend).rows) {
        const row = raw.map(x => String(x).trim()); const j = row.join(" ");
        const ht = row.some(x => reTime.test(x)), hi = row.some(x => reId.test(x));
        const m = j.match(reDate);
        if (m && !(ht && hi)) cur = `${m[3]}-${m[2]}-${m[1]}`;
        if (ht && hi && cur && codes.has(String(row[23]).trim())) {
          if (j.toUpperCase().includes("SAGRADA FAMILIA")) get(cur).atSF++; else get(cur).atExt++;
        }
      }
    }
    if (bufIntern) {
      let curmed = null;
      for (const raw of aoaFrom(bufIntern).rows) {
        const row = raw.map(x => String(x).trim()); const j = row.join(" ");
        if (j.includes("dico:")) { curmed = String(row[17]).trim() || null; continue; }
        if (!row.some(x => reId.test(x))) continue;
        const m = j.match(reDate); if (!m || !(curmed && isPorta(curmed))) continue;
        const dia = `${m[3]}-${m[2]}-${m[1]}`;
        if (row.some(x => x.toUpperCase().startsWith("SFS"))) get(dia).intSF++; else get(dia).intExt++;
      }
    }
    return Object.values(day).sort((a, b) => a.dia < b.dia ? -1 : 1);
  }

  /* ------- JSONP para gravar (evita CORS no write) ------- */
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "__imp_cb_" + Date.now() + Math.floor(Math.random() * 1e4);
      const s = document.createElement("script");
      const t = setTimeout(() => { limpar(); reject(new Error("timeout")); }, 20000);
      window[cb] = (d) => { clearTimeout(t); limpar(); resolve(d); };
      s.onerror = () => { clearTimeout(t); limpar(); reject(new Error("erro de rede")); };
      s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
      document.body.appendChild(s);
      function limpar() { try { delete window[cb]; } catch (e) {} s.remove(); }
    });
  }

  async function buscarMedicos() {
    const url = CONFIG.API_URL + "?action=medicos";
    if (CONFIG.API_JSONP) { const d = await jsonp(url); return (d && d.medicos) || []; }
    const r = await fetch(url); const d = await r.json();
    return (d && d.medicos) || [];
  }

  const fmtBR = (iso) => { const p = iso.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; };

  /* ------- UI ------- */
  function abrir() {
    _bufAtend = _bufIntern = null; _nomeAtend = _nomeIntern = ""; _registros = [];
    document.getElementById("imp-input").value = "";
    document.getElementById("imp-arquivos").innerHTML = "";
    document.getElementById("imp-previa").innerHTML = "";
    document.getElementById("imp-status").textContent = "";
    document.getElementById("imp-gravar").disabled = true;
    document.getElementById("tela-importar").classList.remove("oculto");
  }
  function fechar() { document.getElementById("tela-importar").classList.add("oculto"); }

  async function aoEscolherArquivos(files) {
    const arquivosDiv = document.getElementById("imp-arquivos");
    arquivosDiv.innerHTML = "";
    for (const f of files) {
      const buf = await f.arrayBuffer();
      let tipo = "?";
      try {
        const wb = XLSX.read(buf, { type: "array", bookSheets: true });
        const nome = (wb.SheetNames[0] || "").toUpperCase();
        if (nome.includes("PAC_ATEND")) { _bufAtend = buf; _nomeAtend = f.name; tipo = "Atendimentos"; }
        else if (nome.includes("INTERNACOESMEDICO")) { _bufIntern = buf; _nomeIntern = f.name; tipo = "Internações"; }
        else tipo = "não reconhecido";
      } catch (e) { tipo = "erro ao ler"; }
      const ok = tipo === "Atendimentos" || tipo === "Internações";
      arquivosDiv.innerHTML += `<div class="imp-arq ${ok ? "ok" : "erro"}">${ok ? "✓" : "✕"} ${f.name} — <b>${tipo}</b></div>`;
    }
    gerarPrevia();
  }

  async function gerarPrevia() {
    const status = document.getElementById("imp-status");
    const previa = document.getElementById("imp-previa");
    if (!_bufAtend && !_bufIntern) { previa.innerHTML = ""; return; }
    status.textContent = "Processando...";
    try {
      const medicos = await buscarMedicos();
      _registros = processar(_bufAtend, _bufIntern, medicos);
      if (!_registros.length) { previa.innerHTML = `<p class="imp-vazio">Nenhum registro reconhecido nos arquivos.</p>`; status.textContent = ""; document.getElementById("imp-gravar").disabled = true; return; }
      const linhas = _registros.map(r => {
        const cSF = r.atSF ? (r.intSF / r.atSF * 100).toFixed(1) : "0.0";
        const cEx = r.atExt ? (r.intExt / r.atExt * 100).toFixed(1) : "0.0";
        return `<tr><td>${fmtBR(r.dia)}</td><td>${r.atSF}</td><td>${r.atExt}</td><td>${r.intSF}</td><td>${r.intExt}</td><td>${cSF}%</td><td>${cEx}%</td></tr>`;
      }).join("");
      // quantos ja existem no banco (serao atualizados) x novos
      let existentes = new Set();
      try { existentes = new Set((Data.registros() || []).map(r => r.data.toISOString().slice(0, 10))); } catch (e) {}
      const nAtualiza = _registros.filter(r => existentes.has(r.dia)).length;
      const nNovos = _registros.length - nAtualiza;
      previa.innerHTML = `
        <div class="imp-resumo">${_registros.length} dia(s) · ${fmtBR(_registros[0].dia)} a ${fmtBR(_registros[_registros.length - 1].dia)}
          <span class="imp-badge nov">${nNovos} novo(s)</span>
          <span class="imp-badge atu">${nAtualiza} atualiza</span>
          ${!_bufAtend ? '<span class="imp-aviso">⚠ sem arquivo de atendimentos</span>' : ""}
          ${!_bufIntern ? '<span class="imp-aviso">⚠ sem arquivo de internações</span>' : ""}
        </div>
        <div class="imp-tab-scroll"><table class="imp-tab">
          <thead><tr><th>Dia</th><th>At. SF</th><th>At. Ext</th><th>Int. SF</th><th>Int. Ext</th><th>Conv. SF</th><th>Conv. Ext</th></tr></thead>
          <tbody>${linhas}</tbody></table></div>`;
      status.textContent = "";
      document.getElementById("imp-gravar").disabled = false;
    } catch (e) {
      status.textContent = "Erro ao processar: " + e.message;
      document.getElementById("imp-gravar").disabled = true;
    }
  }

  async function gravar() {
    if (!_registros.length) return;
    const status = document.getElementById("imp-status");
    const btn = document.getElementById("imp-gravar");
    btn.disabled = true; status.textContent = "Gravando no banco...";
    try {
      let ins = 0, upd = 0;
      for (let i = 0; i < _registros.length; i += 15) {
        const chunk = _registros.slice(i, i + 15);
        const url = CONFIG.API_URL + "?action=upsert&dados=" + encodeURIComponent(JSON.stringify(chunk));
        const res = await jsonp(url);
        if (!res || !res.ok) throw new Error((res && res.erro) || "falha ao gravar");
        ins += res.inseridos || 0; upd += res.atualizados || 0;
      }
      status.textContent = `✓ ${ins} inserido(s), ${upd} atualizado(s). Atualizando painel...`;
      if (typeof Dashboard !== "undefined" && Dashboard.recarregar) await Dashboard.recarregar();
      status.textContent = `✓ Concluído — ${ins} inserido(s), ${upd} atualizado(s).`;
      setTimeout(fechar, 1200);
    } catch (e) {
      status.textContent = "Erro ao gravar: " + e.message;
      btn.disabled = false;
    }
  }

  function iniciar() {
    const btn = document.getElementById("btn-importar");
    if (!btn) return;
    btn.addEventListener("click", abrir);
    document.getElementById("imp-fechar").addEventListener("click", fechar);
    document.getElementById("imp-cancelar").addEventListener("click", fechar);
    document.getElementById("imp-gravar").addEventListener("click", gravar);
    document.getElementById("imp-input").addEventListener("change", (e) => aoEscolherArquivos(e.target.files));
  }

  return { iniciar };
})();
