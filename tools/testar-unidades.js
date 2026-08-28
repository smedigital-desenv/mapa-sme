/* ============================================================================
   tools/testar-unidades.js — teste do resolvedor de nome (`unidades.js`)

     node tools/testar-unidades.js      # sai 0 se tudo passa, 1 se algo falha

   POR QUE ELE EXISTE. `unidades.js` é a peça cujo defeito é INVISÍVEL: quando
   ela erra, a tela abre, tem linhas, e só falta uma unidade — ninguém olha o
   console porque nada pareceu errado. É também a única peça do MAPA que dá
   para exercitar sem banco, porque o casamento de nome é função pura do
   catálogo. O catálogo abaixo é INVENTADO de propósito: este repositório é
   público, e o teste não precisa de dado real para valer.

   ⚠️ Isto NÃO substitui ver a tela com dado real. Ele prova que a regra de
   casamento faz o que diz; não prova que o catálogo do dia cobre as grafias
   que as fontes estão mandando. Para isso é a sonda `MapaDiagUnidades()`, no
   navegador, e o aviso automático de `MapaUnidades.relatar()`.
   ========================================================================= */
'use strict';

/* Catálogo de teste — cada linha existe por um caso, não para parecer real. */
var CATALOGO = [
  { codigo: 1, nome: 'ALFEU LUIZ GASPARINI, PROFº., EMEF', tipo: 'ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL' },
  // homônimas de tipos DIFERENTES: têm de continuar distinguíveis
  { codigo: 2, nome: 'MARIA SOUZA, EMEF',  tipo: 'ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL' },
  { codigo: 3, nome: 'MARIA SOUZA, EMEI',  tipo: 'ESCOLA MUNICIPAL DE EDUCACAO INFANTIL' },
  // homônimas do MESMO tipo, diferindo só por um título que a chave remove:
  // ambíguas, e o certo é DESISTIR — resolver para uma delas seria pior que
  // não resolver, porque o resultado errado parece certo.
  { codigo: 4, nome: 'JOAO SILVA, PROFº., EMEF', tipo: 'ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL' },
  { codigo: 5, nome: 'JOAO SILVA, EMEF',         tipo: 'ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL' },
  // siglas de tipo que já estiveram fora de SIGLAS_TIPO e custavam casamento
  { codigo: 6, nome: 'BAIRRO ALEGRE, CRECHE', tipo: 'CENTRO DE EDUCACAO INFANTIL' },
  { codigo: 7, nome: 'VILA NOVA, EEI',        tipo: 'CENTRO DE EDUCACAO INFANTIL' },
  /* ⚠️ CASO REAL, e o único que já causou dado errado em produção. A rede tem
     de fato estas DUAS unidades (confirmado pela SME em 2026-08-24). O
     casamento por subconjunto da `boletim.html` as declarava iguais, e o
     boletim da matriz somava os alunos da Unidade II. Estes nomes são
     públicos e não identificam ninguém. */
  { codigo: 8, nome: 'MATRIZ E ANEXO, EMEF',          tipo: 'ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL' },
  { codigo: 9, nome: 'MATRIZ E ANEXO, EMEF - UN. II', tipo: 'ESCOLA MUNICIPAL DE ENSINO FUNDAMENTAL' },
];

/* `unidades.js` é um IIFE de navegador: publica em `window` e lê o catálogo
   por `window.MAPA_SB`. Aqui damos os dois, sem nenhum outro arreio. */
/* Apelidos: o que regra de token nenhuma resolve. Copiam a FORMA dos casos
   reais (`escola_alias`), não o conteúdo — nomes inventados, como o resto. */
var ESCOLAS = [   // o catálogo do RLS; `escola_alias.escola_id` aponta para ele
  { id: 10, nome: 'MATRIZ E ANEXO, EMEF' },
  { id: 11, nome: 'MATRIZ E ANEXO, EMEF - UN. II' },
  { id: 12, nome: 'ALFEU LUIZ GASPARINI, PROFº., EMEF' },
];
var ALIAS = [
  // 'UNID I' quer dizer a MATRIZ, e 'Unidade II' quer dizer a OUTRA escola.
  // Nenhuma normalização adivinha isso: é dado, conferido por gente.
  { nome_no_dado: 'MATRIZ E ANEXO, EMEF - UNID I',   escola_id: 10, fora_da_rede: false },
  { nome_no_dado: 'Matriz E Anexo Unidade II, EMEF', escola_id: 11, fora_da_rede: false },
  // forma longa do nome, que o catálogo registra curta
  { nome_no_dado: 'ALFEU LUIZ GASPARINI DE SOUZA, PROF., EMEF', escola_id: 12, fora_da_rede: false },
  // escola particular que aparece legitimamente no dado (aluno de liminar)
  { nome_no_dado: 'COLEGIO PARTICULAR QUALQUER',     escola_id: null, fora_da_rede: true },
];

/* O stub responde POR TABELA, e aceita `.select().order()` e `.select()`
   direto — as duas formas que o módulo usa. */
var RESPOSTAS = { escolas_catalogo: CATALOGO, escolas: ESCOLAS, escola_alias: ALIAS };
global.window = {
  MAPA_SB: {
    from: function (tabela) {
      var dados = RESPOSTAS[tabela] || [];
      var resp = { data: dados, error: null };
      return { select: function () { return {
        order: function () { return Promise.resolve(resp); },
        then: function (f, g) { return Promise.resolve(resp).then(f, g); }
      }; } };
    }
  }
};
global.document = { addEventListener: function () {} };

require('../unidades.js');
var U = global.window.MapaUnidades;

var CASOS = [
  ['EMEF ALFEU LUIZ GASPARINI PROF', 'ALFEU LUIZ GASPARINI, PROFº., EMEF',
   'sigla no começo em vez do fim, título abreviado, pontuação a menos'],
  ['EMEF MARIA SOUZA', 'MARIA SOUZA, EMEF', 'homônima de outro tipo: escolhe a EMEF'],
  ['EMEI MARIA SOUZA', 'MARIA SOUZA, EMEI', 'homônima de outro tipo: escolhe a EMEI'],
  ['MARIA SOUZA', 'MARIA SOUZA',
   'homônima SEM o tipo: ambígua, passa intacta em vez de chutar'],
  ['EMEF JOAO SILVA', 'EMEF JOAO SILVA',
   'ambígua por título: passa intacta em vez de resolver para a errada'],
  ['BAIRRO ALEGRE', 'BAIRRO ALEGRE, CRECHE', 'sigla CRECHE só de um lado'],
  ['EEI VILA NOVA', 'VILA NOVA, EEI', 'sigla EEI só de um lado'],
  ['ESCOLA QUE NAO EXISTE', 'ESCOLA QUE NAO EXISTE',
   'desconhecida: oficial() NUNCA descarta um nome'],
  ['MATRIZ E ANEXO, EMEF', 'MATRIZ E ANEXO, EMEF',
   'a matriz resolve para si, NÃO para a unidade II'],
  ['MATRIZ E ANEXO, EMEF - UN. II', 'MATRIZ E ANEXO, EMEF - UN. II',
   'a unidade II resolve para si, NÃO para a matriz'],
  ['EMEF MATRIZ E ANEXO', 'MATRIZ E ANEXO, EMEF',
   'grafia da fonte sem o sufixo: é a MATRIZ'],

  /* ── apelidos (`escola_alias`): o que a regra de token não alcança ── */
  ['MATRIZ E ANEXO, EMEF - UNID I', 'MATRIZ E ANEXO, EMEF',
   'apelido: "UNID I" é a MATRIZ (o catálogo não tem esse sufixo)'],
  ['Matriz E Anexo Unidade II, EMEF', 'MATRIZ E ANEXO, EMEF - UN. II',
   'apelido: "Unidade II" é a OUTRA escola — o par que já custou dado errado'],
  ['ALFEU LUIZ GASPARINI DE SOUZA, PROF., EMEF', 'ALFEU LUIZ GASPARINI, PROFº., EMEF',
   'apelido: forma longa do nome, que token nenhum resolve'],
  ['COLEGIO PARTICULAR QUALQUER', 'COLEGIO PARTICULAR QUALQUER',
   'fora da rede: passa intacta (e NÃO conta como órfã)'],
];

U.carregar().then(function () {
  var falhas = 0;
  CASOS.forEach(function (c) {
    var obtido = U.oficial(c[0]);
    var ok = obtido === c[1];
    if (!ok) falhas++;
    console.log((ok ? '  ok  ' : ' FALHA') + ' │ ' + c[2]);
    console.log('        ' + JSON.stringify(c[0]) + ' → ' + JSON.stringify(obtido)
      + (ok ? '' : '   ⚠️ esperado ' + JSON.stringify(c[1])));
  });

  /* O tipo e o recorte por tipo — foi presumir que a coluna `tipo` trazia a
     sigla (traz a descrição) que deixou o Comparativo vazio em homologação. */
  var checa = [
    ['tipo() pelo catálogo', U.tipo('EMEF ALFEU LUIZ GASPARINI PROF'), 'EMEF'],
    ['todas({tipos:[CEI]})',  U.todas({ tipos: ['CEI'] }).length, 2],
    /* Fora-da-rede e sintético são casos CLASSIFICADOS, não órfãos: contá-los
       encheria o aviso de linha já resolvida, e aviso ruidoso é aviso ignorado.
       Continuam sendo 3: as duas ambíguas e a desconhecida. */
    ['naoResolvidos() lista só as 3 órfãs de verdade', U.naoResolvidos().length, 3],
    /* A trava contra a regressão: matriz e unidade II NÃO podem colapsar. */
    ['matriz e unidade II continuam distintas',
     U.oficial('MATRIZ E ANEXO, EMEF') === U.oficial('MATRIZ E ANEXO, EMEF - UN. II'), false],
    ['todas({tipos:[EMEF]}) conta as duas', U.todas({ tipos: ['EMEF'] }).length, 6],
  ];
  checa.forEach(function (c) {
    var ok = c[1] === c[2];
    if (!ok) falhas++;
    console.log((ok ? '  ok  ' : ' FALHA') + ' │ ' + c[0] + ': ' + c[1]
      + (ok ? '' : '   ⚠️ esperado ' + c[2]));
  });

  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> todos os casos passaram');
  process.exit(falhas ? 1 : 0);
}).catch(function (e) {
  console.error('erro ao carregar o catálogo de teste:', e);
  process.exit(1);
});
