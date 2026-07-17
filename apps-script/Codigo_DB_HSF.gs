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
    if (action === 'medicos')      return saida({ ok: true, medicos: lerMedicos() }, e);
    if (action === 'upsertMedico') return upsertMedico(e);
    if (action === 'deleteMedico') return deleteMedico(e);
    if (action === 'upsert')       return upsertDados(e);
    if (action === 'deleteDia')    return deleteDia(e);
    if (action === 'nps')          return lerNPS(e);

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

/* ---------- 2) LER MEDICOS (corpo clinico) ---------- */
function idxMedicos(cab) {
  return {
    id:   achar(cab, 'id'),
    nome: achar(cab, 'nome'),
    crm:  achar(cab, 'crm'),
    contato: achar(cab, 'contato'),
    codigo:  achar(cab, 'codigo'),
    requisito: achar(cab, 'requisito')
  };
}
function lerMedicos() {
  const sheet = garantirMedicos();
  if (sheet.getLastRow() < 2) return [];
  const v = sheet.getDataRange().getValues();
  const ix = idxMedicos(v[0].map(norm));
  const cel = (row, i) => i < 0 ? '' : String(row[i] == null ? '' : row[i]).trim();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const nome = cel(v[i], ix.nome), cod = cel(v[i], ix.codigo);
    if (!nome && !cod) continue;
    out.push({
      id: cel(v[i], ix.id), nome: nome, crm: cel(v[i], ix.crm),
      contato: cel(v[i], ix.contato), codigo: cod, requisito: cel(v[i], ix.requisito)
    });
  }
  return out;
}

/* ---------- 2b) SALVAR/EXCLUIR MEDICO (edicao pelo painel) ---------- */
function upsertMedico(e) {
  const p = (e && e.parameter) || {};
  const nome = String(p.nome || '').trim();
  if (!nome && !String(p.codigo || '').trim()) return saida({ ok: false, erro: 'informe ao menos o nome' }, e);
  const sheet = garantirMedicos();
  const v = sheet.getDataRange().getValues();
  const ix = idxMedicos(v[0].map(norm));
  let id = String(p.id || '').trim();
  const linha = new Array(6).fill('');
  linha[ix.nome] = nome;
  if (ix.crm >= 0)       linha[ix.crm] = String(p.crm || '').trim();
  if (ix.contato >= 0)   linha[ix.contato] = String(p.contato || '').trim();
  if (ix.codigo >= 0)    linha[ix.codigo] = String(p.codigo || '').trim();
  if (ix.requisito >= 0) linha[ix.requisito] = String(p.requisito || '').trim();

  let rowNum = -1;
  if (id) for (let i = 1; i < v.length; i++) if (String(v[i][ix.id]).trim() === id) { rowNum = i + 1; break; }
  if (rowNum < 0) { id = Utilities.getUuid(); }
  linha[ix.id] = id;

  if (rowNum > 0) sheet.getRange(rowNum, 1, 1, 6).setValues([linha]);
  else            sheet.appendRow(linha);
  return saida({ ok: true, id: id }, e);
}
function deleteMedico(e) {
  const id = String((e && e.parameter && e.parameter.id) || '').trim();
  if (!id) return saida({ ok: false, erro: 'sem id' }, e);
  const sheet = garantirMedicos();
  const v = sheet.getDataRange().getValues();
  const ix = idxMedicos(v[0].map(norm));
  for (let i = v.length - 1; i >= 1; i--) {
    if (String(v[i][ix.id]).trim() === id) { sheet.deleteRow(i + 1); return saida({ ok: true, excluido: true }, e); }
  }
  return saida({ ok: true, excluido: false }, e);
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
const COLS_MEDICOS = ['ID', 'Nome', 'CRM', 'Contato', 'Codigo MV', 'Requisito'];

// Corpo clinico (50). Literal: [Nome, Codigo MV, Contato, Requisito]
const SEED_CORPO_CLINICO = [
  ['ALAN DE SA MOREIRA JUNIOR', '', '63 9112-4923', ''],
  ['ALEX AGUILAR FLORES', '', '11 98333-0209', ''],
  ['ALINE FERREIRA DO PRADO', '7960', '(11) 93939-2797', 'Apenas Porta'],
  ['ANA KARINNE MAGALHAES LIMA JEREMIAS', '8026', '(17) 99280-3892', 'Chefe + Porta'],
  ['ARY TIBURCIO JUNIOR', '8222', '12 97402-1200', 'Chefe + Porta'],
  ['BARBARA PRECHITKO ROSA VIEIRA', '8112', '19 97818-9250', 'Apenas Porta'],
  ['BETHANIA SILVA BARROS', '', '11 91466-5501', 'Apenas Porta'],
  ['BRUNA SIQUEIRA BONIFACIO', '5721', '11 99336-6064', 'Apenas Porta'],
  ['DEBORA FIGUEREDO DE MELO', '', '11 94755-5693', ''],
  ['DESIREE ALMEIDA TRIGUEIRO', '', '83 9631-9476', ''],
  ['DOUGLAS MOREIRA DE SOUZA JUNIOR', '', '19 97817-6476', 'Apenas Porta'],
  ['ENRICO RODRIGUES FAJOLI', '8008', '31 8311-4892', 'Apenas Porta'],
  ['FABIOLA NAKAD DOS SANTOS', '8220', '74 8145-1882', ''],
  ['FERNANDO ORTUNO RODRIGUEZ', '', '11 94720-6768', ''],
  ['GISELE FERNANDES DE SENA', '5481', '11 96188-6719', 'Apenas Porta'],
  ['GIUSEPPE MARTINELLI PUDO', '', '11 96922-1717', 'Apenas Porta'],
  ['GUILHERME COLOMBO', '8108', '17 99673-4445', 'Apenas Porta'],
  ['GUILHERME SANTOS SALLES', '8111', '43 8479-9537', ''],
  ['IGOR SILVA MACHADO', '', '11 97454-0382', ''],
  ['ISABELA CAROLINNIE MORAIS DE ARRUDA', '', '84 9103-6497', ''],
  ['JONATHAN ROZEMBERG', '', '11 91289-1703', ''],
  ['JULIA REHBAIM', '', '11 97567-6446', ''],
  ['LETHICIA ALTINA PRADO DA SILVA', '', '67 9924-5458', ''],
  ['LINCON ULLMANN FELIX DE SOUZA', '5518', '11 94300-9636', 'Apenas Porta'],
  ['LUCIANA TEREZA ALVES FERREIRA', '8102', '11 95222-5300', 'Apenas Porta'],
  ['LUIS ALEXANDRE LIRA DE CASTRO', '', '92 8214-0876', ''],
  ['LUIS MARCELO GUAZZELLI RODRIGUES', '', '11 94299-1600', ''],
  ['LUIZ FABIANO LOPES', '', '67 9327-7498', ''],
  ['MARAINE KALLITA CRUZ RODRIGUES SILVESTRE', '', '11 96618-2161', ''],
  ['MARCELO VIANNA PAGLIA', '', '11 98188-8100', ''],
  ['MARCIA LEITE SOARES DA SILVA', '', '11 94991-3386', ''],
  ['MARCIO CONTI TAVARES', '', '11 93380-3311', 'Chefe + Porta'],
  ['MARCOS FLAVIO SILVA DE ALMEIDA', '', '92 9150-4018', ''],
  ['MARESSA CAROLINA VIEIRA SANTOS SOUSA', '', '18 99775-1995', ''],
  ['MARIA CLARA TOSATTO SILVA', '', '11 98686-2916', ''],
  ['MARIO ALFREDO PUENTE BALDIVIEZO', '', '11 98897-8558', 'Apenas Porta'],
  ['MAYARA LAGUNA CAVALCANTI', '', '11 94013-4585', ''],
  ['MIGUEL NILO SENA RIBEIRO', '', '11 97272-1562', ''],
  ['MONICA MAMANI VALDEZ', '8101', '11 93315-2726', ''],
  ['NATALIA CAMPOS TUCKUMANTEL', '8017', '19 99630-8335', 'Apenas Porta'],
  ['NATALIA RIVERA MEDRANO', '7085', '', ''],
  ['RODRIGO OKUBO MORENO', '8036', '15 98175-4321', 'Chefe + Porta'],
  ['ROSALI FERNANDES BOMFIM', '8109', '11 97132-7218', 'Chefe + Porta'],
  ['SERGIO LOZANO MUSTAFA', '', '11 97659-6596', ''],
  ['THAIS PESQUEIRA RODRIGUES', '', '11 96583-6953', ''],
  ['THIAGO PONTES DE OLIVEIRA CESAR', '', '24 99225-4153', ''],
  ['VANESSA MARINHO ALVES', '', '11 98771-8563', ''],
  ['VITOR DE CARVALHO AUGUSTO SILVA', '', '11 98788-8439', 'Chefe + Porta'],
  ['WILLIAM CESAR DE MATOS SILVESTRE', '', '11 99293-6226', ''],
  ['YASMIN SILVA DE SALES', '7978', '18 99745-4155', 'Apenas Porta']
];

function setup() {
  garantirDados();
  const med = garantirMedicos();
  if (med.getLastRow() < 2) semearCorpoClinico(med);   // so semeia se vazia
}

/* Recria a aba MEDICOS com o corpo clinico completo (50).
   Rode UMA vez apos migrar do esquema antigo. Substitui o conteudo atual. */
function reseedCorpoClinico() {
  const med = garantirMedicos();
  if (med.getLastRow() > 1) med.getRange(2, 1, med.getLastRow() - 1, med.getMaxColumns()).clearContent();
  semearCorpoClinico(med);
}
function semearCorpoClinico(med) {
  const linhas = SEED_CORPO_CLINICO.map(x => [Utilities.getUuid(), x[0], '', x[2], x[1], x[3]]);
  med.getRange(2, 1, linhas.length, COLS_MEDICOS.length).setValues(linhas);
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
  const precisaCab = sh.getLastRow() < 1 || norm(sh.getRange(1, 1).getValue()) !== 'id';
  if (precisaCab) sh.getRange(1, 1, 1, COLS_MEDICOS.length).setValues([COLS_MEDICOS]);
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
