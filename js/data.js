/* ============================================================
   DATA.JS  —  Camada de dados
   ------------------------------------------------------------
   - Carrega a planilha UMA unica vez (Google Visualization API)
   - Normaliza as colunas e mantem tudo em memoria
   - Recalcula a conversao a partir de Internacoes / Atendimentos
     para garantir consistencia entre dias, semanas e meses
   - Sem planilha configurada -> gera dados de DEMONSTRACAO
   ============================================================ */

const Data = (() => {

  let _registros = [];          // base completa em memoria
  let _origem = "demo";         // "api" | "google" | "demo"
  let _config = null;           // config remota (faixas) vinda da API

  /* ---------- utilitarios de texto ---------- */
  const norm = (s) => (s || "")
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // remove acentos
    .toLowerCase().trim();

  /* Localiza o indice da coluna pelo significado, tolerante a
     acentos, maiusculas e ao sufixo "(Meta = ...)" */
  function acharColuna(labels, base, lado) {
    const baseN = norm(base);
    for (let i = 0; i < labels.length; i++) {
      const L = norm(labels[i]);
      if (!L.includes(baseN)) continue;
      if (lado === "sf"  && /\bsf\b/.test(L) && !L.includes("ext")) return i;
      if (lado === "ext" && (L.includes("ext"))) return i;
      if (!lado) return i;
    }
    return -1;
  }

  /* ---------- parsing de datas vindas do gviz ---------- */
  function parseData(cell) {
    if (!cell) return null;
    const v = cell.v, f = cell.f;
    if (typeof v === "string" && v.startsWith("Date(")) {
      const p = v.slice(5, -1).split(",").map(Number);
      return new Date(p[0], p[1], p[2] || 1, p[3] || 0, p[4] || 0);
    }
    if (typeof f === "string") {
      const m = f.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (m) {
        let ano = +m[3]; if (ano < 100) ano += 2000;
        return new Date(ano, +m[2] - 1, +m[1]);
      }
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  const num = (cell) => {
    if (!cell) return 0;
    if (typeof cell.v === "number") return cell.v;
    const n = parseFloat(String(cell.v ?? cell.f ?? "0").replace(",", "."));
    return isNaN(n) ? 0 : n;
  };

  /* ---------- enriquece um registro bruto ---------- */
  function enriquecer(r) {
    const atTotal  = r.atSF + r.atExt;
    const intTotal = r.intSF + r.intExt;
    return {
      ...r,
      atTotal, intTotal,
      convSF:    r.atSF  ? +(r.intSF  / r.atSF  * 100).toFixed(2) : 0,
      convExt:   r.atExt ? +(r.intExt / r.atExt * 100).toFixed(2) : 0,
      convTotal: atTotal ? +(intTotal / atTotal * 100).toFixed(2) : 0
    };
  }

  /* ---------- leitura via API (Apps Script Web App) ---------- */
  function lerJSONP(url) {
    return new Promise((resolve, reject) => {
      const cb = "__hsf_cb_" + Date.now();
      const sep = url.includes("?") ? "&" : "?";
      const s = document.createElement("script");
      const limpar = () => { try { delete window[cb]; } catch (e) {} s.remove(); };
      const timer = setTimeout(() => { limpar(); reject(new Error("JSONP timeout")); }, 15000);
      window[cb] = (data) => { clearTimeout(timer); limpar(); resolve(data); };
      s.onerror = () => { clearTimeout(timer); limpar(); reject(new Error("JSONP erro")); };
      s.src = url + sep + "callback=" + cb;
      document.body.appendChild(s);
    });
  }

  async function lerAPI() {
    let url = CONFIG.API_URL;
    if (CONFIG.API_TOKEN) url += (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(CONFIG.API_TOKEN);
    const json = CONFIG.API_JSONP ? await lerJSONP(url) : await (await fetch(url)).json();
    if (json && json.erro) throw new Error(json.erro);
    _config = (json && json.config) ? json.config : null;
    const hojeFim = new Date(); hojeFim.setHours(23, 59, 59, 999);
    return (json.registros || []).map(r => enriquecer({
      data:   new Date(r.dia + "T00:00:00"),
      atSF:   +r.atSF || 0,
      atExt:  +r.atExt || 0,
      intSF:  +r.intSF || 0,
      intExt: +r.intExt || 0
    })).filter(r => {
      if (isNaN(r.data)) return false;
      const totZero = (r.atSF + r.atExt + r.intSF + r.intExt) === 0;
      // descarta apenas linhas FUTURAS totalmente zeradas (pre-preenchidas)
      if (totZero && r.data > hojeFim) return false;
      return true;
    });
  }

  /* ---------- leitura via Google Visualization API ---------- */
  async function lerGoogleSheets() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.GOOGLE_SHEET_ID}` +
      `/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CONFIG.SHEET_NAME)}`;
    const txt = await (await fetch(url)).text();
    const json = JSON.parse(txt.replace(/^[^{]*\{/, "{").replace(/\);?\s*$/, ""));

    const cols = json.table.cols.map(c => c.label || c.id);
    const idx = {
      dia:    acharColuna(cols, "dia"),
      atSF:   acharColuna(cols, "atendiment", "sf"),
      atExt:  acharColuna(cols, "atendiment", "ext"),
      intSF:  acharColuna(cols, "internac", "sf"),
      intExt: acharColuna(cols, "internac", "ext")
    };

    const regs = [];
    for (const row of json.table.rows) {
      const c = row.c || [];
      const data = parseData(c[idx.dia]);
      if (!data) continue;
      regs.push(enriquecer({
        data,
        atSF:   num(c[idx.atSF]),
        atExt:  num(c[idx.atExt]),
        intSF:  num(c[idx.intSF]),
        intExt: num(c[idx.intExt])
      }));
    }
    return regs;
  }

  /* ---------- dados de demonstracao (90 dias) ---------- */
  function gerarDemo() {
    const regs = [];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const rand = (a, b) => a + Math.random() * (b - a);
    for (let i = 89; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(hoje.getDate() - i);
      const dow = d.getDay();
      const fds = (dow === 0 || dow === 6) ? 0.45 : 1;   // fim de semana mais fraco
      const tend = 1 + (89 - i) / 320;                   // leve crescimento
      const atSF  = Math.round(rand(95, 165) * fds * tend);
      const atExt = Math.round(rand(210, 380) * fds * tend);
      const intSF  = Math.round(atSF  * rand(0.012, 0.034));  // ~ meta 2%
      const intExt = Math.round(atExt * rand(0.075, 0.135));  // ~ meta 10%
      regs.push(enriquecer({ data: d, atSF, atExt, intSF, intExt }));
    }
    return regs;
  }

  /* ---------- carregamento (uma vez) ---------- */
  async function carregar() {
    // 1) API via Apps Script (recomendado — planilha continua privada)
    if (CONFIG.API_URL) {
      try {
        const regs = await lerAPI();
        if (regs.length) {
          _registros = regs.sort((a, b) => a.data - b.data);
          _origem = "api";
          return { ok: true, origem: "api", total: regs.length };
        }
        throw new Error("API sem registros");
      } catch (e) {
        console.warn("Falha na API, tentando alternativa:", e.message);
      }
    }
    // 2) Google Visualization API (planilha publica)
    if (CONFIG.GOOGLE_SHEET_ID && CONFIG.SHEET_NAME) {
      try {
        const regs = await lerGoogleSheets();
        if (regs.length) {
          _registros = regs.sort((a, b) => a.data - b.data);
          _origem = "google";
          return { ok: true, origem: "google", total: regs.length };
        }
        throw new Error("planilha vazia");
      } catch (e) {
        console.warn("Falha no gviz:", e.message);
      }
    }
    // 3) demonstracao
    _registros = gerarDemo();
    _origem = "demo";
    return { ok: true, origem: "demo", total: _registros.length };
  }

  /* ---------- helpers de data ---------- */
  function inicioSemana(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const diff = (x.getDay() - CONFIG.INICIO_SEMANA + 7) % 7;
    x.setDate(x.getDate() - diff);
    return x;
  }
  const chaveDia  = (d) => d.toISOString().slice(0, 10);
  const chaveMes  = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  /* ---------- filtro por periodo ---------- */
  function filtrarPeriodo(regs, periodo, custom) {
    if (!regs.length) return [];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    let ini = null, fim = null;
    switch (periodo) {
      case "hoje":  ini = new Date(hoje); fim = new Date(hoje); break;
      case "ontem": ini = new Date(hoje); ini.setDate(ini.getDate() - 1); fim = new Date(ini); break;
      case "7dias": fim = new Date(hoje); ini = new Date(hoje); ini.setDate(ini.getDate() - 6); break;
      case "semana": ini = inicioSemana(hoje); fim = new Date(ini); fim.setDate(fim.getDate() + 6); break;
      case "mes": ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
                  fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0); break;
      case "custom":
        if (custom && custom.ini && custom.fim) {
          ini = new Date(custom.ini + "T00:00:00");
          fim = new Date(custom.fim + "T00:00:00");
        } break;
      default: return regs.slice();   // total
    }
    if (!ini) return regs.slice();
    fim.setHours(23, 59, 59, 999);
    return regs.filter(r => r.data >= ini && r.data <= fim);
  }

  /* ---------- agregacao por visao ---------- */
  function vazio() { return { atSF: 0, atExt: 0, intSF: 0, intExt: 0 }; }

  function somar(acc, r) {
    acc.atSF += r.atSF; acc.atExt += r.atExt;
    acc.intSF += r.intSF; acc.intExt += r.intExt;
    return acc;
  }

  function agregar(regs, visao) {
    if (visao === "total") {
      const t = regs.reduce(somar, vazio());
      return [{ chave: "total", label: "Total Geral", data: regs[0]?.data, ...enriquecer(t), dias: regs.length }];
    }
    if (visao === "diario") {
      return regs.map(r => ({ chave: chaveDia(r.data), label: fmtDiaCurto(r.data), data: r.data, ...r, dias: 1 }));
    }
    const grupos = new Map();
    for (const r of regs) {
      let chave, data, label;
      if (visao === "mensal") {
        chave = chaveMes(r.data);
        data = new Date(r.data.getFullYear(), r.data.getMonth(), 1);
        label = `${MESES[r.data.getMonth()]}/${r.data.getFullYear()}`;
      } else { // semanal
        const ini = inicioSemana(r.data);
        chave = chaveDia(ini);
        data = ini;
        const fim = new Date(ini); fim.setDate(fim.getDate() + 6);
        label = `${String(ini.getDate()).padStart(2, "0")}–${String(fim.getDate()).padStart(2, "0")}/${MESES[fim.getMonth()]}`;
      }
      if (!grupos.has(chave)) grupos.set(chave, { chave, label, data, _raw: vazio(), dias: 0 });
      const g = grupos.get(chave); somar(g._raw, r); g.dias++;
    }
    return [...grupos.values()]
      .sort((a, b) => a.data - b.data)
      .map(g => ({ chave: g.chave, label: g.label, data: g.data, dias: g.dias, ...enriquecer(g._raw) }));
  }

  /* ---------- formatadores ---------- */
  function fmtDiaCurto(d) {
    return `${String(d.getDate()).padStart(2, "0")}/${MESES[d.getMonth()]}`;
  }
  function fmtDiaLongo(d) {
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  /* ---------- salva config (faixas) para todos via API ---------- */
  function salvarConfig(obj) {
    if (!CONFIG.API_URL) return Promise.reject(new Error("sem API"));
    let u = CONFIG.API_URL + (CONFIG.API_URL.includes("?") ? "&" : "?")
      + "action=saveConfig&config=" + encodeURIComponent(JSON.stringify(obj));
    if (CONFIG.API_TOKEN) u += "&token=" + encodeURIComponent(CONFIG.API_TOKEN);
    _config = obj;
    return lerJSONP(u);   // JSONP: grava sem problemas de CORS
  }

  /* ---------- exclui um ou mais dias do banco (via API) ---------- */
  function excluirDia(dias) {
    if (!CONFIG.API_URL) return Promise.reject(new Error("sem API"));
    const lista = Array.isArray(dias) ? dias.join(",") : String(dias);
    let u = CONFIG.API_URL + (CONFIG.API_URL.includes("?") ? "&" : "?")
      + "action=deleteDia&dias=" + encodeURIComponent(lista);
    if (CONFIG.API_TOKEN) u += "&token=" + encodeURIComponent(CONFIG.API_TOKEN);
    return lerJSONP(u);
  }

  return {
    carregar,
    registros: () => _registros,
    origem: () => _origem,
    config: () => _config,
    salvarConfig,
    excluirDia,
    filtrarPeriodo,
    agregar,
    enriquecer,
    inicioSemana,
    fmtDiaCurto,
    fmtDiaLongo,
    MESES
  };
})();
