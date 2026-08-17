/* ═══════════════════════════════════════════════════════════════════════════
   MapaVisaoRede — o painel "Todas as unidades" das telas de avaliação externa
   (Av. Diagnóstica, Av. Oral de Matemática, SARESP, IDEB e IEE).

   As cinco telas nasceram com o mesmo desenho: um <select> de unidade e a
   leitura de UMA escola por vez. Faltava a pergunta que a coordenação faz
   primeiro — "como estão TODAS, e quem está longe da rede?". Este arquivo
   acrescenta essa visão sem duplicar 200 linhas em cada tela: a tela descreve
   o que sabe medir (filtros + como agregar), e o painel cuida do resto.

   Como a tela liga o painel (três pontos, e só):

     1. <script src="visao-rede.js"></script> no <head>;
     2. em selecionar(nome), como PRIMEIRA linha:
          if(window.MapaVisaoRede && MapaVisaoRede.interceptar(nome)) return;
     3. em carregarEscolas(), no lugar de selecionar(ESCOLAS[0].escola):
          selecionar(MapaVisaoRede.preparar(sel, ESCOLAS));

   ⚠️ A lista mostra o que o BANCO entregou, não "a rede". Sob RLS um perfil de
   escola recebe só a própria unidade — e é por isso que a opção nem aparece
   para quem tem uma unidade só: um comparativo de uma linha só não compara
   nada. Nada aqui é controle de acesso; o recorte vive no Postgres.

   ⚠️ A referência da rede é POR UNIDADE, não uma média única. Unidades cobrem
   recortes diferentes (uma EMEF sem 9º ano, um componente sem lançamento), e
   comparar a média de quem tem 4 recortes com a média da rede em 16 diria
   qualquer coisa menos desempenho. Quando a rede não cobre exatamente os
   mesmos recortes daquela unidade, a coluna sai '—' em vez de sair errada.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if(window.MapaVisaoRede) return;

var TODAS = '__TODAS__';

var esc = function(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };

/* Busca por nome sem acento e sem caixa — quem digita "sao" precisa achar
   "SÃO". normalize('NFD') separa o acento do caractere para o corte funcionar
   em qualquer grafia do arquivo de origem. */
var achatar = function(s){
  return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
};

/* ── Escala de 5 faixas, a mesma paleta das telas ──────────────────────────
   A cor mede a DISTÂNCIA RELATIVA da referência da rede: estar na média é o
   centro da escala (amarelo), não o topo.

   A tinta acompanha a faixa. Sobre os três tons do meio o texto branco fica
   abaixo de 4,5:1; com tinta escura sobe para 5,0–6,1:1. A paleta é a mesma
   das outras tabelas — não devolva o texto para branco "para uniformizar". */
var FAIXAS = [
  {min:  0.10, bg:'#15803d', fg:'#ffffff'},
  {min:  0.03, bg:'#65a30d', fg:'#132000'},
  {min: -0.03, bg:'#ca8a04', fg:'#231700'},
  {min: -0.10, bg:'#ea580c', fg:'#2b0d00'},
  {min: -Infinity, bg:'#b91c1c', fg:'#ffffff'}
];
var SEM_COR = {bg:'#cbd5e1', fg:'#0f172a'};
function faixaRel(v, ref){
  if(v==null || isNaN(v) || ref==null || isNaN(ref) || !ref) return SEM_COR;
  var d = (v - ref) / Math.abs(ref);
  for(var i=0;i<FAIXAS.length;i++) if(d >= FAIXAS[i].min) return FAIXAS[i];
  return SEM_COR;
}

/* ⚠️ Paginação obrigatória. O PostgREST devolve no máximo 1.000 linhas por
   requisição e NÃO avisa que truncou: uma tela que pede a rede inteira de uma
   vez recebe as primeiras mil e monta um comparativo faltando unidades, sem
   erro nenhum na tela. Todas estas tabelas passam de mil linhas com folga.
   A fábrica precisa devolver a consulta JÁ ORDENADA — sem order o Postgres não
   garante a mesma ordem entre as páginas, e a paginação repete/perde linhas. */
async function buscarTudo(fabrica, passo){
  var P = passo || 1000, fora = [];
  for(var i=0;;i+=P){
    var r = await fabrica().range(i, i+P-1);
    if(r.error) throw r.error;
    var d = r.data || [];
    fora.push.apply(fora, d);
    if(d.length < P) return fora;
  }
}

var CSS = ''
+ '.vr-painel{display:none;}'
+ 'body.vr-todas .vr-painel{display:block;}'
/* Em modo comparativo some tudo que é de UMA unidade. O !important vence o
   display inline que algumas telas alternam por JavaScript. */
+ 'body.vr-todas .page > *:not(.vr-painel):not(.titbar):not(.ad-up){display:none !important;}'
+ 'body:not(.vr-todas) .vr-chip{display:none;}'
+ 'body.vr-todas .ad-chip:not(.vr-chip){display:none;}'
+ '.vr-ops{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:.2rem .2rem .7rem;}'
+ '.vr-ops label{font-size:.7rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;}'
+ '.vr-ops select,.vr-ops input{border:1px solid #cdd7e3;border-radius:9px;padding:.35rem .6rem;'
+   'font-family:inherit;font-size:.8rem;font-weight:700;background:#fff;color:#0f172a;}'
+ '.vr-ops input{min-width:210px;font-weight:600;}'
+ '.vr-ops .vr-cont{font-size:.72rem;color:#64748b;font-weight:700;}'
+ 'table.ad.vr-tab th.vr-ord{cursor:pointer;user-select:none;white-space:nowrap;}'
+ 'table.ad.vr-tab th.vr-ord:hover{color:#0f172a;}'
+ 'table.ad.vr-tab td.vr-nm{text-align:left;}'
/* O nome da unidade fica com a folga da tabela e as colunas de número não
   quebram. Sem isso a coluna da medida estica (uma célula colorida de 300px
   vira o assunto da tela) e "▼ 22,5 pts" quebra em três linhas, triplicando a
   altura de cada linha da lista. */
+ 'table.ad.vr-tab th[data-ord="escola"]{width:42%;}'
+ 'table.ad.vr-tab td,table.ad.vr-tab th{white-space:nowrap;}'
+ 'table.ad.vr-tab td.vr-nm{white-space:normal;}'
+ 'table.ad.vr-tab td.vr-posto{font-weight:900;color:#94a3b8;font-size:.72rem;width:46px;}'
+ '.vr-nome{background:none;border:0;padding:0;font:inherit;font-weight:800;color:#002b5e;'
+   'text-align:left;cursor:pointer;text-decoration:underline;'
+   'text-decoration-color:rgba(0,43,94,.3);text-underline-offset:3px;}'
+ '.vr-nome:hover{color:#075f82;text-decoration-color:currentColor;}'
+ '.vr-nome:focus-visible{outline:2px solid #00b8d4;outline-offset:2px;border-radius:4px;}'
+ '.vr-msg{color:#64748b;padding:.8rem;text-align:left;}';

var cfg = null;          // configuração da tela
var painel = null;       // elemento do painel
var LINHAS = [];         // resultado do último carregamento
var estado = {ord:'valor', dir:-1, busca:''};
var filtros = {};        // valores atuais dos filtros da tela
var montado = false;
var geracao = 0;         // token contra resposta atrasada de um filtro anterior

function injetarCSS(){
  if(document.getElementById('vr-css')) return;
  var s = document.createElement('style');
  s.id = 'vr-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

/* ── Instalação ─────────────────────────────────────────────────────────────
   cfg = {
     sel        : <select> de unidade
     escolher   : nome => void      (a selecionar() da tela)
     titulo     : rótulo da seção
     rotuloValor: cabeçalho da coluna medida
     fmt        : v => texto        (formata a medida)
     escalaDif  : 1 | 100           (fração → pp, por exemplo)
     casasDif   : casas decimais da diferença
     unidadeDif : ' pp' | ' pts' | ''
     colunas    : [{id, t, v:linha=>número, fmt, ord:bool}]  colunas extras
     filtros    : [{id, rotulo, opcoes:()=>[{v,t}]}]
     carregar   : filtros => Promise<{linhas:[{escola, valor, ref, cols}]}>
     legenda    : HTML da nota sob a tabela
   }                                                                        */
function instalar(c){
  cfg = c;
  injetarCSS();
  var page = document.querySelector('.page');
  var titbar = page && page.querySelector('.titbar');
  if(!page || !titbar) return null;

  painel = document.createElement('div');
  painel.className = 'vr-painel';
  painel.innerHTML =
      '<div class="secLabel">' + esc(cfg.titulo || 'Todas as unidades') + '</div>'
    + '<div class="vr-ops" id="vrOps"></div>'
    + '<div class="card2"><table class="ad vr-tab">'
    + '<thead id="vrHead"></thead><tbody id="vrBody"></tbody></table></div>'
    + '<div class="leg" id="vrLeg"></div>';
  titbar.insertAdjacentElement('afterend', painel);

  var barra = document.querySelector('.ad-bar');
  if(barra){
    var chip = document.createElement('span');
    chip.className = 'ad-chip vr-chip'; chip.id = 'vrChip'; chip.textContent = '—';
    barra.appendChild(chip);
  }

  painel.querySelector('#vrBody').addEventListener('click', function(ev){
    var b = ev.target.closest('.vr-nome');
    if(b) escolherUnidade(b.getAttribute('data-escola'));
  });
  painel.querySelector('#vrHead').addEventListener('click', function(ev){
    var th = ev.target.closest('th.vr-ord');
    if(!th) return;
    var k = th.getAttribute('data-ord');
    if(estado.ord === k) estado.dir = -estado.dir;
    else { estado.ord = k; estado.dir = (k === 'escola') ? 1 : -1; }
    render();
  });
  return api;
}

/* A opção só existe quando há mais de uma unidade para comparar. Para um
   perfil de escola ela seria uma tabela de uma linha — e sugeriria que a
   pessoa está vendo a rede, que é justamente o que ela não vê. */
function preparar(sel, escolas){
  var n = (escolas || []).length;
  var atual = sel.querySelector('option[value="' + TODAS + '"]');
  if(n > 1){
    if(!atual){
      var o = document.createElement('option');
      o.value = TODAS;
      o.textContent = 'Todas as unidades (comparativo)';
      sel.insertBefore(o, sel.firstChild);
    }
    sel.value = TODAS;
    return TODAS;
  }
  if(atual) atual.remove();
  return n ? escolas[0].escola : null;
}

/* Chamada no alto da selecionar() da tela. Devolve true quando ela deve parar:
   o pedido era o comparativo, não uma unidade. */
function interceptar(nome){
  if(!cfg) return false;
  if(nome !== TODAS){ fechar(); return false; }
  abrir();
  return true;
}

function fechar(){ document.body.classList.remove('vr-todas'); }

function escolherUnidade(nome){
  if(!nome) return;
  fechar();
  if(cfg.sel) cfg.sel.value = nome;
  window.scrollTo({top:0, behavior:'smooth'});
  // A selecionar() das telas é assíncrona e propaga o erro do banco. Sem este
  // catch a falha viraria "unhandled rejection" no console e a tela ficaria
  // parada na unidade anterior, sem dizer nada.
  Promise.resolve(cfg.escolher(nome)).catch(function(e){
    console.error(e);
    var nm = document.getElementById('adNome');
    if(nm) nm.textContent = 'Erro ao abrir a unidade: ' + (e.message || e);
  });
}

function abrir(){
  document.body.classList.add('vr-todas');
  var nome = document.getElementById('adNome');
  if(nome) nome.textContent = 'Todas as unidades';
  if(!montado){ montarControles(); montado = true; }
  recarregar();
}

function montarControles(){
  var ops = painel.querySelector('#vrOps');
  var h = '';
  (cfg.filtros || []).forEach(function(f){
    var op = f.opcoes() || [];
    filtros[f.id] = op.length ? op[0].v : '';
    h += '<label for="vr_' + f.id + '">' + esc(f.rotulo) + '</label>'
       + '<select id="vr_' + f.id + '" data-f="' + f.id + '">'
       + op.map(function(o){ return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>'; }).join('')
       + '</select>';
  });
  h += '<label for="vrBusca">Procurar</label>'
     + '<input id="vrBusca" type="search" placeholder="nome da unidade" autocomplete="off">'
     + '<span class="vr-cont" id="vrCont"></span>';
  ops.innerHTML = h;

  ops.querySelectorAll('select[data-f]').forEach(function(s){
    s.addEventListener('change', function(){
      filtros[s.getAttribute('data-f')] = s.value;
      recarregar();
    });
  });
  var busca = ops.querySelector('#vrBusca');
  busca.addEventListener('input', function(){ estado.busca = busca.value; render(); });
}

/* As colunas extras podem depender do filtro (a Av. Oral troca de medida e com
   ela troca o que faz sentido mostrar ao lado), por isso cfg.colunas aceita
   função. Quem devolve a lista é sempre esta função — o cabeçalho, o corpo e a
   ordenação leem daqui, senão saem de sincronia. */
function extras(){
  var c = cfg.colunas;
  if(typeof c === 'function') c = c(filtros);
  return c || [];
}

function colunas(){
  var c = [{k:'posto', t:'#', ord:false},
           {k:'escola', t:'Unidade', ord:true},
           {k:'valor', t:cfg.rotuloValor || 'Média', ord:true}];
  extras().forEach(function(x){ c.push({k:x.id, t:x.t, ord:x.ord !== false}); });
  c.push({k:'ref', t:'Rede', ord:true});
  c.push({k:'dif', t:'Dif.', ord:true});
  return c;
}

function msg(texto){
  painel.querySelector('#vrHead').innerHTML = '';
  painel.querySelector('#vrBody').innerHTML =
    '<tr><td class="vr-msg">' + esc(texto) + '</td></tr>';
}

/* Cada carregamento leva um token. Trocar de filtro depressa dispara duas
   consultas, e a primeira pode voltar depois da segunda — sem o token a tela
   mostraria o recorte antigo com o filtro novo, sem sinal nenhum de que está
   errada. */
async function recarregar(){
  var meu = ++geracao;
  msg('Carregando as unidades…');
  try{
    var r = await cfg.carregar(filtros);
    if(meu !== geracao) return;
    LINHAS = (r && r.linhas) || [];
    // O posto é do RANKING, não da ordenação escolhida: mudar a ordem da
    // tabela não pode renumerar as unidades.
    LINHAS.slice().sort(function(a,b){
      if(a.valor == null) return 1;
      if(b.valor == null) return -1;
      return b.valor - a.valor;
    }).forEach(function(l, i){ l.posto = (l.valor == null) ? null : i + 1; });
    render();
  }catch(e){
    if(meu !== geracao) return;
    console.error(e);
    msg('Não foi possível montar o comparativo: ' + (e.message || e));
  }
}

function valorOrd(l, k){
  if(k === 'valor') return l.valor;
  if(k === 'ref') return l.ref;
  if(k === 'dif') return (l.valor == null || l.ref == null) ? null : l.valor - l.ref;
  var c = extras().filter(function(x){ return x.id === k; })[0];
  return c ? c.v(l) : null;
}

function comparar(a, b){
  var k = estado.ord, s = estado.dir;
  if(k === 'escola') return a.escola.localeCompare(b.escola, 'pt-BR') * s;
  var va = valorOrd(a, k), vb = valorOrd(b, k);
  // Sem dado vai sempre para o fim, nas duas direções: uma unidade sem
  // lançamento no topo do ranking leria como se fosse a primeira colocada.
  if(va == null && vb == null) return a.escola.localeCompare(b.escola, 'pt-BR');
  if(va == null) return 1;
  if(vb == null) return -1;
  if(va === vb) return a.escola.localeCompare(b.escola, 'pt-BR');
  return (va < vb ? -1 : 1) * s;
}

function fmtVal(v){ return (v == null || isNaN(v)) ? '—' : cfg.fmt(v); }

/* Diferença arredondada ANTES de escolher o símbolo: 0 é empate, não alta nem
   queda. Sem isso, +0,04 sai "▲ 0,0" em verde e −0,04 sai "▼ 0,0" em vermelho
   — dois empates pintados de coisas opostas. */
function celDif(l){
  if(l.valor == null || l.ref == null) return '<td style="color:#94a3b8">—</td>';
  var casas = cfg.casasDif == null ? 1 : cfg.casasDif;
  var d = (l.valor - l.ref) * (cfg.escalaDif || 1);
  var r = Number(d.toFixed(casas));
  var txt = Math.abs(r).toFixed(casas).replace('.', ',') + (cfg.unidadeDif || '');
  if(r === 0) return '<td style="font-weight:800;color:#64748b">= ' + txt + '</td>';
  var cor = r > 0 ? '#166534' : '#b91c1c';
  return '<td style="font-weight:800;color:' + cor + '">'
       + (r > 0 ? '▲ ' : '▼ ') + txt + '</td>';
}

function render(){
  var cols = colunas();
  var seta = function(k){
    if(estado.ord !== k) return '';
    return ' <span aria-hidden="true">' + (estado.dir > 0 ? '▲' : '▼') + '</span>';
  };
  painel.querySelector('#vrHead').innerHTML = '<tr>' + cols.map(function(c){
    var al = (c.k === 'escola') ? ' style="text-align:left"' : '';
    return c.ord
      ? '<th class="vr-ord" data-ord="' + c.k + '"' + al + '>' + esc(c.t) + seta(c.k) + '</th>'
      : '<th' + al + '>' + esc(c.t) + '</th>';
  }).join('') + '</tr>';

  var lin = LINHAS.slice();
  if(estado.busca.trim()){
    var b = achatar(estado.busca.trim());
    lin = lin.filter(function(l){ return achatar(l.escola).indexOf(b) >= 0; });
  }
  lin.sort(comparar);

  var cont = painel.querySelector('#vrCont');
  if(cont){
    cont.textContent = LINHAS.length
      ? (lin.length === LINHAS.length
          ? LINHAS.length + ' unidades'
          : lin.length + ' de ' + LINHAS.length + ' unidades')
      : '';
  }
  var chip = document.getElementById('vrChip');
  if(chip) chip.textContent = LINHAS.length + ' unidade' + (LINHAS.length === 1 ? '' : 's');

  var leg = painel.querySelector('#vrLeg');
  if(leg) leg.innerHTML = cfg.legenda || '';

  if(!lin.length){
    painel.querySelector('#vrBody').innerHTML =
      '<tr><td class="vr-msg" colspan="' + cols.length + '">'
      + (LINHAS.length ? 'Nenhuma unidade com esse nome.' : 'Sem dados para este recorte.')
      + '</td></tr>';
    return;
  }

  painel.querySelector('#vrBody').innerHTML = lin.map(function(l){
    var f = faixaRel(l.valor, l.ref);
    var cels = extras().map(function(x){
      var v = x.v(l);
      return '<td>' + ((v == null || (typeof v === 'number' && isNaN(v)))
        ? '—' : (x.fmt ? x.fmt(v, l) : esc(v))) + '</td>';
    }).join('');
    return '<tr>'
      + '<td class="vr-posto">' + (l.posto == null ? '—' : l.posto) + '</td>'
      + '<td class="vr-nm"><button type="button" class="vr-nome" data-escola="'
      + esc(l.escola) + '">' + esc(l.escola) + '</button></td>'
      + '<td class="c" style="background:' + f.bg + ';color:' + f.fg + '">' + fmtVal(l.valor) + '</td>'
      + cels
      + '<td>' + fmtVal(l.ref) + '</td>'
      + celDif(l)
      + '</tr>';
  }).join('');
}

/* ── Agregação ──────────────────────────────────────────────────────────────
   O padrão das cinco telas: somar por unidade os valores de vários recortes e
   comparar com a rede NOS MESMOS recortes.

   `ref` só sai quando a rede cobre todos os recortes que a unidade tem. Uma
   média de 4 recortes contra uma rede de 3 não é comparação — é aritmética
   com dois universos diferentes, e ninguém veria pelo número. */
function agregador(){
  var m = new Map();
  return {
    add: function(escola, valor, ref, extra){
      var s = m.get(escola);
      if(!s){ s = {escola:escola, sv:0, n:0, sr:0, nr:0, cols:{}}; m.set(escola, s); }
      if(valor != null && !isNaN(valor)){ s.sv += Number(valor); s.n++; }
      if(ref != null && !isNaN(ref)){ s.sr += Number(ref); s.nr++; }
      if(extra) for(var k in extra) if(extra[k] != null){
        var a = s.cols[k] || {t:0, n:0};
        a.t += Number(extra[k]); a.n++; s.cols[k] = a;
      }
    },
    linhas: function(){
      var fora = [];
      m.forEach(function(s){
        var cols = {};
        for(var k in s.cols) cols[k] = s.cols[k].t / s.cols[k].n;
        cols.n = s.n;
        fora.push({
          escola: s.escola,
          valor: s.n ? s.sv / s.n : null,
          ref: (s.nr && s.nr === s.n) ? s.sr / s.nr : null,
          cols: cols
        });
      });
      return fora;
    }
  };
}

var api = {
  TODAS: TODAS,
  instalar: instalar,
  preparar: preparar,
  interceptar: interceptar,
  fechar: fechar,
  recarregar: recarregar,
  buscarTudo: buscarTudo,
  agregador: agregador,
  faixaRel: faixaRel
};
window.MapaVisaoRede = api;
})();
