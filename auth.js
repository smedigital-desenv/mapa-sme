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

  // Enquanto a pagina esta sendo PRE-RENDERIZADA, ela roda numa aba invisivel.
  // O index.html pede prerender de atribuicao.html com eagerness "immediate",
  // entao havia DUAS execucoes simultaneas do auth.js: a visivel e a oculta.
  // Cada uma abria sua propria sessao, e uma invalidava o token da outra — dai
  // o "otp_expired" intermitente, que parecia problema de tempo e nao era.
  // Aqui a execucao espera a aba virar visivel antes de tocar em sessao.
  function esperarAtivacao() {
    if (!document.prerendering) return Promise.resolve();
    return new Promise(function (r) {
      document.addEventListener('prerenderingchange', function () { r(); }, { once: true });
    });
  }

  (async function () {
    await esperarAtivacao();
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
    async function pedirTokenAPonte(tokenCentral, simular) {
      var r, resp;
      try {
        r = await fetchOriginal(MAPA_CFG.url + '/functions/v1/central-bridge', {
          method: 'POST',
          headers: {
            apikey: MAPA_CFG.anonKey,
            Authorization: 'Bearer ' + tokenCentral,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(simular ? { simular: simular } : {})
        });
        resp = await r.json().catch(function () { return null; });
      } catch (e) {
        console.error('[mapa-auth] falha de rede ao chamar a ponte', e);
        overlayErro('Não foi possível falar com o serviço de acesso do MAPA.');
        return null;
      }

      if (!r.ok || !resp || !resp.access_token) {
        console.error('[mapa-auth] a ponte recusou', r.status, resp);
        overlayErro(
          resp && resp.erro === 'sem_acesso_ao_mapa'
            ? 'Esta conta não tem acesso ao MAPA. Fale com a secretaria.'
          : resp && resp.erro === 'simulacao_negada'
            ? 'Só super administradores podem abrir o sistema como outra pessoa.'
            : 'Não foi possível abrir sua sessão no MAPA ('
              + ((resp && resp.erro) || r.status) + ')'
              // O detalhe vem do Supabase e é o que realmente diz o que houve.
              // Sem ele, sobra um código genérico e uma ida ao painel.
              + (resp && resp.detalhe ? '<br><small style="opacity:.75">'
                  + String(resp.detalhe).replace(/[<>]/g, '') + '</small>' : ''));
        return null;
      }
      return resp;
    }

    // A ponte já devolve a sessão verificada. Aqui só instalamos ela no
    // cliente — nenhum token para consumir, nenhum tipo para adivinhar.
    async function abrirSessao(resp) {
      var v = await window.MAPA_SB.auth.setSession({
        access_token: resp.access_token,
        refresh_token: resp.refresh_token
      });
      return v.error || null;
    }

    async function garantirSessaoMapa() {
      // Quem a ponte valida é sempre o token REAL de quem logou. Durante a
      // simulação, A.perfil vira o perfil observado — por isso o e-mail real
      // vem de A.realPerfil quando ela está ativa.
      var emailReal = String(
        (A.realPerfil && A.realPerfil.email) || (A.perfil && A.perfil.email) || ''
      ).toLowerCase();

      // Simular no MAPA é personificação de verdade: a sessão emitida é a da
      // pessoa observada e o BANCO passa a enxergá-la. É o único jeito de
      // conferir o isolamento por escola agora que ele vive no Postgres. Só
      // super admin consegue, e quem decide isso é a ponte, não esta linha.
      var simulando = A.simulando
        ? String((A.perfil && A.perfil.email) || A.simulando).toLowerCase()
        : null;
      var alvo = simulando || emailReal;

      var atual = (await window.MAPA_SB.auth.getSession()).data.session;
      if (atual && String(atual.user.email || '').toLowerCase() === alvo) return true;
      // Trocou de conta (ou entrou/saiu da simulação): encerra só esta aba.
      // O padrão do supabase-js é global e revogaria os refresh tokens da
      // pessoa em todos os dispositivos.
      if (atual) await window.MAPA_SB.auth.signOut({ scope: 'local' });

      var tokenCentral = await A.token();
      if (!tokenCentral) {
        console.error('[mapa-auth] o central nao devolveu token');
        overlayErro('Sua sessão no central expirou. Faça o login novamente.');
        return false;
      }

      var resp = await pedirTokenAPonte(tokenCentral, simulando);
      if (!resp || !resp.access_token) return false;

      var erro = await abrirSessao(resp);
      if (!erro) {
        if (resp.simulando) {
          console.info('[mapa-auth] sessão aberta COMO ' + resp.email
            + ' (simulada por ' + resp.simulando + ')');
        }
        return true;
      }

      console.error('[mapa-auth] não foi possível abrir a sessão', erro);
      overlayErro('Não foi possível abrir a sessão no MAPA: ' + (erro && erro.message));
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

    // ── Cache local das respostas da Ficha CODERP ──────────────────────────
    // IndexedDB + gzip, compartilhado entre TODAS as telas do MAPA. O
    // pré-aquecimento grava aqui; a tela de Avaliações lê daqui SEM REDE —
    // é o que torna a abertura instantânea. TTL de 10 min, o mesmo do cache
    // da Edge Function: o dado continua "ao vivo", só não é rebuscado a cada
    // clique. Falha de IndexedDB nunca quebra nada — vira cache-miss.
    var MapaFichaCache = (function () {
      var TTL = 10 * 60 * 1000;
      var abrir = null;
      function db() {
        if (!abrir) {
          abrir = new Promise(function (res, rej) {
            var r = indexedDB.open('mapa_ficha_cache', 1);
            r.onupgradeneeded = function () { r.result.createObjectStore('resp'); };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
          });
        }
        return abrir;
      }
      function gzip(texto) {
        if (typeof CompressionStream === 'undefined') return Promise.resolve(texto);
        var s = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Response(s).blob();
      }
      function gunzip(v) {
        if (typeof v === 'string') return Promise.resolve(v);
        var s = v.stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(s).text();
      }
      function ler(chave) {
        return db().then(function (d) {
          return new Promise(function (res) {
            var t = d.transaction('resp').objectStore('resp').get(chave);
            t.onsuccess = function () { res(t.result || null); };
            t.onerror = function () { res(null); };
          });
        }).then(function (hit) {
          if (!hit || (Date.now() - hit.t) > TTL) return null;
          return gunzip(hit.v);
        }).catch(function () { return null; });
      }
      function gravar(chave, texto) {
        return gzip(texto).then(function (v) {
          return db().then(function (d) {
            d.transaction('resp', 'readwrite').objectStore('resp').put({ t: Date.now(), v: v }, chave);
          });
        }).catch(function () {});
      }
      function limparVencidos() {
        db().then(function (d) {
          var st = d.transaction('resp', 'readwrite').objectStore('resp');
          var cur = st.openCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (!c) return;
            if (c.value && (Date.now() - c.value.t) > TTL) c.delete();
            c.continue();
          };
        }).catch(function () {});
      }
      setTimeout(limparVencidos, 10000);
      return { ler: ler, gravar: gravar };
    })();
    window.MapaFichaCache = MapaFichaCache;

    // ── Pré-aquecimento da Ficha CODERP ────────────────────────────────────
    // De QUALQUER tela do MAPA (menos a própria Avaliações, que faz as suas
    // consultas), dispara em segundo plano as consultas da Ficha: rede dos 4
    // bimestres e, na sequência, as fichas aluno a aluno das escolas com
    // lançamento no 1º/2º bimestre. Tudo entra no cache de 10 min da Edge
    // Function coderp-ficha: quando a pessoa abrir Avaliações, até o detalhe
    // por turma sai na hora, sem esperar o CODERP e sem "números subindo".
    // Fire-and-forget — falha aqui não afeta tela nenhuma.
    if (!/avaliacao\.html/i.test(location.pathname) && !api.restritoEscola) {
      setTimeout(function () {
        var anoLetivo = new Date().getFullYear();
        var fila = [];
        // Os totais da rede vêm PRIMEIRO: são 4 consultas (uma por bimestre),
        // sem abrir por unidade, e é a única fonte independente dos totais que
        // a API oferece. Chegam antes da varredura por turma, que é 5x maior.
        [1, 2, 3, 4].forEach(function (b) {
          fila.push({ nivel: 'rede', parms: { anoLetivo: anoLetivo, bimestre: b } });
        });
        // Depois a varredura por ano escolar, que é o que abre a rede por
        // unidade (o /IndicadorRede não devolve uni_cod).
        [1, 2, 3, 4].forEach(function (b) {
          ['1 ANO', '2 ANO', '3 ANO', '4 ANO', '5 ANO'].forEach(function (a) {
            fila.push({ nivel: 'turma', parms: { anoLetivo: anoLetivo, bimestre: b, anoescolar: a } });
          });
        });

        // Busca e GRAVA no cache local; se já está fresco, nem sai para a rede.
        function chamar(corpo) {
          var chave = JSON.stringify(corpo);
          return MapaFichaCache.ler(chave).then(function (pronto) {
            if (pronto !== null) return { json: function () { return Promise.resolve(JSON.parse(pronto)); } };
            return api.token().then(function (tok) {
              if (!tok) return null;
              return fetchOriginal(MAPA_CFG.url + '/functions/v1/coderp-ficha', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
                body: JSON.stringify(corpo)
              }).then(function (r) {
                if (!r || !r.ok) return r;
                return r.text().then(function (texto) {
                  // Só grava resposta com dado real, ou vazio sem Messages —
                  // erro "HTTP 200" da API não pode envenenar o cache por 10 min.
                  var resp = null; try { resp = JSON.parse(texto); } catch (e) {}
                  var temDado = false, temMsg = false, parcial = false;
                  if (resp) {
                    for (var k in resp) {
                      if (k.indexOf('fichasAvaliacoes') === 0 && resp[k] && resp[k].length) { temDado = true; break; }
                    }
                    // `detalherede` devolve `linhas`, não `fichasAvaliacoes*`.
                    if (!temDado && resp.linhas && resp.linhas.length) temDado = true;
                    temMsg = !!(resp.Messages && resp.Messages.length);
                    // Rede incompleta não pode ficar 10 min no cache.
                    parcial = !!resp.parcial;
                  }
                  if (resp && !parcial && (temDado || !temMsg)) MapaFichaCache.gravar(chave, texto);
                  return { json: function () { return Promise.resolve(JSON.parse(texto)) } };
                });
              });
            });
          });
        }

        // Depois da rede, o DETALHE da rede (turmas) do 1º e do 2º bimestre.
        // ⚠️ NÃO enfileirar aqui as fichas aluno-a-aluno escola por escola:
        // isso baixava ~3 MB por unidade para dentro do navegador a partir de
        // QUALQUER tela e era a causa da lentidão. O nível `detalherede` faz
        // esse leque NO SERVIDOR e devolve só o agregado — uma resposta, não
        // 112. É o que faz a tela de Avaliações abrir com todas as turmas.
        [1, 2].forEach(function (b) {
          fila.push({ nivel: 'detalherede', parms: { anoLetivo: anoLetivo, bimestre: b } });
        });

        function proxima() {
          var p = fila.shift();
          if (!p) return;
          chamar(p).catch(function () {}).then(function () { proxima(); });
        }
        // 3 consultas simultâneas: aquece rápido sem disputar rede com a tela.
        proxima(); proxima(); proxima();
      }, 2500);
    }
  })();
})();
