# BI Executivo — Hospital São Francisco × Mirae

Dashboard executivo de resultados operacionais, 100% front-end (HTML, CSS, JavaScript e Chart.js), publicável no **GitHub Pages** e alimentado por uma planilha **Google Sheets**. Sem backend, sem banco de dados.

A planilha é lida **uma única vez** ao abrir o painel; todos os filtros (período, visualização, origem, busca, ordenação) rodam **localmente em memória**, sem novas chamadas à internet.

---

## 1. Como publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `hsf-bi`).
2. Envie **todos os arquivos** mantendo a estrutura de pastas:

   ```
   index.html
   css/style.css
   js/config.js
   js/auth.js
   js/data.js
   js/dashboard.js
   assets/logo-mirae.png
   assets/logo-hsf.png
   README.md
   apps-script/Codigo.gs   (NÃO vai para o site — é colado na planilha)
   ```

   Pelo terminal:

   ```bash
   git init
   git add .
   git commit -m "BI HSF x Mirae"
   git branch -M main
   git remote add origin https://github.com/SUA-CONTA/hsf-bi.git
   git push -u origin main
   ```

3. No GitHub: **Settings → Pages → Branch: `main` / pasta `/root` → Save**.
4. Em ~1 minuto o painel estará em `https://SUA-CONTA.github.io/hsf-bi/`.

> Enquanto o Google Sheets não estiver configurado, o painel abre automaticamente em **modo demonstração** (90 dias de dados fictícios), para que você valide o layout antes de conectar os dados reais.

---

## 2. Como conectar o Google Sheets

A planilha precisa ter, na primeira linha, os cabeçalhos:

| Dia | Atendimentos SF | Atendimentos Externos | Internações SF | Internações Externos | Conversão SF (Meta = 2%) | Conversão Ext (Meta = 10%) |
|-----|-----------------|-----------------------|----------------|----------------------|--------------------------|----------------------------|

A coluna **Dia** deve estar em formato de data. As colunas de **Conversão** são opcionais — o painel **recalcula** a conversão como `Internações ÷ Atendimentos` para garantir consistência entre dias, semanas e meses.

### Opção A — API via Apps Script (recomendada)

A planilha continua **privada**; o Web App roda como você e expõe apenas o JSON.

1. Na planilha: **Extensões → Apps Script**.
2. Apague o conteúdo e cole todo o arquivo `apps-script/Codigo.gs`. Salve.
3. (Opcional) Ajuste `ABA` (nome da aba) e `TOKEN` no topo do script.
4. **Implantar → Nova implantação → tipo "App da Web"**:
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
   - Clique em **Implantar** e **autorize** quando solicitado.
5. Copie a URL terminada em **`/exec`** e cole em `js/config.js`:

   ```js
   API_URL: "https://script.google.com/macros/s/AKfy.../exec",
   API_TOKEN: "",        // só se definiu TOKEN no Codigo.gs
   API_JSONP: false      // mude para true se o navegador bloquear por CORS
   ```

6. `git push`. O badge no topo passa a exibir **"Dados ao vivo · API Google Sheets"**.

> Para alterar o código depois mantendo a mesma URL: **Implantar → Gerenciar implantações → editar → Nova versão → Implantar**.

### Opção B — leitura direta (planilha pública)

1. Em **Compartilhar**, defina **"Qualquer pessoa com o link pode ver"**.
2. Copie o ID da URL `docs.google.com/spreadsheets/d/[ID]/edit`.
3. Em `js/config.js`, preencha `GOOGLE_SHEET_ID` e `SHEET_NAME` (deixe `API_URL` vazio).

> A equipe operacional só edita a planilha; o painel reflete os dados a cada carregamento da página.

---

## 3. Como trocar a senha

A senha de acesso (padrão **`131154`**) nunca é guardada em texto puro — apenas o seu **hash SHA-256**.

1. Gere o hash da nova senha em qualquer ferramenta SHA-256, por exemplo:
   `https://emn178.github.io/online-tools/sha256.html`
2. Copie o resultado e cole em `js/config.js`:

   ```js
   PASSWORD_HASH: "novo_hash_sha256_aqui"
   ```

> A autenticação serve apenas para evitar acesso casual; não é uma camada de segurança forte.

---

## 4. Como trocar os logos

Substitua os arquivos em `assets/`, mantendo os nomes:

- `assets/logo-mirae.png`
- `assets/logo-hsf.png`

Formato recomendado: PNG com fundo transparente. O CSS já redimensiona a altura automaticamente.

---

## 5. Como adicionar filtros

Os filtros de **Origem** (Ambos / São Francisco / Externos) já são dinâmicos sobre as colunas existentes.
Para acrescentar um novo botão de período, edite `index.html` dentro de `.filtro-btns`:

```html
<button class="btn-periodo" data-periodo="minha-chave">Meu período</button>
```

E trate a `minha-chave` na função `filtrarPeriodo` de `js/data.js`.
Se a planilha ganhar novas colunas categóricas (ex.: Convênio, Médico, Unidade), crie um novo grupo de botões e um seletor equivalente ao `categoria` em `js/dashboard.js`.

---

## 6. Como criar novos indicadores

**Novo KPI** — em `js/dashboard.js`, função `renderKPIs()`, adicione um card ao array `cards` usando os helpers prontos:

```js
kpi("Meu indicador", valorCalculado, "", "texto auxiliar");
kpiMeta("Conversão X", valor, metaEmPorcento);   // com status de meta
kpiVar("Crescimento X", percentual, "comparação");// com seta de alta/baixa
```

**Novo gráfico** — adicione um `<canvas id="g-meu">` em `index.html` e, em `renderGraficos()`, chame:

```js
criar("g-meu", "line", labels, [ linha("Série", dados, "#D7B377", true) ]);
// helpers disponíveis: linha(), barra(), metaLinha()
```

---

## Estrutura técnica

| Arquivo            | Responsabilidade                                                        |
|--------------------|-------------------------------------------------------------------------|
| `js/config.js`     | Único ponto de configuração: planilha, senha, metas, cores, colunas.    |
| `js/auth.js`       | Tela de login e validação por hash SHA-256 (Web Crypto API).            |
| `js/data.js`       | Leitura da planilha (gviz), normalização, agregação e modo demonstração.|
| `js/dashboard.js`  | KPIs, 7 gráficos (Chart.js), tabela analítica, filtros e exportação.    |
| `css/style.css`    | Tema executivo dark, glassmorphism, identidade Mirae/HSF.               |

**KPIs:** Atendimentos · Internações · Conversão SF (vs meta 2%) · Conversão Ext (vs meta 10%) · Média Diária · Melhor/Pior Dia · Crescimento Semanal · Crescimento Mensal.

**Gráficos:** evolução de atendimentos (linha), internações (barras), conversão × meta (linha), comparativo semanal (barras agrupadas), distribuição SF × Externos (donut), ranking (barra horizontal), tendência acumulada (área).

---

*Painel confidencial. Uso interno Hospital São Francisco / Mirae.*
