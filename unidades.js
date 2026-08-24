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
  /* As siglas de tipo, numa lista SÓ. Elas eram repetidas em três lugares
     (o RUIDO, o filtro de `chaveComTipo` e a ordem de `tipoPeloNome`), e a
     lista mais curta perdia casamento em silêncio: a `boletim.html` já
     descartava EMEIF, CEMEFEJA, EEI, CRECHE, AMES e NEI, e aqui elas ficavam
     na chave — bastava uma grafia trazer a sigla e a outra não para os tokens
     não baterem. Sigla nova entra AQUI, e os três usos acompanham. */
  var SIGLAS_TIPO = new Set([
    'EMEF', 'EMEI', 'EMEIEF', 'EMEIF', 'CEI', 'CEMEI', 'CEMEFEJA',
    'CEEEF', 'EEI', 'CRECHE', 'AMES', 'NEI'
  ]);

  var TITULOS = new Set([
    'PROF', 'PROFA', 'PROFO', 'PROFESSOR', 'PROFESSORA',
    'DR', 'DRA', 'DOUTOR', 'DOUTORA',
    'VER', 'VEREADOR', 'VEREADORA',
    'DOM', 'DONA', 'SR', 'SRA',
    'ESCOLA', 'MUNICIPAL'
  ]);

  function ehRuido(t) { return TITULOS.has(t) || SIGLAS_TIPO.has(t); }

  /* Chave de casamento: sem pontuação, sem título/sigla, tokens ORDENADOS.
     A ordem sai da chave porque as grafias põem a sigla no começo ou no fim. */
  function chave(nome) {
    return normalizar(nome)
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t && !ehRuido(t); })
      .sort().join(' ');
  }

  /* Chave conservadora: mantém os tokens de tipo. Usada como primeira
     tentativa, para que duas unidades homônimas de tipos diferentes
     (a rede tem "X, EMEI" e "X, EMEF") não colidam. */
  function chaveComTipo(nome) {
    return normalizar(nome)
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return !!t && !TITULOS.has(t); })
      .sort().join(' ');
  }

  /* ⚠️ A coluna `tipo` de `escolas_catalogo` NÃO é a sigla: é a descrição por
     extenso ('ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL'). Medido em 2026-08:
     258 unidades em 15 tipos. Presumir que ali vinha 'EMEF' fez o filtro casar
     com ZERO e a tela do Comparativo ficar vazia.

     ⚠️ E o catálogo é MUITO mais amplo que a rede municipal — traz estaduais
     (70), convênios (43), OSC (13), parcerias (2). Os ~112 da rede são as três
     primeiras linhas desta tabela. Por isso a LISTA de quem aparece continua
     vindo de `escolas` (RLS): este catálogo serve para resolver NOME e TIPO,
     não para decidir quem entra na tela.

       descrição                                          sigla   qtd
       CENTRO DE EDUCACAO INFANTIL                        CEI      36
       ESCOLA MUNICIPAL DE EDUCACAO INFANTIL              EMEI     43
       ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL             EMEF     34
       ESCOLA MUNICIPAL DE ENSINO PROFISSIONAL E BASICO   EMEPB     1
       CENTRO EDUCACIONAL JORNADA AMPLIADA                CEJA      1
       ESCOLAS ESTADUAIS DO 1/5, 1/9, 6/9                 ESTADUAL 70
       CONVENIO (+ EDUCACAO ESPECIAL)                     CONVENIO 43
       ESCOLA VINCULADA / EXTENSOES SME                   EXTENSAO 11
       ORGANIZACAO DA SOCIEDADE CIVIL                     OSC      13
       PARCERIA / OUTRAS                                  OUTRAS    6 */
  function siglaDoTipo(descricao) {
    var d = normalizar(descricao);
    if (!d) return '';
    if (d.indexOf('ENSINO FUNDAMENTAL') >= 0 && d.indexOf('MUNICIPAL') >= 0) return 'EMEF';
    if (d.indexOf('EDUCACAO INFANTIL') >= 0 && d.indexOf('MUNICIPAL') >= 0) return 'EMEI';
    if (d.indexOf('CENTRO DE EDUCACAO INFANTIL') >= 0) return 'CEI';
    if (d.indexOf('PROFISSIONAL') >= 0) return 'EMEPB';
    if (d.indexOf('JORNADA AMPLIADA') >= 0) return 'CEJA';
    if (d.indexOf('ESTADUAL') >= 0 || d.indexOf('ESTADUAIS') >= 0) return 'ESTADUAL';
    if (d.indexOf('CONVENIO') >= 0) return 'CONVENIO';
    if (d.indexOf('VINCULADA') >= 0 || d.indexOf('EXTENSOES') >= 0) return 'EXTENSAO';
    if (d.indexOf('SOCIEDADE CIVIL') >= 0) return 'OSC';
    if (d.indexOf('PARCERIA') >= 0) return 'PARCERIA';
    return '';   // desconhecido: quem chama cai para a dedução pelo nome
  }

  /* Tipo pelo TOKEN inteiro do nome — reserva para quando o catálogo não
     traz `tipo`, ou traz uma descrição que ainda não sabemos mapear.
     ⚠️ Por substring não serve: 'CONCEICAO' contém 'CEI'.
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
            // `tipo` é a SIGLA (o que o resto do sistema usa); a descrição
            // crua fica em `tipoDescricao` para diagnóstico.
            tipo: siglaDoTipo(e.tipo) || tipoPeloNome(e.nome),
            tipoDescricao: String(e.tipo || '').trim(),
            setor: e.setor
          };
        });
        _porChave = new Map();
        _memoOficial = new Map();
        /* ⚠️ AMBIGUIDADE NÃO RESOLVE — fica `null` e o nome passa intacto.
           Vale para as DUAS chaves. A chave COM tipo também colide: duas
           unidades do mesmo tipo que difiram só por um título ("JOAO SILVA,
           PROFº., EMEF" e "JOAO SILVA, EMEF") geram a mesma chave, porque
           PROF é ruído. Sem esta guarda a segunda sobrescrevia a primeira e
           um dos nomes passava a resolver para a unidade ERRADA — o mesmo
           defeito silencioso do casamento por subconjunto do boletim.html.
           Preferir não resolver a resolver errado: errar para o lado de não
           canonizar é visível; casar com a escola errada não é. */
        function indexar(k, u) {
          if (_porChave.has(k)) _porChave.set(k, null);   // ambígua
          else _porChave.set(k, u);
        }
        _catalogo.forEach(function (u) {
          indexar('T|' + chaveComTipo(u.nome), u);
          indexar('S|' + chave(u.nome), u);
        });
        return _catalogo;
      })
      .catch(function (err) { _promessa = null; throw err; });
    return _promessa;
  }

  /* Linhas SINTÉTICAS: agregados que ocupam a coluna de unidade sem serem uma.
     `av_diag_item` traz uma linha 'REDE' (medido em 2026-08-24, 34 grafias, 33
     escolas + esta). Elas não casam com o catálogo, e nem deveriam.

     ⚠️ Por que isso não é frescura: sem a lista, `relatar()` avisaria sobre
     'REDE' em TODA abertura da tela de Diagnóstica. Aviso que sempre aparece é
     aviso que as pessoas aprendem a ignorar — e aí o dia em que uma unidade de
     verdade sumir, ninguém vai olhar. É o mesmo motivo pelo qual a conferência
     Rede × Turma segue desligada (seção 2).

     ⚠️ `oficial()` continua devolvendo o nome intacto: sintético não é
     descartado, só não entra na lista de "investigue isto". Só entre aqui
     rótulo que você confirmou ser agregado — unidade de verdade colocada nesta
     lista some do aviso, que é exatamente o defeito invisível. */
  var SINTETICOS = new Set(['REDE', 'TOTAL', 'GERAL', 'TODAS', 'TODAS AS UNIDADES']);

  function ehSintetico(nome) {
    return SINTETICOS.has(normalizar(nome).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim());
  }

  function registro(nome) {
    if (!_porChave || !nome) return null;
    var u = _porChave.get('T|' + chaveComTipo(nome));
    if (u) return u;
    u = _porChave.get('S|' + chave(nome));
    if (u) return u;
    var bruto = String(nome).trim();
    if (bruto && !ehSintetico(bruto)) _naoResolvidos.set(bruto, (_naoResolvidos.get(bruto) || 0) + 1);
    return null;
  }

  /* ⚠️ Devolve o nome RECEBIDO quando não resolve. Nunca vazio, nunca nulo:
     é o que garante que adotar este módulo não faça unidade sumir. */
  /* ⚠️ Memo. `oficial()` é chamada DENTRO de `filter()` sobre milhares de
     linhas (o boletim varre a base inteira para achar as linhas da escola), e
     cada chamada normaliza, parte, ordena e junta tokens duas vezes. O memo é
     seguro porque a função é pura depois de `carregar()`, e é pequeno: as
     entradas distintas são os ~258 nomes do catálogo mais as grafias das
     fontes. Ele é zerado junto com o catálogo, senão sobreviveria a um
     recarregamento e devolveria o nome antigo. */
  var _memoOficial = new Map();

  function oficial(nome) {
    var bruto = String(nome || '').trim();
    if (!bruto) return '';
    if (_memoOficial.has(bruto)) return _memoOficial.get(bruto);
    var u = registro(bruto);
    var res = u ? u.nome : bruto;
    _memoOficial.set(bruto, res);
    return res;
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

  /* ⚠️ AVISO AUTOMÁTICO — é isto que impede o problema de voltar.
     A sonda manual só ajuda quem desconfia; o defeito de grafia é invisível
     justamente porque ninguém desconfia. Toda tela que resolve nome chama
     `relatar()` ao fim da carga, e o console acusa sozinho quantos nomes não
     casaram. Sem isso, "unidade faltando na tela" só aparece quando alguém
     conta as linhas na mão. */
  function relatar(ondeChamou) {
    var nr = naoResolvidos();
    if (!nr.length) return 0;
    console.warn('[MapaUnidades] ' + (ondeChamou || 'tela') + ': ' + nr.length
      + ' nome(s) de unidade NÃO casaram com o catálogo. Eles aparecem na tela '
      + 'com a grafia da fonte, e podem estar duplicando linha ou ficando de '
      + 'fora de uma agregação. Rode MapaDiagUnidades() para a lista, e '
      + 'cadastre em escola_alias o que não for erro de digitação.');
    console.table(nr.slice(0, 20));
    return nr.length;
  }

  window.MapaUnidades = {
    relatar: relatar,
    carregar: carregar,
    oficial: oficial,
    tipo: tipo,
    codigo: codigo,
    nomePorCodigo: nomePorCodigo,
    todas: todas,
    chave: chave,
    tipoPeloNome: tipoPeloNome,
    siglaDoTipo: siglaDoTipo,
    ehSintetico: ehSintetico,
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
      cat.forEach(function (u) {
        var k = u.tipo + ' | ' + (u.tipoDescricao || '');
        porTipo[k] = (porTipo[k] || 0) + 1;
      });
      console.info('[MapaDiagUnidades] catálogo escolas_catalogo:', cat.length,
        'unidades. ⚠️ Ele é mais amplo que a rede municipal — traz estadual, '
        + 'convênio, OSC. Quem entra na tela é a lista do RLS, não este catálogo.');
      console.table(Object.keys(porTipo).sort().map(function (k) {
        var p = k.split(' | ');
        return { sigla: p[0], descricao_no_catalogo: p[1], unidades: porTipo[k] };
      }));

      var alvo = tipoAlvo
        ? cat.filter(function (u) { return u.tipo === String(tipoAlvo).toUpperCase(); })
        : cat;
      if (tipoAlvo) {
        console.info('[MapaDiagUnidades]', alvo.length, String(tipoAlvo).toUpperCase(), 'no catálogo');
        if (!alvo.length) {
          console.warn('[MapaDiagUnidades] nenhum "' + tipoAlvo + '" no catálogo. '
            + 'As siglas válidas são as da coluna `sigla` da tabela acima — '
            + 'a coluna `tipo` do banco guarda a descrição por extenso.');
        }
      }

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
      } else if (naTela && naTela.length) {
        console.info('[MapaDiagUnidades] todos os nomes vistos até agora casaram.');
      } else {
        console.info('[MapaDiagUnidades] nenhum nome foi resolvido ainda — '
          + 'a tela não carregou dado, ou o filtro não casou com nada. '
          + 'Isto NÃO quer dizer que está tudo certo.');
      }
      return { catalogo: cat.length, alvo: alvo.length, naoResolvidos: nr };
    });
  };
})();
