/* ============================================================
   CODIGO.GS  —  API do Hospital Sao Francisco (Google Apps Script)
   ------------------------------------------------------------
   Serve dois conjuntos de dados:
     - Sem action (ou action ausente): dados operacionais de KPI
     - action=nps: respostas de NPS da planilha de satisfacao

   COMO ATUALIZAR (ja implantado):
   1. Abra o Apps Script da planilha de KPI.
   2. Apague o conteudo e cole TODO este arquivo. Salve.
   3. "Implantar" -> "Gerenciar implantacoes" -> editar (lapis)
      -> "Nova versao" -> Implantar.
   (A URL /exec continua a mesma.)
   ============================================================ */

/* ---------- CONFIGURACAO ---------- */
const ABA   = 'Dados';   // aba de KPI na planilha atual
const TOKEN = '';        // opcional — igual em js/config.js (API_TOKEN)

// Planilha separada de NPS (apenas leitura; voce e editor)
const NPS_SHEET_ID  = '1hkwTPNkNn5tRlSHwwc3UA_d4CnFQHPywKD34dcwyy2U';
const NPS_ABA       = 'Coleta NPS Médico - PS São Francisco';

/* ---------- ENDPOINT PRINCIPAL ---------- */
function doGet(e) {
  try {
    if (TOKEN && (!e || e.parameter.token !== TOKEN)) {
      return saida({ ok: false, erro: 'token invalido' }, e);
    }

    const action = e && e.parameter && e.parameter.action;

    // --- salvar configuracao de faixas ---
    if (action === 'saveConfig') {
      PropertiesService.getScriptProperties()
        .setProperty('HSF_CONFIG', e.parameter.config || '');
      return saida({ ok: true, salvo: true }, e);
    }

    // --- dados de NPS ---
    if (action === 'nps') {
      return lerNPS(e);
    }

    // --- dados de KPI (padrao) ---
    return lerKPI(e);

  } catch (err) {
    return saida({ ok: false, erro: String(err) }, e);
  }
}

/* ---------- KPI (planilha atual) ---------- */
function lerKPI(e) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ABA ? ss.getSheetByName(ABA) : ss.getSheets()[0];
  if (!sheet) return saida({ ok: false, erro: 'aba KPI nao encontrada' }, e);

  const valores = sheet.getDataRange().getValues();
  const cfg     = lerConfigSalva();
  if (valores.length < 2) return saida({ ok: true, registros: [], config: cfg }, e);

  const cab = valores[0].map(norm);
  const idx = {
    dia:    achar(cab, 'dia'),
    atSF:   achar(cab, 'atendiment', 'sf'),
    atExt:  achar(cab, 'atendiment', 'ext'),
    intSF:  achar(cab, 'internac', 'sf'),
    intExt: achar(cab, 'internac', 'ext')
  };
  if (idx.dia < 0) return saida({ ok: false, erro: 'coluna "Dia" nao encontrada' }, e);

  const registros = [];
  for (let i = 1; i < valores.length; i++) {
    const linha = valores[i];
    const dia   = formatarData(linha[idx.dia]);
    if (!dia) continue;
    registros.push({
      dia:    dia,
      atSF:   num(linha[idx.atSF]),
      atExt:  num(linha[idx.atExt]),
      intSF:  num(linha[idx.intSF]),
      intExt: num(linha[idx.intExt])
    });
  }
  return saida({ ok: true, total: registros.length, registros: registros, config: cfg }, e);
}

/* ---------- NPS (planilha separada) ---------- */
function lerNPS(e) {
  try {
    const ss    = SpreadsheetApp.openById(NPS_SHEET_ID);
    const sheet = ss.getSheetByName(NPS_ABA);
    if (!sheet) return saida({ ok: false, erro: 'aba NPS nao encontrada' }, e);

    const valores = sheet.getDataRange().getValues();
    if (valores.length < 2) return saida({ ok: true, total: 0, registros: [] }, e);

    // Colunas por posicao (conforme estrutura do formulario):
    // A(0) nps 0-10 | B(1) medico 0-5 | C(2) enfermagem 0-5
    // D(3) infra 0-5 | E(4) comentario | F(5) data/hora | G(6) token
    const TZ = Session.getScriptTimeZone() || 'America/Sao_Paulo';
    const registros = [];

    for (let i = 1; i < valores.length; i++) {
      const l     = valores[i];
      const token = String(l[6] || '').trim();
      if (!token) continue;   // linha vazia

      let dataStr = '';
      if (l[5] instanceof Date && !isNaN(l[5])) {
        dataStr = Utilities.formatDate(l[5], TZ, 'yyyy-MM-dd');
      } else {
        const s = String(l[5] || '').trim();
        // aceita dd/mm/yyyy ou dd/mm/yyyy HH:MM:SS
        const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) {
          let a = +m[3]; if (a < 100) a += 2000;
          dataStr = a + '-' + pad(+m[2]) + '-' + pad(+m[1]);
        }
      }
      if (!dataStr) continue;

      registros.push({
        nps:        num(l[0]),
        medico:     num(l[1]),
        enfermagem: num(l[2]),
        infra:      num(l[3]),
        comentario: String(l[4] || '').trim(),
        data:       dataStr,
        token:      token
      });
    }

    return saida({ ok: true, total: registros.length, registros: registros }, e);

  } catch (err) {
    return saida({ ok: false, erro: 'NPS: ' + String(err) }, e);
  }
}

/* ---------- config de faixas ---------- */
function lerConfigSalva() {
  const s = PropertiesService.getScriptProperties().getProperty('HSF_CONFIG');
  if (!s) return null;
  try { return JSON.parse(s); } catch (x) { return null; }
}

/* ---------- saida JSON / JSONP ---------- */
function saida(obj, e) {
  const json = JSON.stringify(obj);
  if (e && e.parameter && e.parameter.callback) {
    return ContentService
      .createTextOutput(e.parameter.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- utilitarios ---------- */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

function achar(cab, base, lado) {
  for (let i = 0; i < cab.length; i++) {
    const L = cab[i];
    if (L.indexOf(base) === -1) continue;
    if (lado === 'sf'  && /\bsf\b/.test(L) && L.indexOf('ext') === -1) return i;
    if (lado === 'ext' && L.indexOf('ext') !== -1) return i;
    if (!lado) return i;
  }
  return -1;
}

function num(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function formatarData(v) {
  const TZ = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let a = +m[3]; if (a < 100) a += 2000;
    return a + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  }
  const d = new Date(s);
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

/* ---------- testes rapidos no editor ---------- */
function testarKPI() {
  const r = doGet({ parameter: {} });
  Logger.log(r.getContent().slice(0, 800));
}

function testarNPS() {
  const r = doGet({ parameter: { action: 'nps' } });
  Logger.log(r.getContent().slice(0, 800));
}
