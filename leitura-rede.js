/* ============================================================================
   leitura-rede.js — o NÍVEL DE LEITURA da rede, por unidade × ano escolar

   Terceira exceção deliberada ao "cada tela é autocontida" (as outras são
   `visao-rede.js` e `ficha-coderp.js`). Ela existe porque a tela Comparativo
   de Escolas e a Análise de Desempenho respondem perguntas diferentes sobre
   EXATAMENTE o mesmo cálculo: quantos alunos de cada unidade estão em cada
   nível de leitura, em cada avaliação. Duas cópias divergiriam na primeira
   correção feita numa só.

   ⚠️ A escala tem SEIS níveis, não cinco. É a de `labelRespostaPainel` em
   `avaliacao.html` (LEITURA, `fqr_vl` 1..6) e a das colunas de
   `v_fluencia_por_turma`. Depois do N4 Pré-leitor vem o Leitor Iniciante, e
   depois dele o Fluente. Não invente um 'N5'.

   ⚠️ "LEITOR" é L. Iniciante + L. Fluente, e isso NÃO é escolha desta tela:
   é a definição que o sistema já usa em `ehRespostaAdequada()`, que decide o
   selo Adequado/Alerta/Crítico das telas de bimestre. Se mudar lá, mude aqui.

   Fontes (as três medem a MESMA grandeza):
     Fluência Leitora  → Supabase, view `v_fluencia_por_turma`
     Diagnóstica       → Supabase, RPC `alunos_diagnostica` (eixo LEITURA)
     1º a 4º bimestre  → CODERP, via `ficha-coderp.js` (eixo LEITURA)

   Uso:
     const dados = await MapaLeitura.carregar();   // { unidades, porAvaliacao }
     MapaLeitura.percentual(dados.porAvaliacao['1-bim'], unidade, ano, 'leitores')
   ========================================================================= */
(function () {
  'use strict';

  /* Os seis níveis, do mais inicial ao mais avançado. `vl` é o código que o
     CODERP e a RPC devolvem; `key` é a coluna de `v_fluencia_por_turma`. */
  var NIVEIS = [
    { key: 'pre_n1',     label: 'N1 Pré-leitor', vl: '1' },
    { key: 'pre_n2',     label: 'N2 Pré-leitor', vl: '2' },
    { key: 'pre_n3',     label: 'N3 Pré-leitor', vl: '3' },
    { key: 'pre_n4',     label: 'N4 Pré-leitor', vl: '4' },
    { key: 'iniciantes', label: 'L. Iniciante',  vl: '5' },
    { key: 'fluentes',   label: 'L. Fluente',    vl: '6' }
  ];

  /* Agrupamentos. 'leitores' é o que a tela mostra por padrão — a pergunta
     que a SME faz é "quantos já leem", não "quantos estão no N3".
     ⚠️ O corte de `leitores` é o MESMO de `ehRespostaAdequada()`. */
  var GRUPOS = {
    leitores:   { label: 'Leitores (Iniciante + Fluente)', membros: ['iniciantes', 'fluentes'] },
    preleitores:{ label: 'Pré-leitores (N1 a N4)',         membros: ['pre_n1', 'pre_n2', 'pre_n3', 'pre_n4'] }
  };

  var AVALIACOES = [
    { key: 'fluencia',    label: 'Fluência Leitora' },
    { key: 'diagnostica', label: 'Diagnóstica' },
    { key: '1-bim',       label: '1º Bim' },
    { key: '2-bim',       label: '2º Bim' },
    { key: '3-bim',       label: '3º Bim' },
    { key: '4-bim',       label: '4º Bim' }
  ];

  function normalizar(txt) {
    return String(txt || '').trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[º°]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  /* ⚠️ Casar nome de unidade por igualdade de texto NÃO funciona, e foi o que
     deixou metade da tabela vazia: o catálogo diz "ALFEU LUIZ GASPARINI,
     PROFº., EMEF" e o dado diz "EMEF ALFEU LUIZ GASPARINI PROF". Esta é a
     MESMA chave que a `avaliacao.html` usa (`tokensUnidade`): sem pontuação,
     e com os tokens ORDENADOS, para que a ordem das palavras não importe.
     O que nem isso resolve é assunto de `escola_alias`, no banco. */
  function chaveUnidade(nome) {
    return normalizar(nome)
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean)
      .sort().join(' ');
  }

  /* Tipo da unidade pelo TOKEN inteiro do nome (CEI / EMEI / EMEF / …).
     ⚠️ Casar por substring não serve: 'CONCEICAO' contém 'CEI', e a unidade
     viraria creche. Esta é a forma da `analise-jornada.html`, que já trata
     isso; a de `atribuicao.html` usa `includes` e tem esse defeito.
     A ordem importa: EMEIEF precisa ser testado antes de EMEI e de EMEF,
     senão uma unidade que atende as duas etapas cai na primeira que casar. */
  function tipoUnidade(nome) {
    var toks = new Set(normalizar(nome).split(/[^A-Z0-9]+/).filter(Boolean));
    var ordem = ['CEMEI', 'EMEIEF', 'CEEEF', 'EMEF', 'EMEI', 'CEI'];
    for (var i = 0; i < ordem.length; i++) if (toks.has(ordem[i])) return ordem[i];
    return 'Outras';
  }

  /* '2º ANO', '2 ANO', '2' -> '2'. Vazio quando não há dígito. */
  function digitoAno(s) {
    var m = String(s || '').match(/(\d)/);
    return m ? m[1] : '';
  }

  function somar(mapa, unidade, ano, nivelKey, qtd) {
    if (!qtd) return;
    var u = chaveUnidade(unidade), a = digitoAno(ano);
    if (!u || !a) return;
    if (!mapa[u]) mapa[u] = {};
    if (!mapa[u][a]) mapa[u][a] = { _tot: 0 };
    mapa[u][a][nivelKey] = (mapa[u][a][nivelKey] || 0) + qtd;
    mapa[u][a]._tot += qtd;
  }

  /* O PostgREST corta em 1.000 linhas e não avisa. Toda consulta vai paginada
     e COM order(): sem ordem estável as páginas repetem e perdem linhas. */
  function buscarTudo(tabela, colunas, ordem) {
    var supa = window.MAPA_SB, PAG = 1000, saida = [];
    function pagina(de) {
      var q = supa.from(tabela).select(colunas);
      ordem.forEach(function (c) { q = q.order(c); });
      return q.range(de, de + PAG - 1).then(function (r) {
        if (r.error) throw r.error;
        var d = r.data || [];
        saida = saida.concat(d);
        return d.length < PAG ? saida : pagina(de + PAG);
      });
    }
    return pagina(0);
  }

  /* ── Fluência Leitora ────────────────────────────────────────────────────
     A view já vem contada por turma; só somamos as turmas da unidade.
     `ausentes` fica FORA do denominador: o percentual é sobre quem foi
     avaliado, senão a unidade que faltou mais parece melhor ou pior. */
  function carregarFluencia() {
    return buscarTudo(
      'v_fluencia_por_turma',
      'escola,ano_escolar,avaliados,fluentes,iniciantes,pre_n4,pre_n3,pre_n2,pre_n1',
      ['escola', 'ano_escolar']
    ).then(function (linhas) {
      var mapa = {};
      linhas.forEach(function (l) {
        NIVEIS.forEach(function (n) {
          somar(mapa, l.escola, l.ano_escolar, n.key, Number(l[n.key]) || 0);
        });
      });
      return mapa;
    });
  }

  /* ── Diagnóstica ─────────────────────────────────────────────────────────
     Uma linha por aluno; o eixo LEITURA é `l_valor` (posição 7 no array).
     'Não Avaliado' não entra — mesmo critério da Fluência. */
  function carregarDiagnostica() {
    var porVl = {};
    NIVEIS.forEach(function (n) { porVl[n.vl] = n.key; });
    return window.MAPA_SB.rpc('alunos_diagnostica').then(function (r) {
      if (r.error) throw r.error;
      var mapa = {};
      (r.data || []).forEach(function (row) {
        var arr = Array.isArray(row);
        var chave = porVl[String((arr ? row[7] : row.l_valor) || '').trim()];
        if (chave) somar(mapa, arr ? row[0] : row.nome_unidade,
                              arr ? row[1] : row.ano_escolar, chave, 1);
      });
      return mapa;
    });
  }

  function ehLeitura(fneDes) {
    return normalizar(fneDes).indexOf('LEITURA') >= 0;
  }

  /* ── 1º a 4º bimestre ────────────────────────────────────────────────────
     ⚠️ NÃO usa `alunosPorItens()`, e isso é o que torna esta coluna exata.
     Aquela regra existe para descobrir o tamanho da turma olhando VÁRIOS
     itens sem saber quantas perguntas cada um vale. Aqui é dentro de UM item
     (o eixo LEITURA), onde `qtd_alunos` já conta alunos DISTINTOS por
     resposta — somar as respostas do item dá o número exato em cada nível.
     🚫 Não replique este atalho para "quantos alunos tem a turma". */
  function carregarBimestre(F, bimestre, catalogo) {
    var porVl = {};
    NIVEIS.forEach(function (n) { porVl[n.vl] = n.key; });

    return Promise.all(F.FICHA_ANOS_ESCOLARES.map(function (ano) {
      return F.fichaRedeTurma(bimestre, ano).catch(function (err) {
        if (err && err.coderpStatus === 404) return [];   // sem lançamento
        console.warn('[leitura-rede] bim ' + bimestre + ' / ' + ano + ':', err && err.message);
        return null;                                      // falha de verdade
      });
    })).then(function (porAno) {
      if (porAno.every(function (r) { return r === null; })) return null;
      var mapa = {};
      porAno.forEach(function (linhas) {
        (linhas || []).forEach(function (l) {
          if (!F.perCodContavel(l.per_cod)) return;
          if (!ehLeitura(l.fne_des)) return;
          var chave = porVl[String(l.fqr_vl || '').trim()];
          if (!chave) return;
          var unidade = catalogo.get(Number(l.uni_cod));
          if (!unidade) return;            // código fora do catálogo CODERP
          somar(mapa, unidade, l.per_cod, chave, Number(l.qtd_alunos) || 0);
        });
      });
      return mapa;
    });
  }

  /* Catálogo do CODERP: código -> nome. Separado do `escolas` do RLS de
     propósito (ver CLAUDE.md). Unidade cujo código não está aqui não entra:
     melhor faltar linha visível que somar no lugar errado. */
  function carregarCatalogoCoderp() {
    return window.MAPA_SB.from('escolas_catalogo').select('codigo,nome').then(function (r) {
      if (r.error) throw r.error;
      var m = new Map();
      (r.data || []).forEach(function (e) {
        m.set(Number(e.codigo), String(e.nome || '').trim());
      });
      return m;
    });
  }

  /* Lista oficial de unidades — com o recorte de RLS de sempre.
     `tipos` recorta por tipo de unidade (ex.: ['EMEF']). Isso é CONFORTO
     VISUAL, não segurança: quem entrega a lista é o RLS. Serve para tirar da
     tabela quem não tem 1º a 5º ano — EMEI e CEI não têm, e apareceriam com
     tudo '—'. */
  function carregarUnidades(tipos) {
    return window.MAPA_SB.from('escolas').select('nome').eq('ativo', true)
      .order('nome').then(function (r) {
        if (r.error) throw r.error;
        var nomes = (r.data || []).map(function (e) { return e.nome; });
        if (!tipos || !tipos.length) return nomes;
        var alvo = new Set(tipos);
        return nomes.filter(function (n) { return alvo.has(tipoUnidade(n)); });
      });
  }

  /* ── Percentual de um nível (ou grupo) dentro de unidade × ano ────────────
     Denominador = alunos COM nível apurado no recorte. Devolve null quando
     não há apuração: a tela mostra '—', nunca 0% — zero se lê como "ninguém
     está nesse nível" quando a verdade é "não foi medido". */
  function percentual(mapaFonte, unidade, ano, alvo) {
    if (!mapaFonte) return null;
    var u = mapaFonte[chaveUnidade(unidade)];
    if (!u) return null;

    var membros = GRUPOS[alvo] ? GRUPOS[alvo].membros : [alvo];
    var anos = ano === 'TODOS' ? Object.keys(u) : [digitoAno(ano)];
    var noAlvo = 0, total = 0;
    anos.forEach(function (a) {
      var balde = u[a];
      if (!balde) return;
      membros.forEach(function (m) { noAlvo += balde[m] || 0; });
      total += balde._tot || 0;
    });
    if (!total) return null;
    return Math.round((noAlvo / total) * 100);
  }

  /* Quantos alunos há em cada nível, na unidade × ano (números absolutos). */
  function contagem(mapaFonte, unidade, ano) {
    if (!mapaFonte) return null;
    var u = mapaFonte[chaveUnidade(unidade)];
    if (!u) return null;
    var anos = ano === 'TODOS' ? Object.keys(u) : [digitoAno(ano)];
    var saida = { _tot: 0 }, achou = false;
    NIVEIS.forEach(function (n) { saida[n.key] = 0; });
    anos.forEach(function (a) {
      var balde = u[a];
      if (!balde) return;
      achou = true;
      NIVEIS.forEach(function (n) { saida[n.key] += balde[n.key] || 0; });
      saida._tot += balde._tot || 0;
    });
    return achou && saida._tot ? saida : null;
  }

  /* ── Carga completa ──────────────────────────────────────────────────────
     Cada fonte é independente: uma falhar não pode zerar as outras. Fonte que
     falha fica `null` e a coluna dela sai '—' — mas o console diz QUAL falhou,
     senão o traço esconde "não consegui ler" como se fosse "não tem dado". */
  function carregar(opcoes) {
    var opts = opcoes || {};
    var saida = { unidades: [], porAvaliacao: {}, falhas: [] };

    return carregarUnidades(opts.tipos).then(function (unidades) {
      saida.unidades = unidades;

      return carregarCatalogoCoderp().catch(function (err) {
        console.error('[leitura-rede] escolas_catalogo falhou:', err);
        saida.falhas.push('catálogo CODERP');
        return null;
      }).then(function (catalogo) {
        var F = null;
        if (catalogo && window.MapaFicha) {
          var cfg = window.MAPA_SUPABASE || {};
          F = window.MapaFicha.criar(cfg.url || '');
        }

        var tarefas = [
          ['fluencia',    carregarFluencia()],
          ['diagnostica', carregarDiagnostica()]
        ];
        if (F) {
          [1, 2, 3, 4].forEach(function (b) {
            tarefas.push([b + '-bim', carregarBimestre(F, b, catalogo)]);
          });
        }

        return Promise.all(tarefas.map(function (t) {
          return t[1].then(function (v) { return { ok: true, v: v }; },
                           function (e) { return { ok: false, e: e }; });
        })).then(function (res) {
          res.forEach(function (r, i) {
            var chave = tarefas[i][0];
            if (r.ok) { saida.porAvaliacao[chave] = r.v; return; }
            console.error('[leitura-rede] ' + chave + ' falhou:', r.e);
            saida.porAvaliacao[chave] = null;
            saida.falhas.push(chave);
          });
          return saida;
        });
      });
    });
  }

  window.MapaLeitura = {
    NIVEIS: NIVEIS,
    GRUPOS: GRUPOS,
    AVALIACOES: AVALIACOES,
    chaveUnidade: chaveUnidade,
    tipoUnidade: tipoUnidade,
    digitoAno: digitoAno,
    carregar: carregar,
    percentual: percentual,
    contagem: contagem
  };
})();
