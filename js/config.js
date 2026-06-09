/* ============================================================
   CONFIG.JS  —  Configuracao central do dashboard
   Hospital Sao Francisco (HSF) x Mirae
   ------------------------------------------------------------
   Edite APENAS este arquivo para conectar a sua planilha.
   ============================================================ */

const CONFIG = {
  /* --- Conexao com os dados ---------------------------------
     OPCAO A (RECOMENDADA) — API via Apps Script:
       A planilha continua PRIVADA. Cole aqui a URL "/exec" do
       Web App publicado (veja apps-script/Codigo.gs).
       Se preencher API_URL, esta opcao tem prioridade. */
  API_URL:   "https://script.google.com/macros/s/AKfycbwSoIsWkOOaRNARZQwHkaOPhJcoDs3m-Yg1pru9kDESSuqqkTIj_U93vZZtjN6TL-jM/exec",
  API_TOKEN: "",                // opcional, igual ao TOKEN definido no Codigo.gs
  API_JSONP: false,             // mude para true se o navegador bloquear por CORS

  /* OPCAO B — leitura direta via Google Visualization API:
     1. Abra sua planilha no Google Sheets.
     2. Em "Compartilhar", deixe "Qualquer pessoa com o link pode ver".
     3. Copie o ID da URL:
        docs.google.com/spreadsheets/d/[ESTE_ID_AQUI]/edit
     4. Cole o ID abaixo e informe o nome da aba (SHEET_NAME).
     Sem nenhuma das opcoes -> DADOS DE DEMONSTRACAO. */
  GOOGLE_SHEET_ID: "",          // ex.: "1AbC...XyZ"
  SHEET_NAME: "",               // ex.: "Base" (nome exato da aba)

  /* --- Seguranca (acesso casual) ---------------------------
     Hash SHA-256 da senha. A senha NUNCA fica em texto puro.
     Senha atual: 131154
     Para trocar a senha, gere um novo hash em
     https://emn178.github.io/online-tools/sha256.html
     e cole o resultado abaixo. */
  PASSWORD_HASH: "bf5af652864726d0ee31246e7e7b2febcb0bb8d6251324b990d8c5ab2e9aa7bd",

  /* --- Metas operacionais (em %) --------------------------- */
  META_CONVERSAO_SF: 2,         // Meta de conversao Sao Francisco
  META_CONVERSAO_EXT: 10,       // Meta de conversao Externos

  /* --- Mapeamento de colunas da planilha -------------------
     A chave da esquerda e o nome interno usado pelo sistema.
     O valor da direita e o cabecalho EXATO na sua planilha.
     Se renomear uma coluna na planilha, ajuste aqui. */
  COLUNAS: {
    dia:              "Dia",
    atendimentosSF:   "Atendimentos SF",
    atendimentosExt:  "Atendimentos Externos",
    internacoesSF:    "Internacoes SF",
    internacoesExt:   "Internacoes Externos",
    conversaoSF:      "Conversao SF (Meta = 2%)",
    conversaoExt:     "Conversao Ext (Meta = 10%)"
  },

  /* --- Comportamento --------------------------------------- */
  VISAO_INICIAL: "diario",      // mantido para compatibilidade; o painel deriva a visao do periodo
  PERIODO_INICIAL: "semana",    // semana | mes | custom
  INICIO_SEMANA: 0,             // 0 = domingo, 1 = segunda-feira
  ITENS_POR_PAGINA: 10,

  /* --- Identidade visual ----------------------------------- */
  CORES: {
    fundo:    "#FFFFFF",
    card:     "#FFFFFF",
    dourado:  "#D7B377",
    branco:   "#FFFFFF",
    cinza:    "#5A7280",
    alerta:   "#C03540",
    sucesso:  "#2E8C66"
  }
};
