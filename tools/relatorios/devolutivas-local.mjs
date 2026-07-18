#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Rotina LOCAL de devolutivas (opção Y) — roda na SUA máquina, não no repositório.
//
// Fluxo:
//   1) node devolutivas-local.mjs export         → gera visitas-pendentes.json
//                                                   (visitas ainda sem devolutiva do modelo)
//   2) você envia esse arquivo para o Claude, que devolve devolutivas-claude.json
//   3) node devolutivas-local.mjs import devolutivas-claude.json  → grava no Supabase
//
// A service_role fica em um .env LOCAL (nunca commitado). Sua máquina alcança o
// Supabase normalmente. Nada de segredo no repositório.
//
// Requisitos: Node 18+ (usa fetch e crypto nativos). Sem dependências / sem npm install.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ── Config (.env local, ao lado deste script, ou variáveis de ambiente) ──────
function carregarEnv() {
  const caminho = join(AQUI, '.env');
  if (existsSync(caminho)) {
    for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
carregarEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://gmwotfulohkmuqrezeef.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const SCHEMA       = process.env.SCHEMA || 'relatorios';
const MODELO       = process.env.MODELO || 'claude';   // rótulo de quem gerou (aparece na tela p/ comparar)
const TABELA_VIS   = 'relatorios_visitas';
const TABELA_DEV   = 'relatorios_devolutivas';
// Web app do Apps Script (só para migrar as devolutivas antigas do Gemini).
const API_URL      = process.env.API_URL ||
  'https://script.google.com/macros/s/AKfycbydArqsFE8fCijWuc_st3Kd3jbQaUWRyEnQja-Nh2dOaKueuV_jX0iaDyToMKRXjKHO/exec';

if (!SERVICE_KEY) {
  console.error('✖ Falta SUPABASE_SERVICE_KEY. Crie um .env (veja .env.example) ao lado deste script.');
  process.exit(1);
}

// ── Chave/id da devolutiva — MESMA fórmula do _gerarId do Code.gs ─────────────
// chave = md5(segmento|escola|data, minúsculo, espaços→_).slice(0,12)  → agrupa versões
// id    = chave-modelo  → regerar com o mesmo modelo sobrescreve; modelos coexistem
function chaveDe(segmento, escola, data) {
  const base = `${segmento}|${escola}|${data}`.toLowerCase().replace(/\s+/g, '_');
  return createHash('md5').update(base).digest('hex').slice(0, 12);
}

// ── HTTP helpers (PostgREST no schema `relatorios`) ──────────────────────────
async function sbGet(tabela, query) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Accept-Profile': SCHEMA }
  });
  if (!resp.ok) throw new Error(`GET ${tabela} → ${resp.status}: ${await resp.text()}`);
  return resp.json();
}
async function sbUpsert(tabela, linhas, onConflict) {
  const LOTE = 500;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', 'Content-Profile': SCHEMA,
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(lote)
    });
    if (!resp.ok) throw new Error(`UPSERT ${tabela} → ${resp.status}: ${await resp.text()}`);
  }
}

// ── export: visitas que ainda não têm devolutiva do modelo atual ─────────────
async function exportar() {
  const todas = process.argv.includes('--all');
  const visitas = await sbGet(TABELA_VIS,
    'select=visita_uid,segmento,escola,regional,data_visita_txt,dados&order=segmento,escola');

  const feitas = new Set();
  if (!todas) {
    const devs = await sbGet(TABELA_DEV, `select=chave&modelo=eq.${encodeURIComponent(MODELO)}`);
    devs.forEach(d => d.chave && feitas.add(d.chave));
  }

  const pendentes = visitas
    .map(v => ({
      visita_uid: v.visita_uid,
      segmento:   v.segmento,
      escola:     v.escola,
      regional:   v.regional,
      data_visita_txt: v.data_visita_txt,
      _chave:     chaveDe(v.segmento, v.escola, v.data_visita_txt || ''),
      dados:      v.dados
    }))
    .filter(v => todas || !feitas.has(v._chave));

  const saida = join(AQUI, 'visitas-pendentes.json');
  writeFileSync(saida, JSON.stringify(pendentes, null, 2));
  console.log(`✓ ${visitas.length} visita(s) no banco · ${feitas.size} já com devolutiva (${MODELO}) · ` +
              `${pendentes.length} pendente(s).`);
  console.log(`→ ${saida}`);
  console.log('Envie esse arquivo ao Claude para gerar as devolutivas.');
}

// ── import: grava as devolutivas geradas ─────────────────────────────────────
// Formato esperado de cada item do arquivo (o que o Claude devolve):
//   { visita_uid, segmento, escola, regional, data_visita, dados: { ...análise... } }
async function importar() {
  const arq = process.argv[3];
  if (!arq) { console.error('✖ Uso: node devolutivas-local.mjs import <arquivo.json>'); process.exit(1); }
  const itens = JSON.parse(readFileSync(arq, 'utf8'));
  if (!Array.isArray(itens) || !itens.length) { console.error('✖ Arquivo vazio ou inválido.'); process.exit(1); }

  const agora = new Date().toISOString();
  const linhas = itens.map(it => {
    const data  = it.data_visita || it.data_visita_txt || '';
    const chave = chaveDe(it.segmento, it.escola, data);
    return {
      id:          `${chave}-${MODELO}`,
      chave,
      modelo:      MODELO,
      tipo:        it.tipo || 'individual',
      segmento:    it.segmento,
      escola:      it.escola,
      regional:    it.regional || null,
      data_visita: data,
      visita_uid:  it.visita_uid || null,
      dados:       it.dados,
      salvo_em:    agora,
      atualizado_em: agora
    };
  });

  await sbUpsert(TABELA_DEV, linhas, 'id');
  console.log(`✓ ${linhas.length} devolutiva(s) gravada(s) (modelo=${MODELO}).`);
}

// ── migrar-gemini: traz as devolutivas ATUAIS (Google Sheets) para o Supabase ─
// Lê o web app do Apps Script (lerDevolutivas) e grava como histórico modelo='gemini'.
// Roda na sua máquina (que alcança o script.google.com). Preserva as 4 espécies
// (individual/rede/regional/síntese). Reaproveita o ID antigo como `chave` — para as
// individuais ele coincide com a chave do Claude, então as versões ficam no mesmo grupo.
function _parseSalvoEm(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return new Date().toISOString();
  return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`;  // horário de São Paulo
}
async function migrarGemini() {
  const body = new URLSearchParams(); body.append('action', 'lerDevolutivas');
  const resp = await fetch(API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!resp.ok) throw new Error(`web app → ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  if (!j || !j.ok) throw new Error('lerDevolutivas retornou erro: ' + JSON.stringify(j).slice(0, 200));
  const regs = j.registros || [];

  const linhas = regs.map(r => {
    const chave = r.ID || chaveDe(r.Segmento || '', r.Escola || '', r['Data da Visita'] || '');
    return {
      id:          `${chave}-gemini`,
      chave,
      modelo:      'gemini',
      tipo:        r._tipo || 'individual',
      segmento:    r.Segmento || null,
      escola:      r.Escola || null,
      regional:    r.Regional || null,
      data_visita: r['Data da Visita'] || null,
      visita_uid:  null,
      dados:       r._dados || {},
      salvo_em:    _parseSalvoEm(r['Salvo em']),
      atualizado_em: new Date().toISOString()
    };
  });
  await sbUpsert(TABELA_DEV, linhas, 'id');
  const porTipo = {};
  linhas.forEach(l => { porTipo[l.tipo] = (porTipo[l.tipo] || 0) + 1; });
  console.log(`✓ ${linhas.length} devolutiva(s) do Gemini migrada(s):`,
              Object.entries(porTipo).map(([t, n]) => `${t}=${n}`).join(' · '));
}

// ── main ─────────────────────────────────────────────────────────────────────
const modo = process.argv[2];
try {
  if (modo === 'export')            await exportar();
  else if (modo === 'import')       await importar();
  else if (modo === 'migrar-gemini') await migrarGemini();
  else {
    console.log('Uso:');
    console.log('  node devolutivas-local.mjs export            # gera visitas-pendentes.json');
    console.log('  node devolutivas-local.mjs export --all      # inclui as que já têm devolutiva (regera)');
    console.log('  node devolutivas-local.mjs import <arq.json> # grava as devolutivas geradas (Claude)');
    console.log('  node devolutivas-local.mjs migrar-gemini     # traz as devolutivas atuais do Sheets p/ o Supabase');
  }
} catch (e) {
  console.error('✖', e.message);
  process.exit(1);
}
