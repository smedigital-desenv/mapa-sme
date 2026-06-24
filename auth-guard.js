/* Guard de acesso — incluir como PRIMEIRO <script> no <head> de cada página.
   Se não houver sessão válida, manda para login.html guardando o destino. */
(function () {
  try { if (localStorage.getItem('mapa_acesso_v1') === 'ok') return; } catch (e) { return; }
  if (/login\.html$/i.test(location.pathname)) return;
  var aqui = location.pathname.split('/').pop() || 'index.html';
  aqui += location.search + location.hash;
  location.replace('login.html?next=' + encodeURIComponent(aqui));
})();
