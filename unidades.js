/* ============================================================================
   unidades.js — O NOME DA UNIDADE, resolvido pelo catálogo `escolas_catalogo`

   Quarta exceção deliberada ao "cada tela é autocontida" (as outras são
   `visao-rede.js`, `ficha-coderp.js` e `leitura-rede.js`).

   POR QUE ELA EXISTE. O repositório tinha SEIS respostas diferentes para a
   pergunta "que unidade é esta?", e elas discordavam entre si:

     avaliacao.html          tokensUnidade — tokens ordenados, sem pontuação
     leitura-rede.js         a mesma ideia, reimplementada
     atribuicao.html         cleanUnit — só trim/colapso de espaço (nada casa)
     retrato-atribuicao.html idem
     fluencia.html           _normEscola + um mapa de apelidos CRAVADO no front
     boletim.html            matchEscola — casamento por SUBCONJUNTO de tokens

   O de `boletim.html` é o mais arriscado: subconjunto de 2 tokens já casa, e
   duas unidades que compartilham dois tokens do núcleo viram a mesma.

   ⚠️ ISTO NÃO É SEGURANÇA. Quem recorta por unidade é o Postgres, via RLS
   (`escolas` + `escola_alias` + `mapa_norm`). Este módulo resolve o NOME para
   exibir e para agregar — nada mais. Não use `oficial()` para decidir o que
   alguém pode ver.

   ⚠️ `escolas_catalogo` (fonte CODERP/SAE: codigo, nome, tipo, setor) é
   SEPARADA do catálogo `escolas` do RLS, de propósito. Este módulo lê a
   primeira, porque é ela que tem o `codigo` e o `tipo` — e é a que a SME
   definiu como padrão dos nomes.

   ⚠️ PROPRIEDADE DE SEGURANÇA DA MIGRAÇÃO: `oficial()` NUNCA descarta um
   nome. Se o catálogo não reconhecer, devolve o que recebeu, intacto. Por
   isso adotar este módulo numa tela só pode canonizar nome — nunca fazer
   unidade sumir da tela, que é o defeito que o CLAUDE.md registra como o mais
   grave por ser invisível.

   REGRA PARA INTEGRAÇÃO NOVA: todo sistema que chegar ao MAPA passa o nome da
   unidade por `MapaUnidades.oficial()` antes de exibir ou agregar. Não
   escreva uma sétima normalização.

   Uso:
     await MapaUnidades.carregar();
     MapaUnidades.oficial('EMEF ALFEU LUIZ GASPARINI PROF')
       -> 'ALFEU LUIZ GASPARINI, PROFº., EMEF'
     MapaUnidades.todas({ tipos: ['EMEF'] })
     MapaDiagUnidades()        // sonda: o que casou, o que não casou
   ========================================================================= */
(function () {
  'use strict';

  var _catalogo = null;      // [{codigo, nome, tipo, setor}]
  var _porChave = null;      // chave de tokens -> registro
  var _promessa = null;
  var _naoResolvidos = new Map();   // nome recebido -> quantas vezes

  function normalizar(txt) {
    return String(txt || '').trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[º°ª]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  /* Títulos e sufixos que aparecem numa grafia e não na outra. Removê-los da
     CHAVE (nunca do nome exibido) é o que faz "ALFEU LUIZ GASPARINI, PROFº.,
     EMEF" casar com "EMEF ALFEU LUIZ GASPARINI PROF".
     ⚠️ Não acrescente aqui um token que faça parte do NOME de alguma unidade:
     tirar 'SANTOS' casaria escolas diferentes. Só título e sigla de tipo. */
  var RUIDO = new Set([
    'PROF', 'PROFA', 'PROFO', 'PROFESSOR', 'PROFESSORA',
    'DR', 'DRA', 'DOUTOR', 'DOUTORA',
    'VER', 'VEREADOR', 'VEREADORA',
    'DOM', 'DONA', 'SR', 'SRA',
    'EMEF', 'EMEI', 'EMEIEF', 'CEI', 'CEMEI', 'CEEEF', 'ESCOLA', 'MUNICIPAL'
  ]);

  /* Chave de casamento: sem pontuação, sem título/sigla, tokens ORDENADOS.
     A ordem sai da chave porque as grafias põem a sigla no começo ou no fim. */
  function chave(nome) {
    return normalizar(nome)
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t && !RUIDO.has(t); })
      .sort().join(' ');
  }

  /* Chave conservadora: mantém os tokens de tipo. Usada como primeira
     tentativa, para que duas unidades homônimas de tipos diferentes
     (a rede tem "X, EMEI" e "X, EMEF") não colidam. */
  function chaveComTipo(nome) {
    return normalizar(nome)
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return !!t && (!RUIDO.has(t) || /^(EMEF|EMEI|EMEIEF|CEI|CEMEI|CEEEF)$/.test(t)); })
      .sort().join(' ');
  }

  /* Tipo pelo TOKEN inteiro do nome — reserva para quando o catálogo não
     traz `tipo`. ⚠️ Por substring não serve: 'CONCEICAO' contém 'CEI'.
     A ordem importa: EMEIEF antes de EMEI e de EMEF. */
  function tipoPeloNome(nome) {
    var toks = new Set(normalizar(nome).split(/[^A-Z0-9]+/).filter(Boolean));
    var ordem = ['CEMEI', 'EMEIEF', 'CEEEF', 'EMEF', 'EMEI', 'CEI'];
    for (var i = 0; i < ordem.length; i++) if (toks.has(ordem[i])) return ordem[i];
    return 'Outras';
  }

  function carregar() {
    if (_promessa) return _promessa;
    _promessa = window.MAPA_SB
      .from('escolas_catalogo').select('codigo,nome,tipo,setor').order('nome')
      .then(function (r) {
        if (r.error) throw r.error;
        _catalogo = (r.data || []).map(function (e) {
          return {
            codigo: Number(e.codigo),
            nome: String(e.nome || '').trim(),
            tipo: String(e.tipo || '').trim().toUpperCase() || tipoPeloNome(e.nome),
            setor: e.setor
          };
        });
        _porChave = new Map();
        _catalogo.forEach(function (u) {
          // A chave COM tipo tem prioridade; a sem tipo entra só se estiver
          // livre, para não fazer duas unidades homônimas colidirem.
          _porChave.set('T|' + chaveComTipo(u.nome), u);
          var k = 'S|' + chave(u.nome);
          if (_porChave.has(k)) _porChave.set(k, null);   // ambígua: não resolve
          else _porChave.set(k, u);
        });
        return _catalogo;
      })
      .catch(function (err) { _promessa = null; throw err; });
    return _promessa;
  }

  function registro(nome) {
    if (!_porChave || !nome) return null;
    var u = _porChave.get('T|' + chaveComTipo(nome));
    if (u) return u;
    u = _porChave.get('S|' + chave(nome));
    if (u) return u;
    var bruto = String(nome).trim();
    if (bruto) _naoResolvidos.set(bruto, (_naoResolvidos.get(bruto) || 0) + 1);
    return null;
  }

  /* ⚠️ Devolve o nome RECEBIDO quando não resolve. Nunca vazio, nunca nulo:
     é o que garante que adotar este módulo não faça unidade sumir. */
  function oficial(nome) {
    var u = registro(nome);
    return u ? u.nome : String(nome || '').trim();
  }

  function tipo(nome) {
    var u = registro(nome);
    return u ? u.tipo : tipoPeloNome(nome);
  }

  function codigo(nome) {
    var u = registro(nome);
    return u ? u.codigo : null;
  }

  function nomePorCodigo(cod) {
    if (!_catalogo) return null;
    var n = Number(cod);
    for (var i = 0; i < _catalogo.length; i++) if (_catalogo[i].codigo === n) return _catalogo[i].nome;
    return null;
  }

  function todas(opcoes) {
    var opts = opcoes || {};
    var lista = (_catalogo || []).slice();
    if (opts.tipos && opts.tipos.length) {
      var alvo = new Set(opts.tipos);
      lista = lista.filter(function (u) { return alvo.has(u.tipo); });
    }
    return lista.map(function (u) { return u.nome; });
  }

  /* Nomes que chegaram e o catálogo não reconheceu. É o que separa "não tem
     dado" de "não casei o nome" — sem isso o traço na tela esconde as duas
     coisas. Quem aparecer aqui é candidato a `escola_alias`, no banco. */
  function naoResolvidos() {
    return Array.from(_naoResolvidos.entries())
      .sort(function (a, b) { return b[1] - a[1]; })
      .map(function (e) { return { nome: e[0], vezes: e[1] }; });
  }

  window.MapaUnidades = {
    carregar: carregar,
    oficial: oficial,
    tipo: tipo,
    codigo: codigo,
    nomePorCodigo: nomePorCodigo,
    todas: todas,
    chave: chave,
    tipoPeloNome: tipoPeloNome,
    naoResolvidos: naoResolvidos,
    catalogo: function () { return (_catalogo || []).slice(); }
  };

  /* ── Sonda ───────────────────────────────────────────────────────────────
     Responde, no console: quantas unidades o catálogo tem por tipo, quais
     nomes chegaram sem casar, e — quando a tela expõe o que listou — quais
     unidades do catálogo NÃO apareceram nela.
     Uso: MapaDiagUnidades()  ou  MapaDiagUnidades('EMEF') */
  window.MapaDiagUnidades = function (tipoAlvo) {
    return carregar().then(function () {
      var cat = _catalogo.slice();
      var porTipo = {};
      cat.forEach(function (u) { porTipo[u.tipo] = (porTipo[u.tipo] || 0) + 1; });
      console.info('[MapaDiagUnidades] catálogo escolas_catalogo:', cat.length, 'unidades');
      console.table(Object.keys(porTipo).sort().map(function (t) {
        return { tipo: t, unidades: porTipo[t] };
      }));

      var alvo = tipoAlvo
        ? cat.filter(function (u) { return u.tipo === String(tipoAlvo).toUpperCase(); })
        : cat;
      if (tipoAlvo) console.info('[MapaDiagUnidades]', alvo.length, String(tipoAlvo).toUpperCase(), 'no catálogo');

      // O que a tela listou, se ela publicar isso
      var naTela = null;
      if (window.MapaTelaUnidades && typeof window.MapaTelaUnidades === 'function') {
        try { naTela = window.MapaTelaUnidades(); } catch (e) { /* tela sem a sonda */ }
      }
      if (Array.isArray(naTela)) {
        var vistos = new Set(naTela.map(chave));
        var faltando = alvo.filter(function (u) { return !vistos.has(chave(u.nome)); });
        console.info('[MapaDiagUnidades] a tela listou', naTela.length, '— faltam', faltando.length);
        if (faltando.length) console.table(faltando.map(function (u) {
          return { codigo: u.codigo, nome: u.nome, tipo: u.tipo };
        }));
      } else {
        console.info('[MapaDiagUnidades] a tela não expõe window.MapaTelaUnidades() — '
          + 'sem como comparar com o que está na tela.');
      }

      var nr = naoResolvidos();
      if (nr.length) {
        console.warn('[MapaDiagUnidades] nomes que NÃO casaram com o catálogo '
          + '(candidatos a escola_alias):');
        console.table(nr);
      } else {
        console.info('[MapaDiagUnidades] todos os nomes vistos até agora casaram.');
      }
      return { catalogo: cat.length, alvo: alvo.length, naoResolvidos: nr };
    });
  };
})();
