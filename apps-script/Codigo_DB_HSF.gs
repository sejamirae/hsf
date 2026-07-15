/* ============================================================
   CODIGO_DB_HSF.GS  —  Backend do BI (planilha "DB HSF")
   ------------------------------------------------------------
   Este script fica NA planilha "DB HSF" (Extensoes > Apps Script).
   Ele centraliza tudo:

     1) Serve os dados de KPI (aba DADOS) para o painel        -> doGet sem action
     2) Serve a lista de medicos Mirae "Porta" (aba MEDICOS)   -> action=medicos
     3) Recebe os numeros processados do upload no BI e grava  -> action=upsert
     4) Serve o NPS (planilha separada, via openById)          -> action=nps
     5) Salva a config de faixas (compartilhada)               -> action=saveConfig

   COMO INSTALAR:
   1. Abra a planilha "DB HSF" -> Extensoes -> Apps Script.
   2. Cole TODO este arquivo. Salve.
   3. No editor, rode UMA vez a funcao  setup()  (cria as abas
      MEDICOS e DADOS com cabecalho e ja semeia os medicos).
      Autorize quando pedir.
   4. Implantar -> Nova implantacao -> App da Web:
        Executar como: Eu   |   Quem tem acesso: Qualquer pessoa
      Copie a URL /exec e cole em js/config.js (API_URL).

   Para atualizar depois: Implantar -> Gerenciar implantacoes ->
   editar (lapis) -> Nova versao -> Implantar (a URL /exec continua).
   ============================================================ */

/* ---------- CONFIGURACAO ---------- */
const ABA_DADOS   = 'DADOS';     // aba-banco dos KPIs diarios
const ABA_MEDICOS = 'MEDICOS';   // lista de medicos Mirae "Porta"
const TOKEN       = '';          // opcional (igual em js/config.js API_TOKEN)

// Planilha de NPS (separada; voce e editor). Mantida aqui para
// o painel continuar lendo NPS pelo mesmo /exec.
const NPS_SHEET_ID = '1hkwTPNkNn5tRlSHwwc3UA_d4CnFQHPywKD34dcwyy2U';
const NPS_ABA      = 'Coleta NPS Médico - PS São Francisco';

// Cabecalho canonico da aba DADOS (ordem fixa de escrita).
const COLS_DADOS = ['Dia', 'Atendimentos SF', 'Atendimentos Externos',
  'Internacoes SF', 'Internacoes Externos', 'Conversao SF (%)', 'Conversao Ext (%)'];

/* ---------- ENDPOINT ---------- */
function doGet(e) {
  try {
    if (TOKEN && (!e || e.parameter.token !== TOKEN)) {
      return saida({ ok: false, erro: 'token invalido' }, e);
    }
    const action = e && e.parameter && e.parameter.action;

    if (action === 'saveConfig') {
      PropertiesService.getScriptProperties().setProperty('HSF_CONFIG', e.parameter.config || '');
      return saida({ ok: true, salvo: true }, e);
    }
    if (action === 'medicos')   return saida({ ok: true, medicos: lerMedicos() }, e);
    if (action === 'upsert')    return upsertDados(e);
    if (action === 'deleteDia') return deleteDia(e);
    if (action === 'nps')       return lerNPS(e);

    return lerDados(e);   // padrao: KPIs para o painel
  } catch (err) {
    return saida({ ok: false, erro: String(err) }, e);
  }
}

/* ---------- 1) LER DADOS (KPI) ---------- */
function lerDados(e) {
  const sheet = planilha().getSheetByName(ABA_DADOS);
  const cfg   = lerConfigSalva();
  if (!sheet || sheet.getLastRow() < 2) return saida({ ok: true, registros: [], config: cfg }, e);

  const valores = sheet.getDataRange().getValues();
  const cab = valores[0].map(norm);
  const idx = {
    dia:    achar(cab, 'dia'),
    atSF:   achar(cab, 'atendiment', 'sf'),
    atExt:  achar(cab, 'atendiment', 'ext'),
    intSF:  achar(cab, 'internac', 'sf'),
    intExt: achar(cab, 'internac', 'ext')
  };
  if (idx.dia < 0) return saida({ ok: false, erro: 'coluna "Dia" nao encontrada na aba DADOS' }, e);

  const registros = [];
  for (let i = 1; i < valores.length; i++) {
    const dia = formatarData(valores[i][idx.dia]);
    if (!dia) continue;
    registros.push({
      dia:    dia,
      atSF:   num(valores[i][idx.atSF]),
      atExt:  num(valores[i][idx.atExt]),
      intSF:  num(valores[i][idx.intSF]),
      intExt: num(valores[i][idx.intExt])
    });
  }
  return saida({ ok: true, total: registros.length, registros: registros, config: cfg }, e);
}

/* ---------- 2) LER MEDICOS (base Mirae "Porta") ---------- */
function lerMedicos() {
  const sheet = planilha().getSheetByName(ABA_MEDICOS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const v = sheet.getDataRange().getValues();
  const cab = v[0].map(norm);
  const iCod = achar(cab, 'codigo');
  const iNom = achar(cab, 'nome');
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const cod  = String(v[i][iCod] == null ? '' : v[i][iCod]).trim();
    const nome = String(v[i][iNom] == null ? '' : v[i][iNom]).trim();
    if (!cod && !nome) continue;
    out.push({ codigo: cod, nome: nome });
  }
  return out;
}

/* ---------- 3) UPSERT DADOS (grava o que o BI processou) ----------
   Recebe e.parameter.dados = JSON:
     [{ "dia":"2026-06-14", "atSF":122, "atExt":260, "intSF":4, "intExt":9 }, ...]
   Para cada dia: atualiza a linha existente ou adiciona uma nova.
   A conversao (%) e calculada e gravada tambem. ------------------- */
function upsertDados(e) {
  let lista;
  try { lista = JSON.parse(e.parameter.dados || '[]'); }
  catch (x) { return saida({ ok: false, erro: 'JSON invalido em "dados"' }, e); }
  if (!Array.isArray(lista) || !lista.length) return saida({ ok: false, erro: 'sem dados' }, e);

  const sheet = garantirDados();
  const valores = sheet.getDataRange().getValues();
  // mapa dia(yyyy-mm-dd) -> numero da linha (1-based)
  const linhaDe = {};
  for (let i = 1; i < valores.length; i++) {
    const d = formatarData(valores[i][0]);
    if (d) linhaDe[d] = i + 1;
  }

  let inseridos = 0, atualizados = 0;
  lista.forEach(r => {
    const dia = String(r.dia || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
    const atSF = +r.atSF || 0, atExt = +r.atExt || 0, intSF = +r.intSF || 0, intExt = +r.intExt || 0;
    const convSF  = atSF  ? +(intSF  / atSF  * 100).toFixed(2) : 0;
    const convExt = atExt ? +(intExt / atExt * 100).toFixed(2) : 0;
    const linhaValores = [dataObj(dia), atSF, atExt, intSF, intExt, convSF, convExt];

    if (linhaDe[dia]) {
      sheet.getRange(linhaDe[dia], 1, 1, COLS_DADOS.length).setValues([linhaValores]);
      atualizados++;
    } else {
      sheet.appendRow(linhaValores);
      linhaDe[dia] = sheet.getLastRow();
      inseridos++;
    }
  });

  ordenarPorData(sheet);
  return saida({ ok: true, inseridos: inseridos, atualizados: atualizados }, e);
}

/* ---------- 3b) EXCLUIR DIA(S) ----------
   Recebe e.parameter.dias = "2026-07-14" ou "2026-07-14,2026-07-15".
   Remove as linhas correspondentes da aba DADOS. ------------------ */
function deleteDia(e) {
  const dias = String((e && e.parameter && e.parameter.dias) || '')
    .split(',').map(s => s.trim().slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dias.length) return saida({ ok: false, erro: 'nenhuma data valida' }, e);
  const alvo = {}; dias.forEach(d => alvo[d] = true);

  const sheet = planilha().getSheetByName(ABA_DADOS);
  if (!sheet || sheet.getLastRow() < 2) return saida({ ok: true, excluidos: 0 }, e);

  const valores = sheet.getDataRange().getValues();
  let excluidos = 0;
  // de baixo para cima, para os indices nao se deslocarem
  for (let i = valores.length - 1; i >= 1; i--) {
    const d = formatarData(valores[i][0]);
    if (d && alvo[d]) { sheet.deleteRow(i + 1); excluidos++; }
  }
  return saida({ ok: true, excluidos: excluidos }, e);
}

/* ---------- 4) NPS (planilha separada) ---------- */
function lerNPS(e) {
  try {
    const ss = SpreadsheetApp.openById(NPS_SHEET_ID);
    const sheet = ss.getSheetByName(NPS_ABA);
    if (!sheet) return saida({ ok: false, erro: 'aba NPS nao encontrada' }, e);
    const valores = sheet.getDataRange().getValues();
    if (valores.length < 2) return saida({ ok: true, total: 0, registros: [] }, e);

    const TZ = Session.getScriptTimeZone() || 'America/Sao_Paulo';
    const registros = [];
    for (let i = 1; i < valores.length; i++) {
      const l = valores[i];
      const token = String(l[6] || '').trim();
      if (!token) continue;
      let dataStr = '';
      if (l[5] instanceof Date && !isNaN(l[5])) {
        dataStr = Utilities.formatDate(l[5], TZ, 'yyyy-MM-dd');
      } else {
        const m = String(l[5] || '').trim().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) { let a = +m[3]; if (a < 100) a += 2000; dataStr = a + '-' + pad(+m[2]) + '-' + pad(+m[1]); }
      }
      if (!dataStr) continue;
      registros.push({
        nps: num(l[0]), medico: num(l[1]), enfermagem: num(l[2]), infra: num(l[3]),
        comentario: String(l[4] || '').trim(), data: dataStr, token: token
      });
    }
    return saida({ ok: true, total: registros.length, registros: registros }, e);
  } catch (err) {
    return saida({ ok: false, erro: 'NPS: ' + String(err) }, e);
  }
}

/* ---------- 5) config de faixas ---------- */
function lerConfigSalva() {
  const s = PropertiesService.getScriptProperties().getProperty('HSF_CONFIG');
  if (!s) return null;
  try { return JSON.parse(s); } catch (x) { return null; }
}

/* ============================================================
   SETUP (rodar UMA vez no editor) — cria as abas e semeia medicos
   ============================================================ */
function setup() {
  garantirDados();
  const med = garantirMedicos();
  // so semeia se ainda estiver vazia (nao sobrescreve edicoes suas)
  if (med.getLastRow() < 2) {
    const base = [
      // [Codigo MV, Nome, Requisito]  — 14 confirmados (ativos em junho/2026)
      ['5481', 'GISELE FERNANDES DE SENA', 'Porta'],
      ['5518', 'LINCON ULLMANN FELIX DE SOUZA', 'Porta'],
      ['5721', 'BRUNA SIQUEIRA BONIFACIO', 'Porta'],
      ['7960', 'ALINE FERREIRA DO PRADO', 'Porta'],
      ['7978', 'YASMIN SILVA DE SALES', 'Porta'],
      ['8008', 'ENRICO RODRIGUES FAJOLI', 'Porta'],
      ['8017', 'NATALIA CAMPOS TUCKUMANTEL', 'Porta'],
      ['8026', 'ANA KARINNE MAGALHAES LIMA JEREMIAS', 'Porta'],
      ['8036', 'RODRIGO OKUBO MORENO', 'Porta'],
      ['8102', 'LUCIANA TEREZA ALVES FERREIRA', 'Porta'],
      ['8108', 'GUILHERME COLOMBO', 'Porta'],
      ['8109', 'ROSALI FERNANDES BOMFIM', 'Porta'],
      ['8112', 'BARBARA PRECHITKO ROSA VIEIRA', 'Porta'],
      ['8222', 'ARY TIBURCIO JUNIOR', 'Porta'],
      // 6 sem codigo (nao atenderam em junho) — preencha o Codigo quando souber
      ['', 'BETHANIA SILVA BARROS', 'Porta'],
      ['', 'DOUGLAS MOREIRA DE SOUZA JUNIOR', 'Porta'],
      ['', 'GIUSEPPE MARTINELLI PUDO', 'Porta'],
      ['', 'MARCIO CONTI TAVARES', 'Porta'],
      ['', 'MARIO ALFREDO PUENTE BALDIVIEZO', 'Porta'],
      ['', 'VITOR DE CARVALHO AUGUSTO SILVA', 'Porta']
    ];
    med.getRange(2, 1, base.length, 3).setValues(base);
  }
}

function garantirDados() {
  const ss = planilha();
  let sh = ss.getSheetByName(ABA_DADOS);
  if (!sh) sh = ss.insertSheet(ABA_DADOS);
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, COLS_DADOS.length).setValues([COLS_DADOS]);
  return sh;
}
function garantirMedicos() {
  const ss = planilha();
  let sh = ss.getSheetByName(ABA_MEDICOS);
  if (!sh) sh = ss.insertSheet(ABA_MEDICOS);
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, 3).setValues([['Codigo MV', 'Nome', 'Requisito']]);
  return sh;
}
function ordenarPorData(sheet) {
  const n = sheet.getLastRow() - 1;
  if (n > 1) sheet.getRange(2, 1, n, sheet.getLastColumn()).sort({ column: 1, ascending: true });
}

/* ---------- saida JSON / JSONP ---------- */
function saida(obj, e) {
  const json = JSON.stringify(obj);
  if (e && e.parameter && e.parameter.callback) {
    return ContentService.createTextOutput(e.parameter.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- utilitarios ---------- */
function planilha() { return SpreadsheetApp.getActiveSpreadsheet(); }

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
function pad(n) { return (n < 10 ? '0' : '') + n; }

function dataObj(yyyymmdd) {
  const p = yyyymmdd.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function formatarData(v) {
  const TZ = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) { let a = +m[3]; if (a < 100) a += 2000; return a + '-' + pad(+m[2]) + '-' + pad(+m[1]); }
  const d = new Date(s);
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/* ---------- testes rapidos no editor ---------- */
function testarDados()   { Logger.log(doGet({ parameter: {} }).getContent().slice(0, 800)); }
function testarMedicos() { Logger.log(doGet({ parameter: { action: 'medicos' } }).getContent().slice(0, 800)); }
function testarNPS()     { Logger.log(doGet({ parameter: { action: 'nps' } }).getContent().slice(0, 400)); }
function testarUpsert()  {
  const d = JSON.stringify([{ dia: '2026-06-14', atSF: 122, atExt: 260, intSF: 4, intExt: 9 }]);
  Logger.log(doGet({ parameter: { action: 'upsert', dados: d } }).getContent());
}
