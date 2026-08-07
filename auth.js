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

  // ── Ponte de identidade para TODA chamada ao banco do MAPA ────────────────
  // Oito páginas montam `fetch` na mão contra o REST, mandando a própria chave
  // anon no Authorization (`Bearer ${SUPABASE_KEY}`). Como o anon perdeu todas
  // as permissões no banco — de propósito, foi assim que o vazamento foi
  // fechado — essas chamadas seriam recusadas.
  //
  // Em vez de editar 14 pontos espalhados (e correr o risco de esquecer um, ou
  // de alguém escrever um novo amanhã), o fetch é interceptado UMA vez aqui:
  // requisição para o domínio do MAPA sai sempre com o token do central no
  // Authorization. Qualquer outro destino passa intocado.
  var fetchOriginal = window.fetch.bind(window);
  var liberarToken;
  var tokenPronto = new Promise(function (r) { liberarToken = r; });

  // ⚠️ Só o /rest/v1/ é interceptado. O /auth/v1/ NÃO pode entrar aqui: é por
  // ele que o verifyOtp() cria a sessão, e ele ficaria esperando o token que
  // só passa a existir depois que ele próprio terminar — deadlock, e a tela
  // trava em "Verificando acesso…". O /functions/v1/ também fica de fora
  // porque a ponte monta os próprios cabeçalhos.
  var ALVO = MAPA_CFG.url + '/rest/v1/';

  window.fetch = function (input, init) {
    if (typeof input !== 'string' || input.indexOf(ALVO) !== 0) {
      return fetchOriginal(input, init);
    }
    return tokenPronto.then(function (obterToken) {
      return obterToken ? obterToken() : null;
    }).then(function (tok) {
      var opt = Object.assign({}, init || {});
      var h = new Headers(opt.headers || {});
      h.set('apikey', MAPA_CFG.anonKey);
      h.set('Authorization', 'Bearer ' + (tok || MAPA_CFG.anonKey));
      opt.headers = h;
      return fetchOriginal(input, opt);
    });
  };

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
      await carregarScript('/central/config.js');
      await carregarScript('/central/acesso-sme.js');

      // window.MAPA_SB: cliente do Supabase do MAPA, só para DADOS.
      // Sessão PERSISTENTE de propósito: quem emite essa sessão é a Edge
      // Function `central-bridge`, e guardá-la faz a ponte ser chamada uma vez
      // por sessão em vez de uma vez por página.
      // (Não usar a opção `accessToken` aqui: ela desliga o auth do cliente, e
      // é justamente o auth que precisamos para ter auth.uid() no banco.)
      window.MAPA_SB = window.supabase.createClient(MAPA_CFG.url, MAPA_CFG.anonKey);
    } catch (e) {
      overlayErro('Falha ao carregar os módulos de acesso. Recarregue a página.');
      return;
    }

    var A = window.AcessoSME;
    if (!A || !A.pronto) {
      liberarToken(null);
      overlayErro('O módulo de acesso central não carregou.');
      return;
    }

    var apiCentral;
    try { apiCentral = await A.pronto; }
    catch (e) { liberarToken(null); overlayErro('Não foi possível verificar seu acesso no central.'); return; }

    // Sem perfil = o central já redirecionou para o login ou já pintou a tela
    // de "sem acesso". Nada a fazer aqui — e nada de abrir sessão no MAPA.
    if (!apiCentral || !A.perfil) { liberarToken(null); return; }

    // ── Ponte: token do central -> sessão real deste projeto ────────────────
    // Sem isso as consultas sairiam como `anon`, que não tem permissão nenhuma
    // no banco. Reaproveita a sessão já guardada quando ela é do mesmo e-mail.
    async function pedirTokenAPonte(tokenCentral) {
      var r, resp;
      try {
        r = await fetchOriginal(MAPA_CFG.url + '/functions/v1/central-bridge', {
          method: 'POST',
          headers: {
            apikey: MAPA_CFG.anonKey,
            Authorization: 'Bearer ' + tokenCentral,
            'Content-Type': 'application/json'
          },
          body: '{}'
        });
        resp = await r.json().catch(function () { return null; });
      } catch (e) {
        console.error('[mapa-auth] falha de rede ao chamar a ponte', e);
        overlayErro('Não foi possível falar com o serviço de acesso do MAPA.');
        return null;
      }

      if (!r.ok || !resp || !resp.token_hash) {
        console.error('[mapa-auth] a ponte recusou', r.status, resp);
        overlayErro(resp && resp.erro === 'sem_acesso_ao_mapa'
          ? 'Sua conta não tem acesso ao MAPA. Fale com a secretaria.'
          : 'Não foi possível abrir sua sessão no MAPA (' + ((resp && resp.erro) || r.status) + ').');
        return null;
      }
      return resp;
    }

    async function garantirSessaoMapa() {
      // ⚠️ Tem que ser o e-mail REAL de quem está logado, não o simulado.
      // Durante a simulação, A.perfil vira o perfil observado, mas o token
      // continua sendo o de quem simula — e é o token que a ponte valida. Usar
      // o e-mail simulado aqui faria a comparação nunca bater: signOut e ponte
      // a cada carregamento, em loop, derrubando o token no meio do caminho.
      //
      // Consequência a saber: a simulação NÃO troca a identidade no banco. Ela
      // muda o que a tela mostra; o RLS continua enxergando quem realmente
      // logou. Para testar o isolamento por escola de verdade, é preciso um
      // login real da pessoa.
      var emailReal = String(
        (A.realPerfil && A.realPerfil.email) || (A.perfil && A.perfil.email) || ''
      ).toLowerCase();

      var atual = (await window.MAPA_SB.auth.getSession()).data.session;
      if (atual && String(atual.user.email || '').toLowerCase() === emailReal) return true;
      // Trocou de conta no central: encerra só esta aba, sem invalidar os
      // refresh tokens da pessoa em outros dispositivos.
      if (atual) await window.MAPA_SB.auth.signOut({ scope: 'local' });

      var tokenCentral = await A.token();
      if (!tokenCentral) {
        console.error('[mapa-auth] o central não devolveu token');
        overlayErro('Sua sessão no central expirou. Faça o login novamente.');
        return false;
      }

      var resp = await pedirTokenAPonte(tokenCentral);
      if (!resp || !resp.token_hash) return false;

      // O tipo tem que ser o mesmo com que o token foi gerado. A ponte informa
      // qual é; a lista de reserva cobre variação entre versões do Supabase.
      var tipos = [], erro = null;
      if (resp.tipo) tipos.push(resp.tipo);
      ['magiclink', 'email'].forEach(function (t) {
        if (tipos.indexOf(t) === -1) tipos.push(t);
      });

      // Uma tentativa por token: o verify CONSOME o hash, então repetir com
      // outro tipo sobre o mesmo token sempre falharia — e a segunda mensagem
      // de erro seria enganosa. Se o tipo informado pela ponte não servir,
      // pedimos um token novo antes de tentar o próximo.
      for (var i = 0; i < tipos.length; i++) {
        var v = await window.MAPA_SB.auth.verifyOtp({
          token_hash: resp.token_hash, type: tipos[i]
        });
        if (!v.error) return true;
        erro = v.error;
        console.warn('[mapa-auth] verifyOtp recusou o tipo "' + tipos[i] + '":', v.error.message);
        if (i + 1 < tipos.length) {
          var novo = await pedirTokenAPonte(tokenCentral);
          if (!novo || !novo.token_hash) break;
          resp = novo;
        }
      }

      console.error('[mapa-auth] verifyOtp falhou em todos os tipos', erro);
      overlayErro('Não foi possível abrir sua sessão no MAPA: ' + (erro && erro.message)
        + '. Confira se o provedor "Email" está habilitado no Authentication do MAPA.');
      return false;
    }

    // Qualquer caminho de falha já pintou o erro e tirou o gate. Liberar o
    // token com null é essencial: sem isso as chamadas ao /rest/v1/ que já
    // estiverem na fila do interceptador ficariam penduradas para sempre.
    var comSessao = false;
    try { comSessao = await garantirSessaoMapa(); }
    catch (e) {
      console.error('[mapa-auth] erro inesperado ao abrir a sessão', e);
      overlayErro('Erro inesperado ao abrir sua sessão no MAPA. Recarregue a página.');
    }
    if (!comSessao) { liberarToken(null); return; }

    // A partir daqui toda chamada ao banco do MAPA sai assinada com a sessão
    // DESTE projeto — é ela que faz auth.uid() funcionar nas policies.
    liberarToken(function () {
      return window.MAPA_SB.auth.getSession().then(function (r) {
        return r.data.session ? r.data.session.access_token : null;
      });
    });

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
    // token() = token DESTE projeto (o que o banco do MAPA valida), não o do
    // central. Quem quiser falar com o central usa AcessoSME.token().
    api.token = function () {
      return window.MAPA_SB.auth.getSession().then(function (r) {
        return r.data.session ? r.data.session.access_token : null;
      });
    };
    api.tokenCentral = function () { return A.token(); };
    // Cabeçalhos para falar com o REST do MAPA: a `apikey` continua sendo a do
    // projeto do MAPA (é o que roteia a requisição), mas quem diz QUEM É VOCÊ é
    // o Bearer — e ele passa a ser a sessão do MAPA, não mais a chave anon.
    api.headers = function (extra) {
      return api.token().then(function (tok) {
        var h = Object.assign({}, extra || {});
        h.apikey = MAPA_CFG.anonKey;
        h.Authorization = 'Bearer ' + (tok || MAPA_CFG.anonKey);
        return h;
      });
    };
    api.authFetch = function (url, opt) {
      opt = opt || {};
      return api.headers(opt.headers).then(function (h) {
        opt.headers = h;
        return fetchOriginal(url, opt);
      });
    };
    window.MAPA_HEADERS = api.headers;
    // Sair encerra as DUAS sessões: a do MAPA e a do central. Sem isso a
    // sessão local sobreviveria ao logout e a próxima pessoa no mesmo
    // navegador entraria com a conta anterior.
    api.signOut = function () {
      return window.MAPA_SB.auth.signOut().catch(function () {}).then(function () {
        return A.signOut();
      });
    };
    api.simulando = A.simulando || null;
    api.realPerfil = A.realPerfil || null;
    api.simular = function (email) { return A.simular(email); };
    api.pararSimulacao = function () { return A.pararSimulacao(); };
    api.pronto = Promise.resolve(api);

    gateOff();
    document.dispatchEvent(new CustomEvent('mapa-auth-pronto', { detail: api }));
  })();
})();
