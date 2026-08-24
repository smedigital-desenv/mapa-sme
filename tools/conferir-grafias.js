/* ============================================================================
   tools/conferir-grafias.js — as grafias reais casam com o catálogo?

     node tools/conferir-grafias.js <catalogo.txt> <grafias.txt> [mais...]

   POR QUE ELE EXISTE. `testar-unidades.js` prova que a REGRA de casamento faz
   o que diz. Ele não prova o que importa na hora de migrar uma tela: se o
   catálogo DE HOJE cobre as grafias que as fontes estão mandando HOJE. Essa
   pergunta é função pura de duas listas de NOMES DE ESCOLA — não precisa de
   sessão, de proxy nem de acesso ao banco, e não toca em dado pessoal.

   ⚠️ NÃO versione os arquivos de entrada. Eles não têm dado pessoal, mas este
   repositório é público e a regra da rede é não versionar export. Deixe-os
   fora da árvore (use um diretório temporário) — o .gitignore cobre .csv, mas
   não cobre .txt.

   COMO OBTER AS ENTRADAS (SQL Editor do Supabase, sem exportar dado de aluno):

     -- catalogo.txt   (nome<TAB>tipo)
     select nome, tipo from public.escolas_catalogo order by nome;

     -- grafias de cada fonte: os nomes DISTINTOS que ela manda, ex.:
     select distinct nome_unidade from public.<tabela_da_fonte> order by 1;

   Formato aceito: um nome por linha. Se houver TAB ou ';', a 1ª coluna é o
   nome e a 2ª (se houver) é o tipo. Linhas vazias e '#' são ignoradas.

   O QUE ELE RESPONDE, e por que cada parte importa:
     1. grafias que NÃO casaram      -> candidatas a `escola_alias`
     2. grafias AMBÍGUAS             -> o catálogo não as distingue; alias
     3. unidades do catálogo SEM nenhuma grafia -> as que SUMIRIAM da tela
   ========================================================================= */
'use strict';

var fs = require('fs');
var args = process.argv.slice(2);
if (args.length < 2) {
  console.error('uso: node tools/conferir-grafias.js <catalogo.txt> <grafias.txt> [mais...]');
  process.exit(2);
}

/* Uma linha do arquivo -> {nome, tipo}.

   ⚠️ O SQL Editor do Supabase exporta CSV COM ASPAS, e nomes de escola têm
   vírgula por dentro ('ALCINA DOS SANTOS HECK, EMEF'). Partir a linha por
   vírgula cortaria o nome ao meio e a sigla viraria o "tipo" — o casamento
   despencaria por defeito do LEITOR, não do resolvedor, que é o pior jeito de
   perder tempo. Por isso o campo entre aspas é lido caractere a caractere,
   com "" valendo uma aspa literal. TAB e ';' seguem aceitos. */
function partirLinha(linha) {
  var campos = [], atual = '', dentro = false, i = 0;
  var sep = (linha.indexOf('\t') >= 0) ? '\t' : (linha.indexOf(';') >= 0 && linha.indexOf('"') < 0) ? ';' : ',';
  for (; i < linha.length; i++) {
    var c = linha[i];
    if (dentro) {
      if (c === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i++; }
        else dentro = false;
      } else atual += c;
    } else if (c === '"') dentro = true;
    else if (c === sep) { campos.push(atual); atual = ''; }
    else atual += c;
  }
  campos.push(atual);
  return campos.map(function (x) { return x.trim(); });
}

function ler(caminho) {
  var linhas = fs.readFileSync(caminho, 'utf8').split(/\r?\n/)
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l && l[0] !== '#'; });
  /* Cabeçalho exportado junto ('nome,tipo') não é uma unidade. */
  if (linhas.length && /^"?(nome|escola|nome_unidade)"?\s*[,;\t]/i.test(linhas[0])) linhas.shift();
  else if (linhas.length && /^"?(nome|escola|nome_unidade)"?$/i.test(linhas[0])) linhas.shift();
  return linhas.map(function (l) {
    var p = partirLinha(l);
    return { nome: (p[0] || '').trim(), tipo: (p[1] || '').trim() };
  }).filter(function (r) { return r.nome; });
}

var catalogo = ler(args[0]).map(function (r, i) {
  return { codigo: i + 1, nome: r.nome, tipo: r.tipo };
});

/* `unidades.js` é um IIFE de navegador: publica em `window` e lê o catálogo
   por `window.MAPA_SB`. Damos os dois, e nada mais. */
global.window = {
  MAPA_SB: { from: function () { return { select: function () { return {
    order: function () { return Promise.resolve({ data: catalogo, error: null }); }
  }; } }; } }
};
global.document = { addEventListener: function () {} };
require('../unidades.js');
var U = global.window.MapaUnidades;

U.carregar().then(function () {
  var oficiais = new Set(U.catalogo().map(function (u) { return u.nome; }));
  var atingidas = new Set();
  var falhas = [];
  var sinteticas = [];   // agregados ('REDE'), que não são unidade e não viram alias
  var totalGrafias = 0;

  args.slice(1).forEach(function (arq) {
    var grafias = ler(arq);
    var ok = 0;
    grafias.forEach(function (g) {
      totalGrafias++;
      var res = U.oficial(g.nome);
      if (oficiais.has(res)) { ok++; atingidas.add(res); }
      else if (U.ehSintetico(g.nome)) sinteticas.push({ fonte: arq, grafia: g.nome });
      else falhas.push({ fonte: arq, grafia: g.nome, virou: res });
    });
    /* O denominador exclui as sintéticas: elas não podem casar, e deixá-las
       dentro faria uma fonte 100% correta parecer 97%. */
    var reais = grafias.length - sinteticas.filter(function (x) { return x.fonte === arq; }).length;
    var pct = reais ? Math.round(ok / reais * 100) : 0;
    console.log('  ' + arq + ': ' + ok + '/' + reais + ' casaram (' + pct + '%)'
      + (reais !== grafias.length ? '  [+' + (grafias.length - reais) + ' sintética(s)]' : ''));
  });

  console.log('\ncatálogo: ' + catalogo.length + ' unidades   grafias lidas: ' + totalGrafias);

  /* Agregados não são unidade — separá-los é o que mantém a lista de falhas
     limpa. Cadastrar 'REDE' em `escola_alias` criaria uma escola fantasma. */
  if (sinteticas.length) {
    console.log('\n── ' + sinteticas.length + ' linha(s) SINTÉTICA(S) (agregado, não é unidade) ──');
    console.log('  Não são candidatas a `escola_alias`: a tela deve EXCLUÍ-LAS ao agregar.');
    console.table(sinteticas);
  }

  if (falhas.length) {
    console.log('\n── ' + falhas.length + ' grafia(s) NÃO casaram ' +
      '(cada uma é uma linha candidata a `escola_alias`) ──');
    console.table(falhas.slice(0, 60));
    if (falhas.length > 60) console.log('  … e mais ' + (falhas.length - 60));
  } else {
    console.log('\n✔ toda grafia lida casou com uma unidade do catálogo.');
  }

  /* ⚠️ ESTA É A LISTA QUE IMPORTA NA MIGRAÇÃO. Grafia que não casa aparece na
     tela com o nome da fonte — feio, mas visível. Unidade do catálogo que
     nenhuma grafia alcança é a que SOME, e ninguém percebe. */
  var orfas = U.catalogo().filter(function (u) { return !atingidas.has(u.nome); });
  console.log('\n── ' + orfas.length + ' unidade(s) do catálogo sem NENHUMA grafia ──');
  if (orfas.length) {
    console.log('  (esperado para quem não tem apuração no recorte — estaduais,');
    console.log('   convênios, OSC. Preocupante se aparecer EMEF/EMEI/CEI aqui.)');
    var porTipo = {};
    orfas.forEach(function (u) { porTipo[u.tipo || '?'] = (porTipo[u.tipo || '?'] || 0) + 1; });
    console.table(porTipo);
    var rede = orfas.filter(function (u) { return ['EMEF', 'EMEI', 'CEI'].indexOf(u.tipo) >= 0; });
    if (rede.length) {
      console.log('\n  ⚠️ ' + rede.length + ' da REDE MUNICIPAL sem grafia — investigue estas:');
      console.table(rede.map(function (u) { return { nome: u.nome, tipo: u.tipo }; }).slice(0, 40));
    }
  }

  process.exit(falhas.length ? 1 : 0);
}).catch(function (e) { console.error(e); process.exit(1); });
