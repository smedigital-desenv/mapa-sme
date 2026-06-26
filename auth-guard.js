/* ============================================================================
   auth-guard.js — PRIMEIRO <script> no <head> de cada página protegida.
   Gate rápido e SÍNCRONO: se não houver sessão do Supabase no localStorage,
   redireciona para login.html guardando o destino. Não valida permissões
   (isso é trabalho do auth.js, que roda depois com o supabase-js carregado).
   ============================================================================ */
(function () {
  var SUPABASE_REF = 'gmwotfulohkmuqrezeef';
  var TOKEN_KEY = 'sb-' + SUPABASE_REF + '-auth-token';

  // Não protege a própria tela de login.
  if (/login\.html$/i.test(location.pathname)) return;

  var temSessao = false;
  try {
    var raw = localStorage.getItem(TOKEN_KEY);
    if (raw) {
      var s = JSON.parse(raw);
      // sessão válida se tem access_token e (sem expiração OU ainda não expirou)
      temSessao = !!(s && s.access_token &&
        (!s.expires_at || s.expires_at * 1000 > Date.now()));
    }
  } catch (e) { temSessao = false; }

  if (!temSessao) {
    var aqui = (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
    location.replace('login.html?next=' + encodeURIComponent(aqui));
  }
})();
