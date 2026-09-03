/* ============================================================================
   tools/testar-planejamento.js — teste da agregação da tela de Planejamento

     node tools/testar-planejamento.js   # sai 0 se tudo passa, 1 se algo falha

   POR QUE ELE EXISTE. A `planejamento-atribuicao.html` responde "quantas
   turmas a rede tem, em todos os segmentos" — e o defeito dessa conta é
   INVISÍVEL: um `ano_escolar` que a regra não reconhece some do total, a tela
   abre, tem linhas, e o número está errado sem nada acusar. O mesmo vale para
   a moda do quadro de aulas: ela sempre devolve ALGUM número.

   O teste carrega o `<script>` da própria tela num DOM de mentira e o alimenta
   com linhas INVENTADAS — o repositório é público, e a regra de agregação é
   função pura das linhas, então não precisa de dado real para valer. Cada
   linha existe por um caso, não para parecer uma rede.

   O caso que mais importa é o último: a soma de TODA a carga da base tem de
   reaparecer no total, some ela em turma, em projeto ou nos baldes de fora.
   É essa igualdade que impede a tela de perder aula em silêncio.

   ⚠️ Isto NÃO substitui ver a tela com dado real. Ele prova que a agregação
   faz o que diz; não prova que a classificação de hoje cobre os valores de
   `ano_escolar` que a base está mandando hoje — para isso é a sonda
   `MapaDiagPlanejamento()`, no console, e o aviso de "Outros" no alto da tela.
   ========================================================================= */
'use strict';

const fs = require('fs'), vm = require('vm'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'planejamento-atribuicao.html'), 'utf8');
const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

// ── Linhas sintéticas (mesma forma da tabela `turmas`) ────────────────────
const L = (u, ano, letra, per, disc, ch) => ({
  nome_unidade:u, ano_escolar:ano, letra_turma:letra, periodo:per,
  descricao_disciplina:disc, carga_horaria:ch,
  codigo_professor_prop:'1', situacao_professor:'NA ATIVA',
});
const ROWS = [
  // EMEI ALFA — Etapa I integral, letra A: manhã e tarde = DUAS turmas
  L('ALFA, EMEI','ETAPA I - INTEGRAL - M','A','M','MAGISTERIO II',19),
  L('ALFA, EMEI','ETAPA I - INTEGRAL - T','A','T','MAGISTERIO II',19),
  L('ALFA, EMEI','ETAPA I - INTEGRAL','A','M','ARTE',2),
  L('ALFA, EMEI','ETAPA I - INTEGRAL','A','T','ARTE',2),
  // aula sem turno numa sala de DOIS turnos: é da sala, fica fora da moda
  L('ALFA, EMEI','ETAPA I - INTEGRAL','A','I','VIVENCIA ALIMENTACAO',5),
  // EMEI ALFA — Etapa II parcial manhã
  L('ALFA, EMEI','ETAPA II','A','M','MAGISTERIO II',19),
  L('ALFA, EMEI','ETAPA II','A','M','ARTE',2),
  // CEI BETA — Ciclo II, período só integral: 1 turma, turno "—"
  L('BETA, CEI','CICLO II','A','I','MAGISTERIO I',30),
  // EMEF GAMA — 1º ano, três turmas; a C tem 20 aulas de regência (divergente)
  L('GAMA, EMEF','1 ANO','A','M','MAGISTERIO II',19),
  L('GAMA, EMEF','1 ANO','A','M','EDUCACAO FISICA',2),
  L('GAMA, EMEF','1 ANO','A','M','INGLES',1),
  L('GAMA, EMEF','1 ANO','B','T','MAGISTERIO II',19),
  L('GAMA, EMEF','1 ANO','B','T','EDUCACAO FISICA',2),
  L('GAMA, EMEF','1 ANO','C','M','MAGISTERIO II',20),
  // 6º ano — só educação especial (anos finais)
  L('GAMA, EMEF','6 ANO','A','M','EDUCACAO ESPECIAL',5),
  // EJA
  L('GAMA, EMEF','1 TERMO','A','N','LINGUA PORTUGUESA',5),
  // ⚠️ contém ETAPA *e* LIMINAR: tem de cair em Liminar, não em Etapa II
  L('GAMA, EMEF','ETAPA II - PARCIAL - LIMINAR 12H/A','X','M','MAGISTERIO II',12),
  // ⚠️ unidade cujas linhas são TODAS de liminar: não cria sala nenhuma, e sem
  //    `unidadesVistas` sumiria da tela por unidade sem deixar rastro
  L('DELTA, EMEF','ETAPA I - PARCIAL - LIMINAR 12H/A','X','M','MAGISTERIO II',12),
  // projeto: nem turma, nem quadro
  L('GAMA, EMEF','1 ANO','A','M','PROFESSOR ALFABETIZADOR',8),
  // ano escolar desconhecido: vai para "Outros" e acende o aviso
  L('GAMA, EMEF','OFICINA DE XADREZ','A','T','OFICINA',4),
  // complemento de jornada
  L('GAMA, EMEF','SUBSTITUICAO','Z','M','MAGISTERIO II',6),
];

// ── DOM mínimo ────────────────────────────────────────────────────────────
const nos = {};
const fakeEl = () => ({ innerHTML:'', textContent:'', value:'', style:{}, dataset:{},
  classList:{ toggle(){}, add(){}, remove(){} }, addEventListener(){},
  querySelectorAll:()=>[], closest:()=>null, matches:()=>false, scrollIntoView(){} });
const document = {
  getElementById: id => (nos[id] ||= fakeEl()),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => fakeEl(),
};
const store = {};
const localStorage = { getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} };
const ctx = {
  document, localStorage, console,
  setTimeout, clearTimeout, Promise, Number, Math, Set, Map, JSON, Object, Array, String, Date, isNaN, parseInt, parseFloat,
  URL:{ createObjectURL:()=>'', revokeObjectURL:()=>{} }, Blob:function(){},
  fetch: async (url) => {
    if (String(url).includes('config_series_excluidas')) return { ok:true, json:async()=>[] };
    return { ok:true, json:async()=>ROWS, headers:{ get:()=>null } };
  },
};
ctx.window = ctx;
ctx.window.MapaAuth = { perfil:{ id:1 }, restritoEscola:false };
vm.createContext(ctx);
vm.runInContext(script, ctx, { filename:'planejamento.js' });
// `let` de topo de script vive no escopo léxico global, não no objeto global —
// por isso a ponte, num segundo script do MESMO realm.
vm.runInContext('globalThis.__get = () => ({ AGG, PLANO, turmasPlano, aulasPlano, totalPlanoAno, totalLancadoAno, totaisGerais, linhasUnidade, unidadesSemTurma });', ctx);

// ── Espera o carregar() assíncrono e confere ──────────────────────────────
setTimeout(() => {
  const P = ctx.__get();
  const A = P.AGG;
  if (!A) console.log('estado:', nos['estado'] && nos['estado'].innerHTML);
  let falhas = 0;
  const ok = (cond, msg, extra) => { console.log((cond?'  ok  ':'FALHA ')+msg+(extra!==undefined?'  → '+extra:'')); if(!cond) falhas++; };
  if (!A) { console.log('FALHA: AGG não montou'); process.exit(1); }

  const g = k => A.anos[k];
  console.log('\n— Classificação —');
  ok(!!g('Etapas|Etapa I'), 'Etapa I existe');
  ok(!!g('Etapas|Etapa II'), 'Etapa II existe');
  ok(!!g('Ciclos|Ciclo II'), 'Ciclo II existe');
  ok(!!g('FundI|1º Ano'), '1º Ano existe');
  ok(!!g('FundII|6º Ano'), '6º Ano existe');
  ok(!!g('EJA|1º Termo'), '1º Termo existe');
  ok(!!A.fora.Liminar, 'liminar foi para o balde de liminar');
  ok(!g('Etapas|Etapa II') || g('Etapas|Etapa II').turmas === 1,
     'a linha de LIMINAR não virou turma de Etapa II', g('Etapas|Etapa II').turmas);
  ok(!!A.fora.Outros && A.fora.Outros.aulas === 4, 'OFICINA DE XADREZ caiu em Outros', A.fora.Outros && A.fora.Outros.aulas);
  ok(!!A.fora.Complem && A.fora.Complem.aulas === 6, 'SUBSTITUICAO caiu em Complemento', A.fora.Complem && A.fora.Complem.aulas);
  ok(A.proj['PPA — Prof. Alfabetizador'] === 8, 'PPA foi para projetos', A.proj['PPA — Prof. Alfabetizador']);

  console.log('\n— Turmas (sala × turno) —');
  ok(g('Etapas|Etapa I').turmas === 2, 'Etapa I integral = 2 turmas (manhã + tarde)', g('Etapas|Etapa I').turmas);
  ok(g('Etapas|Etapa I').salas === 1, 'Etapa I integral = 1 sala', g('Etapas|Etapa I').salas);
  ok(g('Etapas|Etapa I').integrais === 1, 'marcada como integral', g('Etapas|Etapa I').integrais);
  ok(g('Ciclos|Ciclo II').turmas === 1, 'ciclo só com período integral = 1 turma', g('Ciclos|Ciclo II').turmas);
  ok(g('Ciclos|Ciclo II').turnos['—'] === 1, 'e aparece na coluna "sem turno"', g('Ciclos|Ciclo II').turnos['—']);
  ok(A.salasSemTurno === 1, 'uma sala sem turno identificado', A.salasSemTurno);
  ok(g('FundI|1º Ano').turmas === 3, '1º ano = 3 turmas', g('FundI|1º Ano').turmas);
  ok(g('FundI|1º Ano').turnos.M === 2 && g('FundI|1º Ano').turnos.T === 1, '1º ano: 2 manhã, 1 tarde',
     g('FundI|1º Ano').turnos.M + '/' + g('FundI|1º Ano').turnos.T);

  console.log('\n— Quadro de aulas (moda) —');
  const m1 = g('FundI|1º Ano').disc['Magistério II'];
  ok(m1.moda === 19, 'regência do 1º ano = 19 (moda, não a média de 19,3)', m1.moda);
  ok(m1.comDisc === 3, 'nas 3 turmas', m1.comDisc);
  ok(Math.round(m1.uniformidade*100) === 67, 'uniformidade 67% (a turma C tem 20)', Math.round(m1.uniformidade*100));
  ok(m1.total === 58, 'total lançado = 19+19+20', m1.total);
  const ing = g('FundI|1º Ano').disc['Inglês'];
  ok(ing.moda === 1 && ing.comDisc === 1, 'Inglês em 1 das 3 turmas', ing.comDisc + '/3');
  const viv = g('Etapas|Etapa I').disc['VIVENCIA ALIMENTACAO'];
  ok(viv.semTurno === 5 && viv.moda === 0, 'aula sem turno em sala de 2 turnos fica fora da moda', viv.semTurno);
  ok(A.aulasDaSala === 5, 'e é contada como aula da sala', A.aulasDaSala);
  const cic = g('Ciclos|Ciclo II').disc['Magistério I'];
  ok(cic.moda === 30, 'sala de turno único absorve a linha sem turno', cic.moda);

  console.log('\n— Plano (padrão = observado) —');
  ok(P.turmasPlano('FundI|1º Ano') === 3, 'turmas do plano seguem o observado', P.turmasPlano('FundI|1º Ano'));
  ok(P.aulasPlano('FundI|1º Ano','Magistério II') === 19, 'aulas/turma do plano seguem a moda');
  ok(P.totalPlanoAno('FundI|1º Ano') === 3*(19+2+1), 'total do plano = turmas × quadro', P.totalPlanoAno('FundI|1º Ano'));
  ok(P.totalLancadoAno('FundI|1º Ano') === 58+4+1, 'total lançado = soma da carga', P.totalLancadoAno('FundI|1º Ano'));
  P.PLANO.turmas['FundI|1º Ano'] = '5';
  ok(P.totalPlanoAno('FundI|1º Ano') === 5*22, 'mexer nas turmas muda o plano', P.totalPlanoAno('FundI|1º Ano'));
  P.PLANO.turmas['FundI|1º Ano'] = '';
  ok(P.totalPlanoAno('FundI|1º Ano') === 3*22, 'campo em branco volta ao observado (não vira zero)', P.totalPlanoAno('FundI|1º Ano'));

  console.log('\n— Por unidade (mesmo passe da agregação por ano) —');
  const U = A.porUnidade;
  // 3, não 4: a DELTA está na base, mas só com linha de liminar — ela não tem turma.
  ok(A.ordemUnidades.length === 3, '3 unidades com turma (a DELTA só tem liminar)', A.ordemUnidades.join(' | '));
  ok(U['ALFA, EMEI'].seg.Etapas.turmas === 3, 'ALFA: 2 turmas de Etapa I + 1 de Etapa II', U['ALFA, EMEI'].seg.Etapas.turmas);
  ok(U['ALFA, EMEI'].seg.Etapas.salas === 2, 'em 2 salas', U['ALFA, EMEI'].seg.Etapas.salas);
  ok(U['ALFA, EMEI'].integrais === 1, 'uma delas integral', U['ALFA, EMEI'].integrais);
  ok(U['BETA, CEI'].seg.Ciclos.turmas === 1, 'BETA: 1 turma de ciclo', U['BETA, CEI'].seg.Ciclos.turmas);
  ok(!U['BETA, CEI'].seg.FundI, 'e nenhuma de fundamental');
  ok(U['GAMA, EMEF'].seg.FundI.turmas === 3 && U['GAMA, EMEF'].seg.FundII.turmas === 1
     && U['GAMA, EMEF'].seg.EJA.turmas === 1, 'GAMA: 3 Fund I, 1 Fund II, 1 EJA');
  // ⚠️ a igualdade que impede as duas visões de divergirem
  const somaUni = A.ordemUnidades.reduce((s, u) => s + U[u].turmas, 0);
  const somaAno = A.ordem.reduce((s, k) => s + A.anos[k].turmas, 0);
  ok(somaUni === somaAno, 'a soma por unidade reproduz a soma por ano', somaUni + ' = ' + somaAno);
  // ⚠️ unidade que só tem linha de liminar/substituição não pode sumir da tela
  ok(A.unidadesVistas.has('DELTA, EMEF'), 'unidade só com linha de liminar aparece em unidadesVistas');
  ok(!U['DELTA, EMEF'], 'e não tem turma nenhuma');
  ok(P.unidadesSemTurma().includes('DELTA, EMEF'), 'e a tela a lista mesmo assim, com zero');
  const LU = P.linhasUnidade();
  ok(LU.length === 4, 'o recorte por unidade lista as 4 (3 com turma + 1 sem)', LU.length);
  ok(LU.filter(u => u.SEM_TURMA).length === 1, 'uma delas marcada como sem turma');
  ok(LU.every((u, i) => i === 0 || LU[i-1].unidade.localeCompare(u.unidade, 'pt-BR') <= 0),
     'e sai em ordem alfabética por padrão', LU.map(u => u.unidade).join(' | '));

  console.log('\n— Totais —');
  const t = P.totaisGerais();
  const somaCarga = ROWS.reduce((s,r)=>s+r.carga_horaria,0);
  ok(t.lancado === somaCarga, 'nada se perde: total lançado = soma de TODA a carga da base', t.lancado + ' vs ' + somaCarga);
  ok(t.turmasBaseT === 2+1+1+3+1+1, 'turmas = etapa I 2 + etapa II 1 + ciclo 1 + 1º ano 3 + 6º ano 1 + EJA 1', t.turmasBaseT);

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  process.exit(falhas ? 1 : 0);
}, 300);
