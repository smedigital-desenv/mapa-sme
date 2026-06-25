/* ============================================================================
   MAPA — MODO DEMONSTRAÇÃO (pseudonimização para vídeos / treinamento)
   ----------------------------------------------------------------------------
   Objetivo: permitir gravar tutoriais sem expor dados pessoais reais (LGPD),
   inclusive de crianças (proteção reforçada, art. 14 da LGPD).

   Como ativar:
     • Acrescente ?demo=1 na URL de qualquer página. Ex.: avaliacao.html?demo=1
     • Uma vez ativado, permanece ligado ao navegar entre páginas (na mesma aba).
     • Para desligar: ?demo=0

   Opções (parâmetros extras na URL):
     • &writes=allow   → permite gravações no Supabase (padrão: BLOQUEADO).
     • &mark=off       → remove a marca d'água de fundo (mantém o selo inferior).

   O que faz:
     1. Intercepta as respostas do Supabase e substitui, ANTES de chegarem à
        tela/cache, dados sensíveis por pseudônimos fictícios CONSISTENTES
        (o mesmo aluno/professor/escola vira sempre o mesmo nome fictício).
        Cobre: nomes de alunos, RA, nomes e códigos de professores, nomes de
        escolas/unidades e e-mails — em respostas REST e RPC, incluindo as
        arrays posicionais da Educação Especial.
     2. Bloqueia (por padrão) gravações no banco durante a demonstração, para
        que cliques em "salvar/atribuir/criar" não alterem dados reais —
        devolvendo um "sucesso" fictício para o fluxo do vídeo ficar natural.
     3. Limpa o cache (sessionStorage MAPA_CACHE_*) ao entrar/sair, para não
        vazar dado real cacheado nem contaminar o cache de produção.
     4. Exibe um selo "DADOS FICTÍCIOS — DEMONSTRAÇÃO" e marca d'água discreta.

   IMPORTANTE: isto protege o que aparece NA TELA. Durante a gravação, NÃO abra
   o "ver código-fonte" / DevTools, pois a chave do Supabase e a lista de
   e-mails de acesso ficam no código das páginas.
   ============================================================================ */
(function () {
  'use strict';

  // ---- 1. Estado: o modo demo está ativo? --------------------------------
  var qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { qs = null; }
  var param = qs ? (qs.get('demo') || '').toLowerCase() : '';
  var FLAG_KEY = 'MAPA_DEMO';
  var prev = '';
  try { prev = sessionStorage.getItem(FLAG_KEY) || ''; } catch (e) {}

  var ligar = param === '1' || param === 'true' || param === 'on';
  var desligar = param === '0' || param === 'false' || param === 'off';
  var ACTIVE = ligar || (prev === '1' && !desligar);

  // Persiste/limpa a flag e o cache na transição de estado.
  function purgarCache() {
    try {
      for (var i = sessionStorage.length - 1; i >= 0; i--) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf('MAPA_CACHE_') === 0) sessionStorage.removeItem(k);
      }
    } catch (e) {}
  }
  try {
    if (ACTIVE && prev !== '1') { sessionStorage.setItem(FLAG_KEY, '1'); purgarCache(); }
    else if (!ACTIVE && prev === '1') { sessionStorage.removeItem(FLAG_KEY); purgarCache(); }
  } catch (e) {}

  // Observação: NÃO há retorno antecipado quando inativo — o botão flutuante de
  // ligar/desligar precisa aparecer em todas as páginas. A interceptação do
  // fetch e o bloqueio de gravações só são instalados quando ACTIVE (abaixo).

  var BLOCK_WRITES = (qs && (qs.get('writes') || '').toLowerCase() === 'allow') ? false : true;
  var SHOW_MARK = !(qs && (qs.get('mark') || '').toLowerCase() === 'off');

  // URL com o parâmetro demo alternado (preserva os demais parâmetros).
  function urlDemo(valor) {
    try {
      var u = new URL(location.href);
      u.searchParams.set('demo', valor);
      return u.toString();
    } catch (e) {
      var sep = location.search ? '&' : '?';
      return location.pathname + (location.search ? location.search + '&' : '?') + 'demo=' + valor;
    }
  }

  // ---- 2. Geradores determinísticos de pseudônimos -----------------------
  function hash(s) {
    s = String(s == null ? '' : s);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  var PRIMEIROS = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Heitor',
    'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nelson', 'Olívia', 'Pedro', 'Quésia',
    'Rafael', 'Sofia', 'Tiago', 'Úrsula', 'Vitor', 'Wesley', 'Yara', 'Bianca', 'Caio',
    'Daniela', 'Eduardo', 'Fernanda', 'Gustavo', 'Helena', 'Igor', 'Júlia', 'Kauã',
    'Larissa', 'Murilo', 'Natália', 'Otávio', 'Paula', 'Renato'];
  var SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Pereira', 'Costa', 'Almeida', 'Nunes',
    'Rocha', 'Carvalho', 'Gomes', 'Martins', 'Araújo', 'Ribeiro', 'Barbosa', 'Teixeira',
    'Moreira', 'Cardoso', 'Mendes', 'Freitas', 'Andrade', 'Cavalcante', 'Pinto', 'Dias',
    'Correia', 'Lima', 'Azevedo', 'Vieira', 'Monteiro', 'Reis', 'Campos'];

  function nomePessoa(seed) {
    var h = hash('p:' + seed);
    var pr = PRIMEIROS[h % PRIMEIROS.length];
    var s1 = SOBRENOMES[(h >>> 7) % SOBRENOMES.length];
    var s2 = SOBRENOMES[(h >>> 13) % SOBRENOMES.length];
    return pr + ' ' + s1 + ' ' + s2;
  }
  function nomeEscola(seed) {
    var h = hash('e:' + seed);
    var s1 = SOBRENOMES[h % SOBRENOMES.length];
    var s2 = SOBRENOMES[(h >>> 9) % SOBRENOMES.length];
    return 'EMEF ' + s1 + ' ' + s2; // fictícia, mas com aparência realista
  }
  function codigoFunc(seed) { return 100000 + (hash('c:' + seed) % 900000); }
  function raAluno(seed) { return String(20000000000 + (hash('r:' + seed) % 9999999999)); }
  function emailFake(seed) { return 'usuario' + (100 + hash('m:' + seed) % 900) + '@escola.exemplo'; }

  // Preserva vazios/nulos (não inventa dado onde não havia).
  function vazio(v) { return v === null || v === undefined || v === ''; }

  // ---- 3. Substituição por chave (respostas tipo objeto) -----------------
  var SET_NOME_ALUNO = { nome_aluno: 1, aluno: 1, estudante: 1 };
  var SET_RA = { rema_aluno: 1, ra: 1 };
  var SET_NOME_PROF = { nome_professor_prop: 1, nome_professor_sub: 1, nome_professor: 1, professor: 1, docente: 1 };
  var SET_COD_PROF = { codigo_professor_prop: 1, codigo_professor_sub: 1, codigo_professor: 1, codigo_funcional: 1, cod_professor: 1 };
  var SET_ESCOLA = { nome_unidade: 1, escola: 1, nome_escola: 1, unidade_escolar: 1, ue: 1 };
  var SET_EMAIL = { email: 1, email_usuario: 1, e_mail: 1 };
  var SET_NOME_GEN = { nome: 1 }; // em config = nome da unidade → trata como escola

  function substituirChave(key, val) {
    if (vazio(val)) return val;
    if (SET_NOME_ALUNO[key]) return nomePessoa('a|' + val);
    if (SET_NOME_PROF[key]) return nomePessoa('t|' + val);
    if (SET_NOME_GEN[key]) return nomeEscola('u|' + val);
    if (SET_ESCOLA[key]) return nomeEscola('s|' + val);
    if (SET_RA[key]) return raAluno(val);
    if (SET_COD_PROF[key]) return codigoFunc(val);
    if (SET_EMAIL[key]) return emailFake(val);
    return val;
  }

  function walk(node, depth) {
    if (depth > 12 || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        if (node[i] && typeof node[i] === 'object') walk(node[i], depth + 1);
      }
      return;
    }
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      var v = node[k];
      if (v && typeof v === 'object') walk(v, depth + 1);
      else node[k] = substituirChave(k, v);
    }
  }

  // ---- 4. Tratadores das arrays posicionais (Educação Especial) ----------
  function setRow(row, idx, fn) {
    if (Array.isArray(row) && idx < row.length && !vazio(row[idx])) row[idx] = fn(row[idx]);
  }
  function tratarEE(url, data) {
    if (!data || typeof data !== 'object') return;
    if (url.indexOf('/rpc/ee_alunos') !== -1 && Array.isArray(data)) {
      data.forEach(function (a) {
        setRow(a, 0, function (v) { return nomeEscola('s|' + v); });
        setRow(a, 3, function (v) { return raAluno(v); });
        setRow(a, 4, function (v) { return nomePessoa('a|' + v); });
      });
    } else if (url.indexOf('/rpc/ee_liminar') !== -1) {
      (data.alunos || []).forEach(function (a) {
        setRow(a, 0, function (v) { return nomePessoa('a|' + v); });
        setRow(a, 1, function (v) { return raAluno(v); });
        setRow(a, 2, function (v) { return nomeEscola('s|' + v); });
      });
      (data.unidades || []).forEach(function (u) {
        setRow(u, 0, function (v) { return nomeEscola('s|' + v); });
      });
      // turmas = [escola, turma/periodo, periodo, alunos, situacao] — escola no [0]
      // (precisa do mesmo pseudônimo das unidades para o drill-down casar).
      (data.turmas || []).forEach(function (t) {
        setRow(t, 0, function (v) { return nomeEscola('s|' + v); });
      });
    } else if (url.indexOf('/rpc/ee_dash') !== -1) {
      // unidades = [unidade,turmas_nee,alunos_nee,ec_pct,pei_pct,liminar_turmas,
      //             prof_manha,prof_tarde,liminar_status,liminar_escola]
      (data.unidades || []).forEach(function (u) {
        setRow(u, 0, function (v) { return nomeEscola('s|' + v); });
        setRow(u, 9, function (v) { return nomeEscola('s|' + v); });
      });
    } else if (url.indexOf('/rpc/ee_resumo') !== -1) {
      (data.por_unidade || []).forEach(function (u) {
        setRow(u, 0, function (v) { return nomeEscola('s|' + v); });
      });
    } else if (url.indexOf('/rpc/ee_apoio') !== -1) {
      (data.escolas || []).forEach(function (e) {
        setRow(e, 1, function (v) { return nomeEscola('s|' + v); });
      });
    }
  }

  function transformar(url, data) {
    if (url.indexOf('/rpc/ee_') !== -1) tratarEE(url, data); // arrays posicionais
    else walk(data, 0);                                       // objetos por chave
    return data;
  }

  // ---- 5. Interceptação do fetch (Supabase) ------------------------------
  function isSupabase(url) { return typeof url === 'string' && url.indexOf('.supabase.co') !== -1; }
  function isWrite(url, method) {
    method = (method || 'GET').toUpperCase();
    if (!isSupabase(url)) return false;
    if (method === 'PATCH' || method === 'PUT' || method === 'DELETE') return true;
    // INSERT em tabela = POST em /rest/v1/<tabela> (RPCs ficam em /rest/v1/rpc/)
    if (method === 'POST' && url.indexOf('/rest/v1/') !== -1 && url.indexOf('/rest/v1/rpc/') === -1) return true;
    return false;
  }

  var fetchOriginal = window.fetch ? window.fetch.bind(window) : null;
  if (ACTIVE && fetchOriginal) {
    window.fetch = function (input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';

      // Bloqueio de gravações (sucesso fictício, nada persiste).
      if (BLOCK_WRITES && isWrite(url, method)) {
        try { console.warn('[MAPA demo] Gravação bloqueada (modo demonstração):', method, url); } catch (e) {}
        avisar('Ação registrada apenas na demonstração (nada foi salvo).');
        return Promise.resolve(new Response('[]', {
          status: 200, statusText: 'OK (demo)',
          headers: { 'Content-Type': 'application/json' }
        }));
      }

      return fetchOriginal(input, init).then(function (res) {
        if (!isSupabase(url) && !isSupabase(res.url || '')) return res;
        var ct = (res.headers.get('content-type') || '');
        if (ct.indexOf('application/json') === -1) return res;
        var alvoUrl = url || res.url || '';
        return res.clone().json().then(function (data) {
          try { data = transformar(alvoUrl, data); } catch (e) { return res; }
          return new Response(JSON.stringify(data), {
            status: res.status, statusText: res.statusText, headers: res.headers
          });
        }).catch(function () { return res; });
      });
    };
  }

  // ---- 6. Selo, marca d'água e aviso -------------------------------------
  var avisoTimer = null;
  function avisar(msg) {
    if (!document.body) return;
    var t = document.getElementById('mapa-demo-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'mapa-demo-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:54px;transform:translateX(-50%);' +
        'background:#1e293b;color:#fff;padding:.5rem .9rem;border-radius:10px;font:600 13px/1.3 system-ui,sans-serif;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:2147483647;max-width:90vw;text-align:center;opacity:0;transition:opacity .2s;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { t.style.opacity = '0'; }, 2600);
  }

  // Botão flutuante discreto — aparece SEMPRE (ligado ou desligado) para quem
  // grava acionar a anonimização a qualquer momento. Ao clicar, recarrega a
  // página com ?demo alternado (garante cache limpo e dados re-renderizados).
  function montarBotao() {
    if (!document.body || document.getElementById('mapa-demo-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'mapa-demo-btn';
    btn.type = 'button';
    var base = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;border:0;cursor:pointer;' +
      'border-radius:999px;font:800 12px/1 system-ui,sans-serif;letter-spacing:.03em;' +
      'padding:.5rem .8rem;box-shadow:0 6px 18px rgba(0,0,0,.28);display:inline-flex;align-items:center;gap:.4rem;' +
      'transition:opacity .15s,transform .15s;';
    if (ACTIVE) {
      btn.innerHTML = '🔒 <span>Demonstração ON</span>';
      btn.title = 'Modo demonstração ativo — dados fictícios. Clique para voltar aos dados reais.';
      btn.style.cssText = base + 'background:linear-gradient(135deg,#b91c1c,#dc2626);color:#fff;';
    } else {
      btn.innerHTML = '🛡️ <span>Modo demonstração</span>';
      btn.title = 'Ativar modo demonstração: oculta dados pessoais (alunos, professores, escolas) para gravar vídeos com segurança.';
      btn.style.cssText = base + 'background:rgba(30,41,59,.55);color:#e2e8f0;opacity:.55;';
      btn.onmouseenter = function () { btn.style.opacity = '1'; };
      btn.onmouseleave = function () { btn.style.opacity = '.55'; };
    }
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.style.transform = 'scale(.96)';
      location.href = urlDemo(ACTIVE ? '0' : '1');
    });
    document.body.appendChild(btn);
  }

  // Selo central + marca d'água — só quando o modo está ATIVO (para a gravação).
  function montarSelo() {
    if (!ACTIVE || !document.body || document.getElementById('mapa-demo-selo')) return;

    var selo = document.createElement('div');
    selo.id = 'mapa-demo-selo';
    selo.textContent = '🔒 DADOS FICTÍCIOS — MODO DEMONSTRAÇÃO (LGPD)';
    selo.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);' +
      'background:linear-gradient(135deg,#b91c1c,#dc2626);color:#fff;padding:.4rem .9rem;' +
      'border-radius:999px;font:800 12px/1 system-ui,sans-serif;letter-spacing:.04em;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:2147483646;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(selo);

    if (SHOW_MARK) {
      var mark = document.createElement('div');
      mark.id = 'mapa-demo-mark';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="340" height="200">' +
        '<text x="0" y="110" transform="rotate(-24 0 110)" fill="rgba(190,30,30,0.06)" ' +
        'font-family="system-ui,sans-serif" font-size="26" font-weight="800">DADOS FICTÍCIOS</text></svg>';
      mark.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;' +
        'background-image:url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '");' +
        'background-repeat:repeat;';
      document.body.appendChild(mark);
    }

    try {
      console.log('%c[MAPA] MODO DEMONSTRAÇÃO ATIVO', 'background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-weight:800;');
      console.log('[MAPA demo] Dados pseudonimizados na tela. Gravações ' + (BLOCK_WRITES ? 'BLOQUEADAS' : 'permitidas') + '. Para sair: clique no botão ou use ?demo=0');
    } catch (e) {}
  }

  function montarUI() { montarBotao(); montarSelo(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarUI);
  else montarUI();

  // API mínima para inspeção/depuração.
  window.MAPA_DEMO = {
    active: ACTIVE, blockWrites: ACTIVE ? BLOCK_WRITES : false,
    toggle: function () { location.href = urlDemo(ACTIVE ? '0' : '1'); },
    nomePessoa: nomePessoa, nomeEscola: nomeEscola, codigoFunc: codigoFunc
  };
})();
