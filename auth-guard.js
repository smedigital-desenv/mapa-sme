/* ============================================================================
   auth-guard.js — PRIMEIRO <script> no <head> de cada página protegida.
   Gate rápido e SÍNCRONO: se não houver sessão do Supabase no localStorage,
   redireciona para login.html guardando o destino. Não valida permissões
   (isso é trabalho do auth.js, que roda depois com o supabase-js carregado).
   ============================================================================ */
(function () {
  var SUPABASE_REF = 'gmwotfulohkmuqrezeef';
  var TOKEN_KEY = 'sb-' + SUPABASE_REF + '-auth-token';

  // Estilo do submenu "Aprendizagem" do cabeçalho (injetado cedo p/ evitar flash).
  try {
    var st = document.createElement('style');
    st.textContent =
      '.mg-dd{position:relative;display:inline-block;}' +
      '.mg-dd-menu{position:absolute;top:100%;left:0;min-width:212px;background:#fff;border-radius:10px;' +
      'box-shadow:0 12px 30px rgba(0,0,0,.25);padding:6px;display:none;z-index:1100;}' +
      '.mg-dd:hover .mg-dd-menu,.mg-dd:focus-within .mg-dd-menu{display:block;}' +
      '.mg-dd-item{display:flex;align-items:center;gap:.5rem;padding:8px 12px;border-radius:8px;' +
      'color:#002b5e;font-weight:800;font-size:.82rem;text-decoration:none;white-space:nowrap;}' +
      '.mg-dd-item:hover{background:#eef4ff;}.mg-dd-item.active{background:#002b5e;color:#fff;}' +
      '.mg-dd-toggle .bi-chevron-down{transition:transform .15s;}' +
      '.mg-dd:hover .mg-dd-toggle .bi-chevron-down{transform:rotate(180deg);}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

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
