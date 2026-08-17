/* ────────────────────────────────────────────────────────────────────────────
 * iago.js — Iago, o assistente flutuante do MAPA (disponível em TODAS as telas).
 *
 * Autocontido: injeta o botão flutuante + o painel de chat, carrega os PRÓPRIOS
 * dados (RPCs relat_* que já filtram por permissão + fluência/elefante) e roda o
 * function calling contra a Edge/Apps Script (a chave do Gemini fica no servidor).
 *
 * Restrito a SECRETARIA e SUPER ADMIN — o botão só é injetado para esses perfis,
 * espelhando a regra da tela Relatórios (os dados de visitas/devolutivas são
 * sensíveis). Cada página só precisa de: <script src="iago.js"></script>.
 *
 * NÃO polui o escopo global (roda dentro de uma IIFE; classes CSS com prefixo iago).
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.__IAGO_CARREGADO__) return;
  window.__IAGO_CARREGADO__ = true;

  // ── Config ──────────────────────────────────────────────────────────────────
  const API_URL = 'https://script.google.com/macros/s/AKfycbx8s-6lhTckvshmop6c_tvV_hVZqC6JjXtuQVpN0U6sjjB9oXtCb3gTdHK27V_YjkfKBQ/exec';
  const SB_URL  = 'https://gmwotfulohkmuqrezeef.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtd290ZnVsb2hrbXVxcmV6ZWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTQxODYsImV4cCI6MjA5NzA5MDE4Nn0.6qjrT9Nux_0_Z5oH9ndpcCcJxzfO59VuXjhggVXSOFk';
  const COL_REGIONAL = 'Marque a Regional a qual pertente a unidade escolar.';

  // ── Estado ──────────────────────────────────────────────────────────────────
  let dadosPorSegmento   = { fundamental: [], infantil: [] };
  let escolasOficiais    = { fundamental: [], infantil: [] };
  let mapaRegionalOficial = { fundamental: {}, infantil: {} };
  let todasDevolutivas   = [];
  let mapaDevolutivas    = new Map();
  let _fluPorEscola = null, _elePorEscola = null;
  let _dadosPromise = null, _auxPromise = null;
  let _hist = [], _enviando = false, _aberto = false, _uiFeita = false;

  // ── Permissão (mesma regra da tela Relatórios) ──────────────────────────────
  function podeVer(p) {
    if (!p) return false;
    if (p.is_super_admin) return true;
    return String(p.tipo || '').trim().toLowerCase() === 'secretaria';
  }
  function emailUsuario() { const p = window.MapaAuth && window.MapaAuth.perfil; return (p && p.email) || ''; }

  // ── Utilidades ──────────────────────────────────────────────────────────────
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _norm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim(); }
  const _TITULOS = new Set(['PROF','PROFA','PROFO','DR','DRA','DRO','PROFESSOR','PROFESSORA','DOUTOR','DOUTORA']);
  const _ALIAS = { 'ENEIDA PEREIRA DOS SANTOS DE AGUIAR EMEF': 'ENEIDA PEREIRA DOS SANTOS EMEF' };
  function _normEscola(s){
    const limpo = _norm(s).replace(/[º°ª]/g,'').replace(/[.,–—-]/g,' ').replace(/\s+/g,' ').trim();
    const out=[]; for (const w of limpo.split(' ')){ if(_TITULOS.has(w))continue; if(w==='UNID')break; out.push(w); }
    const nome=out.join(' '); return _ALIAS[nome]||nome;
  }
  function _parseData(str){
    if(!str) return null;
    const m=String(str).match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if(!m) return null;
    return new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0));
  }
  function _fmtData(d){ if(!d) return '—'; return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear(); }
  function _chaveDev(seg,escola,data){ return (String(seg||'')+'|'+String(escola||'')+'|'+String(data||'')).toLowerCase().replace(/\s+/g,' ').trim(); }
  function _tsDev(d){
    const raw=d._salvoEmRaw||'';
    if(/^\d{4}-\d{2}-\d{2}/.test(raw)){ const t=Date.parse(raw); if(!isNaN(t)) return t; }
    const m=String(d['Salvo em']||'').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    return m? new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0)).getTime():0;
  }
  function _rotuloSegmento(s){ const x=String(s||'').toLowerCase(); if(x.startsWith('fund'))return 'Ensino Fundamental'; if(x.startsWith('inf'))return 'Educação Infantil'; return s||''; }
  function _visCampo(v,re){ for(const k in v){ if(re.test(k)){ const val=String(v[k]==null?'':v[k]).trim(); if(val) return val; } } return ''; }

  // ── Transporte ──────────────────────────────────────────────────────────────
  async function chamarAPI(action, params){
    const body=new URLSearchParams(); body.append('action',action);
    Object.keys(params||{}).forEach(k=>body.append(k,params[k]));
    const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString()});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  async function _auxFetch(path){
    const r=await fetch(`${SB_URL}/rest/v1/${path}`,{headers:{apikey:SB_ANON,Authorization:`Bearer ${SB_ANON}`}});
    if(!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  }

  // ── Carregamento dos dados de relatórios (RPCs filtradas por permissão) ──────
  function carregarDados(){
    if(_dadosPromise) return _dadosPromise;
    _dadosPromise=(async()=>{
      const SB=window.MAPA_SB; if(!SB) throw new Error('Sessão não conectada ao banco.');
      const [visRes,escRes,devRes]=await Promise.all([
        SB.rpc('relat_visitas',{}), SB.rpc('relat_escolas',{}), SB.rpc('relat_devolutivas',{})
      ]);
      if(visRes.error) throw visRes.error;
      // visitas → dadosPorSegmento (junta base + "2")
      const dps={fundamental:[],infantil:[]};
      (visRes.data||[]).forEach(v=>{
        const item=v.dados||{};
        if(!item['_SEGMENTO_']) item['_SEGMENTO_']=v.segmento;
        if(!item['_ESCOLA_'])   item['_ESCOLA_']=v.escola;
        item['_VISITA_UID_']=v.visita_uid;
        const base=String(v.segmento||'').replace(/2$/,'');
        if(dps[base]) dps[base].push(item);
      });
      dadosPorSegmento=dps;
      // cadastro oficial → cobertura + regional
      const escOf={fundamental:[],infantil:[]}, regMap={fundamental:{},infantil:{}};
      if(!escRes.error) (escRes.data||[]).forEach(e=>{
        if(e.segmento==='fundamental'||e.segmento==='infantil'){ escOf[e.segmento].push(e.nome); if(e.regional) regMap[e.segmento][e.nome]=e.regional; }
      });
      escolasOficiais=escOf; mapaRegionalOficial=regMap;
      // devolutivas
      todasDevolutivas=((devRes&&devRes.data)||[]).map(r=>({
        "ID":r.id||'', "Escola":r.escola||'', "Segmento":r.segmento||'', "Data da Visita":r.data_visita||'',
        "Salvo em":'', "Regional":r.regional||'', "_tipo":r.tipo||'individual', "_modelo":r.modelo||'',
        "_chave":r.chave||'', "_salvoEmRaw":r.salvo_em||'', "_dados":r.dados||{}
      }));
      // índice visita↔devolutiva
      mapaDevolutivas=new Map();
      const grupos=new Map();
      todasDevolutivas.forEach(d=>{ const k=_chaveDev(d["Segmento"],d["Escola"],d["Data da Visita"]); if(!grupos.has(k))grupos.set(k,[]); grupos.get(k).push(d); });
      grupos.forEach((versoes,k)=>{ versoes.sort((a,b)=>_tsDev(b)-_tsDev(a)); const pr=versoes[0]; pr._versoes=versoes; mapaDevolutivas.set(k,pr); });
    })();
    return _dadosPromise;
  }

  // ── Fluência / Elefante (mesmas fontes das telas; filtro por escola do MapaAuth) ─
  function carregarAux(){
    if(_auxPromise) return _auxPromise;
    _auxPromise=(async()=>{
      const mapaOficial={};
      ['fundamental','infantil'].forEach(seg=>(escolasOficiais[seg]||[]).forEach(n=>{ mapaOficial[_normEscola(n)]=n; }));
      const canon=nome=>mapaOficial[_normEscola(nome)]||String(nome||'').trim();
      const filtrar=(rows,getNome)=>{ try{ if(window.MapaAuth&&window.MapaAuth.restritoEscola) return window.MapaAuth.filtrarEscolas(rows,getNome); }catch(e){} return rows; };
      try{
        let flu=await _auxFetch('v_fluencia_por_turma?select=escola,avaliacao,avaliados,fluentes,iniciantes,pre_n1,pre_n2,pre_n3,pre_n4,ausentes,total_estudantes&order=avaliacao.asc');
        flu=filtrar(flu,t=>t.escola);
        const porEA={};
        flu.forEach(t=>{ const e=canon(t.escola); const o=(porEA[e]=porEA[e]||{}); const a=(o[t.avaliacao]=o[t.avaliacao]||{aval:0,flu:0,ini:0,n1:0,n2:0,n3:0,n4:0,aus:0,tot:0});
          a.aval+=+t.avaliados||0;a.flu+=+t.fluentes||0;a.ini+=+t.iniciantes||0;a.n1+=+t.pre_n1||0;a.n2+=+t.pre_n2||0;a.n3+=+t.pre_n3||0;a.n4+=+t.pre_n4||0;a.aus+=+t.ausentes||0;a.tot+=+t.total_estudantes||0; });
        _fluPorEscola={}; Object.keys(porEA).forEach(e=>{ const avs=Object.keys(porEA[e]).sort(); const av=avs[avs.length-1]; _fluPorEscola[e]=Object.assign({avaliacao:av},porEA[e][av]); });
      }catch(e){ console.warn('Iago · Fluência indisponível:',e.message); }
      try{
        const meses=await _auxFetch('elefante_turmas?select=mes_referencia&order=mes_referencia.desc&limit=1');
        if(meses.length){
          const mes=meses[0].mes_referencia;
          let turmas=await _auxFetch(`elefante_turmas?mes_referencia=eq.${encodeURIComponent(mes)}&select=escola,estudantes,leitores,livros_lidos`);
          turmas=filtrar(turmas,t=>t.escola);
          const porE={};
          turmas.forEach(t=>{ const e=canon(t.escola); const o=(porE[e]=porE[e]||{est:0,lei:0,liv:0,leit:null,mes:mes}); o.est+=+t.estudantes||0;o.lei+=+t.leitores||0;o.liv+=+t.livros_lidos||0; });
          try{ let esc2=await _auxFetch(`elefante_escolas?mes_referencia=eq.${encodeURIComponent(mes)}&select=nome_escola,leituras_concluidas`); esc2=filtrar(esc2,r=>r.nome_escola);
            esc2.forEach(r=>{ const e=canon(r.nome_escola); const o=(porE[e]=porE[e]||{est:0,lei:0,liv:0,leit:null,mes:mes}); o.leit=(o.leit||0)+(+r.leituras_concluidas||0); }); }catch(e){}
          _elePorEscola=porE;
        }
      }catch(e){ console.warn('Iago · Elefante indisponível:',e.message); }
    })();
    return _auxPromise;
  }

  // ── Cobertura / risco / temas / devolutiva ──────────────────────────────────
  function _construirCobertura(segs){
    const linhas=[];
    segs.forEach(seg=>{
      const oficiais=escolasOficiais[seg]||[], mapaReg=mapaRegionalOficial[seg]||{}, visitas=dadosPorSegmento[seg]||[];
      const porEscola={};
      visitas.forEach(v=>{ const e=(v['_ESCOLA_']||'').toString().trim(); if(!e) return; (porEscola[e]=porEscola[e]||[]).push(v); });
      const universo=oficiais.length?oficiais:Object.keys(porEscola);
      universo.forEach(escola=>{
        const vs=porEscola[escola]||[];
        const datas=vs.map(v=>_parseData(v['Data da Visita:']||v['Data da visita:']||v['Carimbo de data/hora'])).filter(Boolean);
        const ultima=datas.length?new Date(Math.max.apply(null,datas.map(d=>d.getTime()))):null;
        const reg=mapaReg[escola]||(vs[0]&&(vs[0][COL_REGIONAL]||'').toString().trim())||'—';
        let devDados=null,devTs=-Infinity;
        vs.forEach(v=>{ const dv=mapaDevolutivas.get(_chaveDev(v['_SEGMENTO_']||seg,escola,v['Data da Visita:']||v['Data da visita:']||'')); if(dv&&(!dv._tipo||dv._tipo==='individual')){ const t=_tsDev(dv); if(t>=devTs){devTs=t;devDados=dv._dados||{};} } });
        linhas.push({ escola, regional:reg, segKey:seg, segmento:seg==='fundamental'?'Fundamental':'Infantil',
          nVisitas:vs.length, datas, ultima, temDev:!!devDados, dev:devDados,
          risco:(devDados&&(devDados.risco_pedagogico||{}).nivel)||'', prioridade:(devDados&&devDados.prioridade)||'' });
      });
    });
    return linhas;
  }
  function _nivelRisco(l){ if(!l.dev) return 'sem'; const n=String(l.risco||'').toLowerCase(); if(n.includes('alt'))return 'alto'; if(n.includes('méd')||n.includes('med'))return 'medio'; if(n.includes('baix'))return 'baixo'; return 'sem'; }
  const _TEMAS=[
    {key:'ppa',lbl:'Atribuição do PPA (2ºs anos)',re:/\bppa\b|atribuic|2o ano|segundo ano/},
    {key:'coord',lbl:'Coordenação pedagógica',re:/coordenac|coordenador/},
    {key:'alfab',lbl:'Alfabetização',re:/alfabetiza|fluencia|pre-silabic|silabic|hipotese de escrita|sondagem/},
    {key:'espec',lbl:'Educação Especial / inclusão',re:/educacao especial|inclus|autist|\bnee\b|\btea\b|deficien|\blaudo\b|\baee\b/},
    {key:'recup',lbl:'Recuperação (PRP/PRA)',re:/\bprp\b|\bpra\b|recuperac|reforco escolar/},
    {key:'defas',lbl:'Defasagem / transição EI→EF',re:/defasag|pre-requisit|prerequisit|transic/},
    {key:'ppp',lbl:'PPP / projeto (Infantil)',re:/\bppp\b|professora do projeto|projeto pedagog|projeto polit/},
    {key:'rotina',lbl:'Rotina Estruturante',re:/rotina estrutur/},
    {key:'integr',lbl:'Horários no período integral',re:/periodo integral|\bsono\b|alimentac|horario do projeto/},
    {key:'acervo',lbl:'Acervo / espaços',re:/acervo|espaco|materiais|biblioteca|brinqued|parque/},
    {key:'regist',lbl:'Registros pedagógicos',re:/registro/},
    {key:'gestao',lbl:'Gestão / acompanhamento',re:/sobrecarr|demanda administrativa|acumul|acompanhamento pedagog/},
    {key:'formac',lbl:'Formação docente',re:/formacao (continuada|docente|de professor)|formacao em|formacao dos professor/},
    {key:'freq',lbl:'Frequência / busca ativa',re:/busca ativa|evasao|infrequen|frequencia dos (alun|estudant)/}
  ];
  function _txtDev(dev){ return _norm([].concat(dev.pontos_fracos||[],dev.pontos_atencao||[],dev.prioridade?[dev.prioridade]:[],dev.justificativa_prioridade?[dev.justificativa_prioridade]:[],(dev.risco_pedagogico&&dev.risco_pedagogico.descricao)?[dev.risco_pedagogico.descricao]:[]).join(' · ')); }
  function _temasDaLinha(l){ const s=new Set(); if(!l.dev) return s; const t=_txtDev(l.dev); _TEMAS.forEach(tm=>{ if(tm.re.test(t)) s.add(tm.key); }); return s; }
  function _devTxtCompleto(d){
    const L=a=>(a||[]).filter(Boolean).join('; '); const p=[];
    if(d.sintese_executiva) p.push('Síntese: '+d.sintese_executiva);
    if(d.prioridade) p.push('Prioridade: '+d.prioridade+(d.justificativa_prioridade?' ('+d.justificativa_prioridade+')':''));
    const r=d.risco_pedagogico||{}; if(r.nivel) p.push('Risco: '+r.nivel+(r.descricao?' — '+r.descricao:''));
    if((d.pontos_fortes||[]).length) p.push('Pontos fortes: '+L(d.pontos_fortes));
    if((d.pontos_fracos||[]).length) p.push('Pontos fracos: '+L(d.pontos_fracos));
    if((d.pontos_atencao||[]).length) p.push('Pontos de atenção: '+L(d.pontos_atencao));
    if((d.encaminhamentos_proxima_visita||[]).length) p.push('Encaminhamentos: '+L(d.encaminhamentos_proxima_visita));
    if((d.perguntas_para_proxima_visita||[]).length) p.push('Perguntas p/ próxima visita: '+L(d.perguntas_para_proxima_visita));
    if((d.foco_formativo_sugerido||[]).length) p.push('Foco formativo: '+L(d.foco_formativo_sugerido));
    return p.join(' | ');
  }

  // ── Funções (tools) ─────────────────────────────────────────────────────────
  function _chatLinhas(){
    const linhas=_construirCobertura(['fundamental','infantil']);
    const regByNorm={}; linhas.forEach(l=>{ if(l.regional&&l.regional!=='—') regByNorm[_normEscola(l.escola)]=l.regional; });
    const regDe=nome=>regByNorm[_normEscola(nome)]||'';
    const casaReg=(reg,alvo)=>!alvo||_norm(reg)===_norm(alvo)||(reg||'').toLowerCase().includes(String(alvo).toLowerCase());
    return { linhas, regDe, casaReg };
  }
  function _contextoBase(){
    const { linhas }=_chatLinhas();
    const total=linhas.length, vis=linhas.filter(l=>l.nVisitas>0).length, cob=total?Math.round(vis/total*100):0;
    const porReg={}; linhas.forEach(l=>{ const r=(l.regional&&l.regional!=='—')?l.regional:'Sem regional'; const o=porReg[r]||(porReg[r]={t:0,v:0}); o.t++; if(l.nVisitas>0)o.v++; });
    const regTxt=Object.entries(porReg).sort((a,b)=>a[0].localeCompare(b[0])).map(([r,o])=>`${r}: ${o.v}/${o.t}`).join('; ');
    const risc={alto:0,medio:0,baixo:0}; linhas.forEach(l=>{ const n=_nivelRisco(l); if(risc[n]!==undefined)risc[n]++; });
    const cont={}; _TEMAS.forEach(t=>cont[t.key]=0); linhas.forEach(l=>_temasDaLinha(l).forEach(k=>cont[k]++));
    const temasTxt=_TEMAS.filter(t=>cont[t.key]>0).sort((a,b)=>cont[b.key]-cont[a.key]).slice(0,8).map(t=>`${t.lbl} (${cont[t.key]})`).join('; ');
    const comV=linhas.filter(l=>l.ultima).sort((a,b)=>b.ultima.getTime()-a.ultima.getTime()); const mr=comV[0];
    let s='PANORAMA DA REDE (apenas o que você pode ver):\n';
    s+=`- Escolas: ${total} | Visitadas: ${vis} (${cob}%) | Sem visita: ${total-vis}\n`;
    if(mr) s+=`- Visita mais recente: ${mr.escola} em ${_fmtData(mr.ultima)}\n`;
    s+=`- Cobertura por regional (visitadas/total): ${regTxt||'—'}\n`;
    s+=`- Risco pedagógico: alto ${risc.alto}, médio ${risc.medio}, baixo ${risc.baixo}\n`;
    s+=`- Temas recorrentes: ${temasTxt||'—'}\n`;
    return s;
  }
  function _sistema(){
    return 'Você é o Iago, o assistente virtual do MAPA (Secretaria Municipal da Educação de Ribeirão Preto), '
      +'que responde a gestores e técnicos sobre visitas de acompanhamento, devolutivas, Fluência Leitora e Elefante Letrado. '
      +'Se perguntarem quem é você, apresente-se como Iago, de forma breve e cordial.\n\n'
      +'REGRAS:\n'
      +'- Use as FUNÇÕES para buscar os dados que precisar (escolas, detalhe_da_escola, visitas, indicadores, buscar). Chame quantas precisar antes de responder.\n'
      +'- Você PODE e DEVE calcular, somar, contar, agrupar, ordenar, tirar médias/percentuais, ranquear e CRUZAR os resultados (ex.: qual regional está pior na fluência, cruzar risco com engajamento). Isso NÃO é inventar.\n'
      +'- Baseie-se só no panorama e nos resultados das funções. Não invente escolas, números, datas ou nomes. Se o dado não existir, diga que não consta.\n'
      +'- Cada escola tem uma regional; use-a para agrupar/comparar por regional. Ao ranquear ou tirar média, mostre os números.\n'
      +'- "Desempenho na alfabetização" / "% de leitores" de uma escola, turma ou regional = (fluentes + iniciantes) / avaliados. Ao avaliar alfabetização, ranquear ou dizer quem está pior/melhor, use o % de LEITORES (fluente + iniciante) — não apenas o % de fluentes. Menor desempenho = menor % de leitores.\n'
      +'- Seja objetivo e institucional; pode usar listas e negrito (markdown simples).\n\n'
      +'PANORAMA ATUAL:\n'+_contextoBase();
  }
  const CHAT_TOOLS=[{functionDeclarations:[
    {name:'escolas',description:'Lista escolas com nº de visitas, data da última visita, prioridade e risco. Use filtros para recortar.',parameters:{type:'object',properties:{regional:{type:'string',description:'nome da regional, ex.: "Regional 3"'},status:{type:'string',description:'filtro opcional: visitada | sem_visita | com_devolutiva | risco_alto'}}}},
    {name:'detalhe_da_escola',description:'TODOS os dados de UMA escola: visitas (quem/quando/responsável), devolutiva completa, fluência e elefante.',parameters:{type:'object',properties:{escola:{type:'string',description:'nome da escola'}},required:['escola']}},
    {name:'visitas',description:'Lista as visitas realizadas (quem visitou, quando, período, responsável). Filtros opcionais.',parameters:{type:'object',properties:{regional:{type:'string'},escola:{type:'string'},responsavel:{type:'string'},de:{type:'string',description:'data inicial dd/mm/aaaa'},ate:{type:'string',description:'data final dd/mm/aaaa'}}}},
    {name:'indicadores',description:'Fluência Leitora (avaliados, fluentes, iniciantes, leitores=fluente+iniciante, % de leitores, níveis N1–N4) e Elefante Letrado (engajamento, livros, leituras) por escola/regional. Use pct_leitores como medida de desempenho na alfabetização.',parameters:{type:'object',properties:{regional:{type:'string'},escola:{type:'string'}}}},
    {name:'buscar',description:'Procura um termo nas devolutivas e nas respostas das visitas; devolve as escolas que citam o termo.',parameters:{type:'object',properties:{termo:{type:'string'}},required:['termo']}}
  ]}];
  function _execTool(name,args){
    try{ args=args||{};
      if(name==='escolas')           return _toolEscolas(args);
      if(name==='detalhe_da_escola') return _toolDetalhe(args);
      if(name==='visitas')           return _toolVisitas(args);
      if(name==='indicadores')       return _toolIndicadores(args);
      if(name==='buscar')            return _toolBuscar(args);
      return {erro:'função desconhecida: '+name};
    }catch(e){ return {erro:String((e&&e.message)||e)}; }
  }
  function _toolEscolas(args){
    const { linhas, casaReg }=_chatLinhas();
    let ls=linhas.filter(l=>casaReg(l.regional,args.regional));
    const st=String(args.status||'').toLowerCase();
    if(st==='sem_visita') ls=ls.filter(l=>l.nVisitas===0);
    else if(st==='visitada') ls=ls.filter(l=>l.nVisitas>0);
    else if(st==='com_devolutiva') ls=ls.filter(l=>l.temDev);
    else if(st==='risco_alto') ls=ls.filter(l=>_nivelRisco(l)==='alto');
    return {total:ls.length,escolas:ls.map(l=>({escola:l.escola,regional:l.regional,segmento:l.segmento,visitas:l.nVisitas,ultima_visita:_fmtData(l.ultima),prioridade:l.dev?(l.dev.prioridade||null):null,risco:_nivelRisco(l)==='sem'?null:_nivelRisco(l)}))};
  }
  function _toolDetalhe(args){
    const alvo=_normEscola(args.escola||''); const { linhas }=_chatLinhas();
    const l=linhas.find(x=>_normEscola(x.escola)===alvo)||linhas.find(x=>{const n=_normEscola(x.escola);return n&&(n.includes(alvo)||alvo.includes(n));});
    if(!l) return {erro:'escola não encontrada: '+(args.escola||'')};
    const visArr=[];
    ['fundamental','infantil'].forEach(seg=>(dadosPorSegmento[seg]||[]).forEach(v=>{ if(_normEscola(v['_ESCOLA_']||'')!==_normEscola(l.escola))return;
      visArr.push({data:v['Data da Visita:']||v['Data da visita:']||v['Carimbo de data/hora']||'',periodo:_visCampo(v,/per[ií]odo/i),responsavel:_visCampo(v,/respons/i)||null,email:_visCampo(v,/e-?mail/i)||null}); }));
    return {escola:l.escola,regional:l.regional,segmento:l.segmento,visitas:l.nVisitas,ultima_visita:_fmtData(l.ultima),registros_visitas:visArr,
      devolutiva:l.dev?_devTxtCompleto(l.dev):null, fluencia:(_fluPorEscola&&_fluPorEscola[l.escola])||null, elefante:(_elePorEscola&&_elePorEscola[l.escola])||null};
  }
  function _toolVisitas(args){
    const { regDe, casaReg }=_chatLinhas(); const de=_parseData(args.de), ate=_parseData(args.ate); const out=[];
    ['fundamental','infantil'].forEach(seg=>(dadosPorSegmento[seg]||[]).forEach(v=>{
      const escola=v['_ESCOLA_']||'', reg=regDe(escola);
      const dataStr=v['Data da Visita:']||v['Data da visita:']||v['Carimbo de data/hora']||'';
      const d=_parseData(dataStr), resp=_visCampo(v,/respons/i);
      if(!casaReg(reg,args.regional))return;
      if(args.escola&&_normEscola(escola)!==_normEscola(args.escola))return;
      if(args.responsavel&&!resp.toLowerCase().includes(String(args.responsavel).toLowerCase()))return;
      if(de&&d&&d<de)return; if(ate&&d&&d>ate)return;
      out.push({escola,regional:reg,data:dataStr,periodo:_visCampo(v,/per[ií]odo/i),responsavel:resp||null,email:_visCampo(v,/e-?mail/i)||null,_t:d?d.getTime():0});
    }));
    out.sort((a,b)=>b._t-a._t).forEach(o=>delete o._t);
    return {total:out.length,visitas:out};
  }
  function _toolIndicadores(args){
    const { regDe, casaReg }=_chatLinhas();
    const ok=nome=>(!args.escola||_normEscola(nome)===_normEscola(args.escola))&&casaReg(regDe(nome),args.regional);
    const flu=[],ele=[];
    if(_fluPorEscola) Object.keys(_fluPorEscola).forEach(e=>{ if(!ok(e))return; const f=_fluPorEscola[e]; flu.push({escola:e,regional:regDe(e),avaliacao:f.avaliacao,avaliados:f.aval,fluentes:f.flu,iniciantes:f.ini,leitores:f.flu+f.ini,pct_leitores:f.aval?Math.round((f.flu+f.ini)/f.aval*100):0,pct_fluentes:f.aval?Math.round(f.flu/f.aval*100):0,n1:f.n1,n2:f.n2,n3:f.n3,n4:f.n4,ausentes:f.aus}); });
    if(_elePorEscola) Object.keys(_elePorEscola).forEach(e=>{ if(!ok(e))return; const g=_elePorEscola[e]; ele.push({escola:e,regional:regDe(e),estudantes:g.est,leitores:g.lei,pct_engajamento:g.est?Math.round(g.lei/g.est*100):0,livros_lidos:g.liv,leituras_concluidas:g.leit}); });
    return {fluencia:flu,elefante:ele};
  }
  function _toolBuscar(args){
    const termo=_norm(args.termo||''); if(!termo) return {erro:'termo vazio'};
    const { linhas, regDe }=_chatLinhas(); const seen=new Set(), out=[];
    const add=(escola,regional,onde)=>{ const k=escola+'|'+onde; if(!seen.has(k)){seen.add(k);out.push({escola,regional,onde});} };
    linhas.forEach(l=>{ if(l.dev&&_norm(_devTxtCompleto(l.dev)).includes(termo)) add(l.escola,l.regional,'devolutiva'); });
    ['fundamental','infantil'].forEach(seg=>(dadosPorSegmento[seg]||[]).forEach(v=>{ const escola=v['_ESCOLA_']||''; let hit=false; for(const k in v){ if(k.charAt(0)==='_')continue; if(_norm(v[k]).includes(termo)){hit=true;break;} } if(hit) add(escola,regDe(escola),'visita'); }));
    return {termo:args.termo,total:out.length,resultados:out.slice(0,60)};
  }

  // ── Laço de conversa (function calling) ─────────────────────────────────────
  async function enviar(texto){
    if(_enviando) return;
    const inp=document.getElementById('iago-input');
    const pergunta=String(texto||(inp&&inp.value)||'').trim();
    if(!pergunta) return;
    if(inp){ inp.value=''; inp.style.height='auto'; }
    _hist.push({role:'user',texto:pergunta}); _enviando=true; render();
    try{
      await carregarDados(); await carregarAux();
      const systemInstruction={parts:[{text:_sistema()}]};
      const contents=_hist.filter(m=>m.texto).map(m=>({role:m.role==='user'?'user':'model',parts:[{text:m.texto}]}));
      let final='';
      for(let step=0;step<6;step++){
        const res=await chamarAPI('chatfn',{payload:JSON.stringify({contents,systemInstruction,tools:CHAT_TOOLS}),usuario:emailUsuario(),contar:step===0?'true':'false'});
        if(!res||!res.ok){ final='⚠️ '+((res&&res.erro)||'Não foi possível responder agora.'); break; }
        const parts=res.parts||[]; const fcs=parts.filter(p=>p.functionCall).map(p=>p.functionCall);
        if(fcs.length){ contents.push({role:'model',parts:parts}); contents.push({role:'user',parts:fcs.map(fc=>({functionResponse:{name:fc.name,response:_execTool(fc.name,fc.args)}}))}); continue; }
        final=parts.filter(p=>p.text).map(p=>p.text).join('\n').trim()||'(sem resposta)'; break;
      }
      _hist.push({role:'assistant',texto:final||'(sem resposta)'});
    }catch(e){ _hist.push({role:'assistant',texto:'⚠️ Erro: '+(e.message||e)}); }
    finally{ _enviando=false; render(); }
  }
  function _md(t){ let s=esc(t); s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>'); s=s.replace(/^\s*[-*]\s+(.+)$/gm,'• $1'); return s.replace(/\n/g,'<br>'); }

  // ── UI ──────────────────────────────────────────────────────────────────────
  function render(){
    const box=document.getElementById('iago-msgs'); if(!box) return;
    let html;
    if(!_hist.length&&!_enviando){
      html=`<div class="iago-vazio">
        <img src="iago-ola.png" alt="Iago" class="iago-mascote" onerror="this.style.display='none'">
        <div class="iago-ola">Olá! Eu sou o <b>Iago</b> 👋</div>
        <div class="iago-desc">Seu assistente do MAPA. Consigo analisar e <b>cruzar</b> os dados aos quais você tem acesso:</div>
        <ul class="iago-caps">
          <li><b>Visitas</b> — quem visitou, quando e o responsável</li>
          <li><b>Devolutivas</b> — prioridade, risco, pontos fortes e fracos</li>
          <li><b>Fluência Leitora</b> — níveis N1–N4 e % de fluentes</li>
          <li><b>Elefante Letrado</b> — engajamento e leituras</li>
          <li><b>Cobertura, regionais, riscos e temas</b> da rede</li>
        </ul>
        <div class="iago-cta">Digite sua pergunta abaixo 👇</div>
      </div>`;
    } else {
      const av=`<img src="iago-cabeca.png" alt="Iago" class="iago-av" onerror="this.style.display='none'">`;
      html=_hist.map(m=> m.role==='user'
        ? `<div class="iago-b user">${esc(m.texto)}</div>`
        : `<div class="iago-row">${av}<div class="iago-b bot">${_md(m.texto)}</div></div>`).join('');
      if(_enviando) html+=`<div class="iago-row">${av}<div class="iago-typing"><span></span><span></span><span></span></div></div>`;
    }
    box.innerHTML=html; box.scrollTop=box.scrollHeight;
    const send=document.getElementById('iago-send'); if(send) send.disabled=_enviando;
  }
  function abrir(){ _aberto=true; document.getElementById('iago-panel').classList.add('aberto'); document.getElementById('iago-fab').classList.add('aberto');
    render(); const inp=document.getElementById('iago-input'); if(inp) inp.focus(); carregarDados().then(carregarAux).catch(()=>{}); }
  function fechar(){ _aberto=false; document.getElementById('iago-panel').classList.remove('aberto'); document.getElementById('iago-fab').classList.remove('aberto'); }
  function toggle(){ _aberto?fechar():abrir(); }

  function injetar(){
    if(_uiFeita) return; _uiFeita=true;
    const style=document.createElement('style');
    style.textContent=`
      #iago-fab{position:fixed;right:22px;bottom:22px;width:64px;height:64px;border-radius:50%;border:0;cursor:pointer;z-index:99998;
        background:#002b5e;box-shadow:0 8px 24px rgba(0,43,94,.35);display:flex;align-items:center;justify-content:center;transition:transform .15s, box-shadow .15s;padding:0;}
      #iago-fab:hover{transform:translateY(-3px) scale(1.04);box-shadow:0 12px 30px rgba(0,43,94,.45);}
      #iago-fab img{width:56px;height:56px;object-fit:contain;}
      #iago-fab.aberto{transform:scale(.9);opacity:.85;}
      #iago-panel{position:fixed;right:22px;bottom:98px;width:390px;max-width:calc(100vw - 32px);height:min(620px,78vh);z-index:99999;
        background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;
        opacity:0;visibility:hidden;transform:translateY(16px);transition:opacity .18s, transform .18s, visibility .18s;font-family:'Inter',system-ui,sans-serif;}
      #iago-panel.aberto{opacity:1;visibility:visible;transform:translateY(0);}
      @media(max-width:520px){#iago-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100vh;border-radius:0;}#iago-fab{right:16px;bottom:16px;}}
      .iago-top{background:#002b5e;color:#fff;padding:.75rem 1rem;display:flex;align-items:center;gap:.6rem;}
      .iago-top img{width:38px;height:38px;object-fit:contain;background:rgba(255,255,255,.12);border-radius:50%;padding:2px;flex-shrink:0;}
      .iago-top .t{font-weight:900;font-size:.98rem;line-height:1.1;}
      .iago-top .s{font-size:.66rem;opacity:.8;font-weight:600;}
      .iago-x{margin-left:auto;background:transparent;border:0;color:#fff;font-size:1.3rem;cursor:pointer;opacity:.85;line-height:1;}
      .iago-x:hover{opacity:1;}
      #iago-msgs{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.7rem;background:#f8fafc;}
      .iago-b{max-width:84%;padding:.65rem .9rem;border-radius:14px;font-size:.86rem;line-height:1.5;word-wrap:break-word;}
      .iago-b.user{align-self:flex-end;background:#002b5e;color:#fff;border-bottom-right-radius:4px;}
      .iago-b.bot{background:#fff;color:#1e293b;border:1px solid #e8eef5;border-bottom-left-radius:4px;}
      .iago-b.bot strong{color:#002b5e;}
      .iago-row{display:flex;align-items:flex-start;gap:.5rem;align-self:flex-start;max-width:92%;}
      .iago-row .iago-b.bot{max-width:100%;}
      .iago-av{width:32px;height:32px;border-radius:50%;object-fit:contain;background:#eef4fb;padding:2px;flex-shrink:0;box-shadow:0 2px 6px rgba(0,43,94,.12);}
      .iago-typing{align-self:flex-start;display:flex;gap:4px;padding:.6rem .9rem;}
      .iago-typing span{width:7px;height:7px;border-radius:50%;background:#cbd5e1;animation:iagopulse 1.2s infinite;}
      .iago-typing span:nth-child(2){animation-delay:.2s;}.iago-typing span:nth-child(3){animation-delay:.4s;}
      @keyframes iagopulse{0%,60%,100%{opacity:.3;transform:translateY(0);}30%{opacity:1;transform:translateY(-3px);}}
      .iago-vazio{margin:auto;text-align:center;color:#94a3b8;max-width:340px;}
      .iago-mascote{width:150px;height:auto;margin:0 auto .4rem;display:block;filter:drop-shadow(0 8px 16px rgba(0,43,94,.18));}
      .iago-ola{font-size:1.1rem;font-weight:900;color:#002b5e;}
      .iago-desc{font-size:.8rem;color:#475569;font-weight:600;margin:.4rem auto .6rem;}
      .iago-caps{list-style:none;margin:0 auto;padding:0;text-align:left;display:flex;flex-direction:column;gap:.35rem;max-width:300px;}
      .iago-caps li{font-size:.78rem;color:#334155;}.iago-caps li b{color:#1e293b;}
      .iago-cta{font-size:.76rem;font-weight:800;color:#64748b;margin-top:.8rem;}
      #iago-chips{display:flex;flex-wrap:wrap;gap:.4rem;padding:.6rem 1rem 0;}
      .iago-chip{border:1.5px solid #cbd5e1;background:#fff;color:#334155;font-weight:700;font-size:.72rem;padding:5px 11px;border-radius:999px;cursor:pointer;}
      .iago-chip:hover{border-color:#002b5e;background:#f1f6ff;}
      .iago-input{display:flex;gap:.5rem;padding:.75rem 1rem;border-top:1px solid #eef2f7;align-items:flex-end;background:#fff;}
      .iago-input textarea{flex:1;resize:none;border:1.5px solid #cbd5e1;border-radius:12px;padding:.55rem .8rem;font-family:inherit;font-size:.85rem;max-height:110px;}
      .iago-input textarea:focus{outline:none;border-color:#002b5e;}
      #iago-send{border:0;background:#002b5e;color:#fff;width:42px;height:42px;border-radius:12px;cursor:pointer;flex-shrink:0;font-size:1.05rem;}
      #iago-send:disabled{opacity:.5;cursor:not-allowed;}
    `;
    document.head.appendChild(style);

    const wrap=document.createElement('div'); wrap.id='iago-root';
    wrap.innerHTML=`
      <button id="iago-fab" title="Falar com o Iago"><img src="iago-cabeca.png" alt="Iago" onerror="this.parentNode.innerHTML='🤖';this.parentNode.style.fontSize='28px'"></button>
      <div id="iago-panel" role="dialog" aria-label="Assistente Iago">
        <div class="iago-top">
          <img src="iago-cabeca.png" alt="" onerror="this.style.display='none'">
          <div><div class="t">Iago</div><div class="s">Assistente do MAPA</div></div>
          <button class="iago-x" id="iago-fechar" title="Fechar" aria-label="Fechar">×</button>
        </div>
        <div id="iago-msgs"></div>
        <div class="iago-input">
          <textarea id="iago-input" rows="1" placeholder="Pergunte sobre escolas, regionais, riscos…"></textarea>
          <button id="iago-send" title="Enviar">➤</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    document.getElementById('iago-fab').addEventListener('click',toggle);
    document.getElementById('iago-fechar').addEventListener('click',fechar);
    document.getElementById('iago-send').addEventListener('click',()=>enviar());
    const inp=document.getElementById('iago-input');
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); enviar(); } });
    inp.addEventListener('input',function(){ this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,110)+'px'; });
    render();
  }

  // ── Init: só injeta para secretaria/super admin, após o auth resolver ────────
  function init(){ const p=window.MapaAuth&&window.MapaAuth.perfil; if(!podeVer(p)) return; injetar(); }
  if(window.MapaAuth&&window.MapaAuth.perfil) init();
  else document.addEventListener('mapa-auth-pronto',init,{once:true});
})();
