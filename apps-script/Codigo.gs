/* ============================================================
   CODIGO.GS  —  API do Hospital Sao Francisco (Google Apps Script)
   ------------------------------------------------------------
   Publica a planilha como uma API JSON, sem deixar a planilha
   publica. O script roda como VOCE (dono) e devolve apenas os
   dados — a planilha continua privada.

   COMO INSTALAR (5 passos):
   1. Abra a planilha -> menu "Extensoes" -> "Apps Script".
   2. Apague o conteudo e cole TODO este arquivo. Salve.
   3. (Opcional) Ajuste ABA e TOKEN no bloco abaixo.
   4. "Implantar" -> "Nova implantacao" -> tipo "App da Web":
        - Executar como:    Eu (seu e-mail)
        - Quem tem acesso:  Qualquer pessoa
      Clique em "Implantar" e AUTORIZE quando pedir.
   5. Copie a URL que termina em "/exec" e cole em js/config.js
      no campo API_URL.

   Para atualizar o codigo depois: "Implantar" -> "Gerenciar
   implantacoes" -> editar (lapis) -> "Nova versao" -> Implantar.
   (Assim a URL /exec continua a mesma.)
   ============================================================ */

/* ---------- CONFIGURACAO ---------- */
const ABA   = 'Dados';   // nome exato da aba. Vazio = primeira aba da planilha.
const TOKEN = '';   // opcional. Se preencher, a URL exige ?token=ESSE_VALOR

/* ---------- ENDPOINT ---------- */
function doGet(e) {
  try {
    if (TOKEN && (!e || e.parameter.token !== TOKEN)) {
      return saida({ ok: false, erro: 'token invalido' }, e);
    }

    // --- salvar configuracao de faixas (compartilhada entre todos) ---
    if (e && e.parameter && e.parameter.action === 'saveConfig') {
      PropertiesService.getScriptProperties().setProperty('HSF_CONFIG', e.parameter.config || '');
      return saida({ ok: true, salvo: true }, e);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ABA ? ss.getSheetByName(ABA) : ss.getSheets()[0];
    if (!sheet) return saida({ ok: false, erro: 'aba nao encontrada' }, e);

    const valores = sheet.getDataRange().getValues();
    const cfg = lerConfigSalva();
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
      const dia = formatarData(linha[idx.dia]);
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

  } catch (err) {
    return saida({ ok: false, erro: String(err) }, e);
  }
}

function lerConfigSalva() {
  const s = PropertiesService.getScriptProperties().getProperty('HSF_CONFIG');
  if (!s) return null;
  try { return JSON.parse(s); } catch (x) { return null; }
}

/* ---------- saida JSON (com suporte a JSONP via ?callback=) ---------- */
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

// acha o indice da coluna pelo significado, tolerante a acentos e ao
// sufixo "(Meta = ...)". lado: 'sf' | 'ext' | undefined
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
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);  // dd/mm/yyyy
  if (m) {
    let a = +m[3]; if (a < 100) a += 2000;
    return a + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  }
  const d = new Date(s);
  return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

/* ---------- teste rapido dentro do editor ---------- */
function testar() {
  const r = doGet({ parameter: {} });
  Logger.log(r.getContent().slice(0, 800));
}
