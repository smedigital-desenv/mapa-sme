/* ============================================================================
   auth.js — Biblioteca de autenticação/autorização compartilhada.
   Incluir DEPOIS do supabase-js, em qualquer página protegida.

   O que faz:
     1. Garante o cliente Supabase.
     2. Confirma a sessão (senão -> login.html).
     3. Busca as permissões do usuário via RPC minhas_permissoes()
        (cacheadas em sessionStorage p/ poupar egress do free tier).
     4. Verifica acesso AO SISTEMA atual (window.MAPA_SISTEMA, padrão 'mapa');
        sem perfil/sem papel -> tela "sem acesso".
     5. Esconde links de telas que o usuário não pode ver (data-tela="slug").
     6. Expõe window.MapaAuth para o resto da página.

   API pública (window.MapaAuth):
     .pronto            -> Promise que resolve quando a auth terminou
     .perfil            -> { id, nome, email, tipo, is_super_admin }
     .escolas           -> [{ id, nome, vinculo }]
     .sistema           -> objeto do sistema atual (slug, nome, telas...)
     .can(tela, acao)   -> bool  (acao: 'ver'|'editar'|'exportar', padrão 'ver')
     .token()           -> Promise<access_token atual>
     .authFetch(url,opt)-> fetch com Authorization do usuário (p/ RLS na fase 2)
     .signOut()         -> encerra sessão e volta ao login
   ============================================================================ */
(function () {
  var CFG = {
    url: 'https://gmwotfulohkmuqrezeef.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtd290ZnVsb2hrbXVxcmV6ZWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTQxODYsImV4cCI6MjA5NzA5MDE4Nn0.6qjrT9Nux_0_Z5oH9ndpcCcJxzfO59VuXjhggVXSOFk'
  };
  var SISTEMA_SLUG = window.MAPA_SISTEMA || 'mapa';
  var CACHE_KEY = 'MAPA_PERMS_v1';

  function telaAtual() {
    var f = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/i, '');
    return f === 'index' ? null : f;   // index = portal do sistema, sem tela específica
  }

  function carregarSupabaseJs() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = resolve; s.onerror = function () { reject(new Error('Falha ao carregar supabase-js')); };
      document.head.appendChild(s);
    });
  }

  function irParaLogin() {
    var aqui = (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
    location.replace('login.html?next=' + encodeURIComponent(aqui));
  }

  function telaSemAcesso(msg) {
    document.documentElement.innerHTML =
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">' +
      '<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet"></head>' +
      '<body style="font-family:Inter,sans-serif;background:#f0f4f8;min-height:100vh;display:grid;place-items:center;margin:0;padding:1rem">' +
      '<div style="background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.12);max-width:440px;padding:2.2rem;text-align:center">' +
      '<div style="font-size:2.4rem;color:#b91c1c"><i class="bi bi-shield-exclamation"></i></div>' +
      '<h4 style="font-weight:900;color:#002b5e;margin:.6rem 0">Acesso não autorizado</h4>' +
      '<p style="color:#475569;font-size:.9rem">' + msg + '</p>' +
      '<button onclick="window.MapaAuth.signOut()" class="btn btn-outline-secondary btn-sm mt-2">Trocar de conta</button>' +
      '</div></body>';
  }

  function montar() {
    var SB = (window.MAPA_SB) || window.supabase.createClient(CFG.url, CFG.anonKey);
    window.MAPA_SB = SB;

    var api = {
      pronto: null, perfil: null, escolas: [], sistema: null, _todos: [],
      can: function (tela, acao) {
        if (!this.sistema) return false;
        if (this.perfil && this.perfil.is_super_admin) return true;
        var t = this.sistema.telas && this.sistema.telas[tela];
        return !!(t && t[acao || 'ver']);
      },
      token: function () {
        return SB.auth.getSession().then(function (r) {
          return r.data.session ? r.data.session.access_token : null;
        });
      },
      authFetch: function (url, opt) {
        opt = opt || {};
        return this.token().then(function (tok) {
          opt.headers = Object.assign({}, opt.headers, {
            apikey: CFG.anonKey,
            Authorization: 'Bearer ' + (tok || CFG.anonKey)
          });
          return fetch(url, opt);
        });
      },
      signOut: function () {
        try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
        return SB.auth.signOut().then(irParaLogin).catch(irParaLogin);
      }
    };
    window.MapaAuth = api;

    api.pronto = (async function () {
      var sess = (await SB.auth.getSession()).data.session;
      if (!sess) { irParaLogin(); return; }

      // permissões (cache na sessão do navegador p/ poupar egress)
      var perms = null;
      try { perms = JSON.parse(sessionStorage.getItem(CACHE_KEY)); } catch (e) {}
      if (!perms) {
        var r = await SB.rpc('minhas_permissoes');
        if (r.error) { telaSemAcesso('Erro ao verificar permissões: ' + r.error.message); return; }
        perms = r.data;
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(perms)); } catch (e) {}
      }

      if (!perms || !perms.autorizado) {
        telaSemAcesso('A conta <b>' + (sess.user.email || '') + '</b> ainda não foi autorizada pela secretaria.');
        return;
      }

      api.perfil = perms.perfil;
      api.escolas = perms.escolas || [];
      api._todos = perms.sistemas || [];
      api.sistema = api._todos.filter(function (s) { return s.slug === SISTEMA_SLUG; })[0] || null;

      if (!api.sistema) {
        telaSemAcesso('Você não tem acesso ao sistema <b>' + SISTEMA_SLUG.toUpperCase() + '</b>. '
          + 'Sistemas liberados: ' + (api._todos.map(function (s) { return s.nome; }).join(', ') || 'nenhum') + '.');
        return;
      }

      // tela específica sem permissão de ver -> bloqueia
      var tela = telaAtual();
      if (tela && !api.can(tela, 'ver')) {
        telaSemAcesso('Você não tem permissão para a tela <b>' + tela + '</b> deste sistema.');
        return;
      }

      aplicarUI(api);
      document.dispatchEvent(new CustomEvent('mapa-auth-pronto', { detail: api }));
      return api;
    })();
  }

  // Esconde links/elementos de telas não permitidas e injeta o "chip" do usuário.
  function aplicarUI(api) {
    // elementos marcados com data-tela="slug" somem se não puder ver
    document.querySelectorAll('[data-tela]').forEach(function (el) {
      if (!api.can(el.getAttribute('data-tela'), 'ver')) el.style.display = 'none';
    });
    // elementos marcados com data-perm="tela:acao" (ex "avaliacao:editar")
    document.querySelectorAll('[data-perm]').forEach(function (el) {
      var p = (el.getAttribute('data-perm') || '').split(':');
      if (!api.can(p[0], p[1] || 'ver')) el.style.display = 'none';
    });

    // chip do usuário + sair, fixado no canto (não depende do layout da página)
    if (!document.getElementById('mapa-user-chip')) {
      var nome = (api.perfil && (api.perfil.nome || api.perfil.email)) || '';
      var div = document.createElement('div');
      div.id = 'mapa-user-chip';
      div.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2000;background:#fff;'
        + 'border:1px solid #e2e8f0;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.12);'
        + 'padding:6px 10px;display:flex;align-items:center;gap:8px;font:600 12px Inter,sans-serif;color:#334155';
      div.innerHTML =
        '<i class="bi bi-person-circle" style="font-size:1.1rem;color:#002b5e"></i>' +
        '<span style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + nome + '</span>' +
        '<button id="mapa-logout" title="Sair" style="border:0;background:#f1f5f9;border-radius:999px;'
        + 'width:26px;height:26px;cursor:pointer;color:#475569"><i class="bi bi-box-arrow-right"></i></button>';
      document.body.appendChild(div);
      document.getElementById('mapa-logout').addEventListener('click', function () { api.signOut(); });
    }
  }

  carregarSupabaseJs().then(montar).catch(function (e) {
    console.error('[auth.js]', e);
  });
})();
