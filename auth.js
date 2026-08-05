/* ============================================================================
   auth.js — PONTE para o Controle de Acesso CENTRAL da rede SME.
   ----------------------------------------------------------------------------
   O login e as permissões (quais telas o usuário vê) passam a ser governados
   INTEIRAMENTE pelo central (window.AcessoSME, servido em /central/). Não
   existe mais um login próprio do MAPA — mesmo entrando direto pela URL do
   MAPA, sem sessão no central, a pessoa é levada para /central/login.html.

   Os DADOS continuam no Supabase do MAPA (mesmo projeto de sempre). Este
   arquivo mantém window.MapaAuth e window.MAPA_SB com a MESMA forma de antes,
   para que todas as páginas continuem funcionando sem precisar de alterações.

   API pública (window.MapaAuth) — inalterada:
     .pronto            -> Promise que resolve quando a auth terminou
     .perfil            -> { id, nome, email, tipo, is_super_admin }
     .escolas           -> [{ id, nome, vinculo }]
     .sistema           -> objeto do sistema atual (slug, nome, telas...)
     .can(tela, acao)   -> bool  (acao: 'ver'|'editar'|'exportar', padrão 'ver')
     .token()           -> Promise<access_token atual (do CENTRAL)>
     .authFetch(url,opt)-> fetch com Authorization do usuário
     .signOut()         -> encerra sessão (no central) e volta ao login
   Evento disparado quando pronto: 'mapa-auth-pronto' (document).
   ============================================================================ */
(function () {
  // Config do Supabase do MAPA (mesmo projeto de sempre) — só para DADOS.
  var MAPA_CFG = {
    url: 'https://gmwotfulohkmuqrezeef.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtd290ZnVsb2hrbXVxcmV6ZWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTQxODYsImV4cCI6MjA5NzA5MDE4Nn0.6qjrT9Nux_0_Z5oH9ndpcCcJxzfO59VuXjhggVXSOFk'
  };
  var SISTEMA_SLUG = window.MAPA_SISTEMA || 'mapa';

  function normEscola(s) {
    return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function baseEscola(s) { return normEscola(String(s || '').split(',')[0]); }

  function gateOff() { try { if (window.__mapaGateOff) window.__mapaGateOff(); } catch (e) {} }

  function overlayErro(msg) {
    gateOff();
    try {
      var o = document.getElementById('mapaAcessoOverlay') || document.body;
      var div = document.createElement('div');
      div.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#002b5e,#075f82);'
        + 'display:flex;align-items:center;justify-content:center;padding:20px;';
      div.innerHTML =
        '<div style="width:min(430px,92vw);background:#fff;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.35);padding:34px 30px;text-align:center;font-family:Inter,sans-serif;">'
        + '<i class="bi bi-shield-exclamation" style="font-size:2.4rem;color:#dc2626;"></i>'
        + '<h3 style="font-weight:900;color:#002b5e;margin:14px 0 6px;font-size:1.2rem;">Acesso indisponível</h3>'
        + '<p style="color:#64748b;margin:0 0 16px;font-size:.94rem;line-height:1.45;">' + (msg || 'Não foi possível carregar o controle de acesso central.') + '</p>'
        + '<a href="/central/login.html" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#002b5e;color:#fff;font-weight:700;text-decoration:none;">Ir para o login</a>'
        + '</div>';
      (document.body || document.documentElement).appendChild(div);
    } catch (e) {}
  }

  function carregarScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Marca o sistema ANTES de carregar o módulo central.
  window.ACESSO_SISTEMA = SISTEMA_SLUG;
  window.ACESSO_LOGIN = '/central/login.html';

  // Stub inicial: código que leia MapaAuth antes do central ficar pronto não quebra.
  window.MapaAuth = window.MapaAuth || {
    perfil: null, escolas: [], sistema: null, restritoEscola: false,
    escolasNomes: [], escolasBases: [],
    can: function () { return false; },
    podeVerEscola: function () { return true; },
    filtrarEscolas: function (rows) { return rows || []; }
  };

  (async function () {
    try {
      await carregarScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      // window.MAPA_SB: cliente do Supabase do MAPA, só para DADOS (sem sessão
      // própria — o login é 100% do central). Mantido pelo mesmo nome de antes
      // para as páginas que já o usam (frequencia, gerência-liminar, relatórios).
      window.MAPA_SB = window.supabase.createClient(MAPA_CFG.url, MAPA_CFG.anonKey);

      await carregarScript('/central/config.js');
      await carregarScript('/central/acesso-sme.js');
    } catch (e) {
      overlayErro('Falha ao carregar os módulos de acesso. Recarregue a página.');
      return;
    }

    var A = window.AcessoSME;
    if (!A || !A.pronto) {
      overlayErro('O módulo de acesso central não carregou.');
      return;
    }

    var apiCentral;
    try { apiCentral = await A.pronto; }
    catch (e) { overlayErro('Não foi possível verificar seu acesso no central.'); return; }

    // Sem perfil = já foi redirecionado (login) ou já mostrou "sem acesso"
    // (telaSemAcesso substituiu a página inteira). Nada mais a fazer aqui.
    if (!apiCentral || !A.perfil) return;

    // ── Monta window.MapaAuth a partir do AcessoSME (mesma forma de antes) ──
    var api = window.MapaAuth;
    api.perfil = A.perfil;
    api.escolas = A.escolas || [];
    api.escolasNomes = api.escolas.map(function (e) { return normEscola(e.nome); }).filter(Boolean);
    api.escolasBases = api.escolas.map(function (e) { return baseEscola(e.nome); }).filter(Boolean);
    api.restritoEscola = !(api.perfil && api.perfil.is_super_admin) && api.escolasNomes.length > 0;
    api.sistema = A.sistema;
    api.can = function (tela, acao) { return A.can(tela, acao); };
    api.podeVerEscola = function (nome) {
      if (!this.restritoEscola) return true;
      var n = normEscola(nome); if (!n) return false;
      if (this.escolasNomes.indexOf(n) !== -1) return true;
      var nb = baseEscola(nome);
      for (var i = 0; i < this.escolasBases.length; i++) {
        var b = this.escolasBases[i];
        if (b && (b === nb || nb.indexOf(b) === 0 || b.indexOf(nb) === 0)) return true;
      }
      return false;
    };
    api.filtrarEscolas = function (rows, getNome) {
      if (!this.restritoEscola) return rows || [];
      var self = this;
      return (rows || []).filter(function (r) { return self.podeVerEscola(getNome ? getNome(r) : r); });
    };
    api.token = function () { return A.token(); };
    api.authFetch = function (url, opt) { return A.authFetch(url, opt); };
    api.signOut = function () { return A.signOut(); };
    api.simulando = A.simulando || null;
    api.realPerfil = A.realPerfil || null;
    api.simular = function (email) { return A.simular(email); };
    api.pararSimulacao = function () { return A.pararSimulacao(); };
    api.pronto = Promise.resolve(api);

    gateOff();
    document.dispatchEvent(new CustomEvent('mapa-auth-pronto', { detail: api }));
  })();
})();
