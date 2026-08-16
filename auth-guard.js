/* ============================================================================
   auth-guard.js — PRIMEIRO <script> no <head> de cada página protegida.
   ----------------------------------------------------------------------------
   O acesso ao MAPA agora é governado PELO CENTRAL (login + telas), igual ao
   GOM: não existe mais um login próprio do MAPA. Este arquivo só faz o GATE
   VISUAL imediato (cobre a página com um overlay "Verificando acesso..." antes
   de qualquer conteúdo aparecer), para não haver flash de tela protegida.
   A verificação de verdade (sessão + permissões via central) é feita pelo
   auth.js, que roda depois (ele que remove este gate quando terminar).
   ============================================================================ */
(function () {
  // Estilo do submenu "Aprendizagem" do cabeçalho (injetado cedo p/ evitar flash).
  try {
    var st = document.createElement('style');
    st.textContent =
      '.mg-dd{position:relative;display:inline-block;}' +
      // max-height + rolagem: o submenu de Aprendizagem tem 8 itens e, em tela
      // baixa, os últimos ficavam fora da janela sem forma de alcançá-los.
      '.mg-dd-menu{position:absolute;top:100%;left:0;min-width:212px;background:#fff;border-radius:10px;' +
      'box-shadow:0 12px 30px rgba(0,0,0,.25);padding:6px;display:none;z-index:1100;' +
      'max-height:calc(100vh - 90px);overflow-y:auto;overscroll-behavior:contain;}' +
      '.mg-dd:hover .mg-dd-menu,.mg-dd:focus-within .mg-dd-menu{display:block;}' +
      '.mg-dd-item{display:flex;align-items:center;gap:.5rem;padding:8px 12px;border-radius:8px;' +
      'color:#002b5e;font-weight:800;font-size:.82rem;text-decoration:none;white-space:nowrap;}' +
      // O realce do item sob o cursor precisa ser visível: #eef4ff sobre branco
      // é quase imperceptível, e sem ele não dá para saber o que se vai clicar.
      // A barra à esquerda existe porque a cor sozinha não serve a quem não a
      // distingue. O item ATIVO também reage — senão a linha da tela atual
      // parece morta justo quando o cursor está nela.
      '.mg-dd-item:hover,.mg-dd-item:focus-visible{background:#dbeafe;color:#002b5e;' +
      'box-shadow:inset 3px 0 0 #00b8d4;outline:none;}' +
      '.mg-dd-item.active{background:#002b5e;color:#fff;}' +
      '.mg-dd-item.active:hover,.mg-dd-item.active:focus-visible{background:#014a91;color:#fff;}' +
      '.mg-dd-toggle .bi-chevron-down{transition:transform .15s;}' +
      '.mg-dd:hover .mg-dd-toggle .bi-chevron-down{transform:rotate(180deg);}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  // A própria login.html (agora só uma ponte para o central) não precisa do gate.
  if (/login\.html$/i.test(location.pathname)) return;

  function overlay() {
    var o = document.getElementById('mapaAcessoOverlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'mapaAcessoOverlay';
      o.setAttribute('aria-live', 'polite');
      o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#002b5e,#075f82);'
        + 'display:flex;align-items:center;justify-content:center;padding:20px;';
      o.innerHTML =
        '<div style="width:min(430px,92vw);background:#fff;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.35);padding:34px 30px;text-align:center;">'
        + '<div class="spinner-border text-primary" role="status" style="width:2.6rem;height:2.6rem;border-color:#002b5e transparent #002b5e #002b5e"></div>'
        + '<h3 style="font-weight:900;color:#002b5e;margin:18px 0 6px;font-size:1.25rem;font-family:Inter,sans-serif;">Verificando acesso...</h3>'
        + '<p style="color:#64748b;margin:0;font-size:.94rem;line-height:1.45;font-family:Inter,sans-serif;">Controle de acesso central da SME.</p>'
        + '</div>';
      (document.body || document.documentElement).appendChild(o);
    }
    return o;
  }

  // Cobre a página imediatamente (antes do <body> terminar de montar).
  try {
    document.documentElement.classList.add('mapa-auth-gate');
    overlay();
  } catch (e) {}

  // Se o <body> ainda não existia quando rodamos, garante o overlay assim que existir.
  document.addEventListener('DOMContentLoaded', function () {
    try { overlay(); } catch (e) {}
  });

  // Removido pelo auth.js quando a verificação (central) terminar.
  window.__mapaGateOff = function () {
    try { document.documentElement.classList.remove('mapa-auth-gate'); } catch (e) {}
    var o = document.getElementById('mapaAcessoOverlay');
    if (o) o.remove();
  };
})();
