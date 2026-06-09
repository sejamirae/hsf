/* ============================================================
   AUTH.JS  —  Autenticacao por senha (acesso casual)
   ------------------------------------------------------------
   A senha digitada e convertida em hash SHA-256 no navegador
   e comparada com o hash armazenado em CONFIG.PASSWORD_HASH.
   A senha em texto puro nunca trafega nem fica salva.
   ============================================================ */

const Auth = (() => {

  const SESSION_KEY = "hsf_bi_sessao";

  /* Gera o hash SHA-256 de um texto usando a Web Crypto API */
  async function sha256(texto) {
    const dados = new TextEncoder().encode(texto);
    const buffer = await crypto.subtle.digest("SHA-256", dados);
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /* Sessao ativa nesta aba? (nao persiste entre fechamentos) */
  function sessaoAtiva() {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; }
    catch (e) { return window.__hsfSessao === true; }
  }

  function abrirSessao() {
    try { sessionStorage.setItem(SESSION_KEY, "1"); }
    catch (e) { window.__hsfSessao = true; }
  }

  function encerrarSessao() {
    try { sessionStorage.removeItem(SESSION_KEY); }
    catch (e) { window.__hsfSessao = false; }
    location.reload();
  }

  /* Valida a senha digitada contra o hash configurado */
  async function validar(senha) {
    const hash = await sha256(senha);
    return hash === CONFIG.PASSWORD_HASH;
  }

  /* Inicializa a tela de login e devolve uma Promise que
     resolve quando o usuario entra com sucesso. */
  function iniciar() {
    return new Promise((resolve) => {
      const tela   = document.getElementById("tela-login");
      const form   = document.getElementById("form-login");
      const input  = document.getElementById("input-senha");
      const erro   = document.getElementById("login-erro");
      const botao  = document.getElementById("btn-entrar");

      const liberar = () => {
        tela.classList.add("oculto");
        document.getElementById("app").classList.remove("oculto");
        resolve();
      };

      if (sessaoAtiva()) { liberar(); return; }

      tela.classList.remove("oculto");
      setTimeout(() => input && input.focus(), 350);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        erro.textContent = "";
        botao.disabled = true;
        botao.classList.add("carregando");

        const ok = await validar(input.value.trim());

        botao.disabled = false;
        botao.classList.remove("carregando");

        if (ok) {
          abrirSessao();
          tela.classList.add("saindo");
          setTimeout(liberar, 450);
        } else {
          erro.textContent = "Senha incorreta. Tente novamente.";
          input.value = "";
          input.focus();
          form.classList.remove("tremer");
          void form.offsetWidth;          // reinicia a animacao
          form.classList.add("tremer");
        }
      });
    });
  }

  return { iniciar, encerrarSessao, sha256 };
})();
