/**
 * visitas-sync.gs — Sincroniza as respostas do formulário de visitas
 * (abas Fundamental / Infantil / Fundamental2 / Infantil2 do Google Sheets)
 * para o Supabase (tabela relatorios_visitas).
 *
 * O Google Forms segue ATIVO: novas respostas caem na planilha e esta rotina,
 * agendada por tempo, leva o que é novo/alterado para o Supabase (upsert
 * idempotente por visita_uid — reexecutar não duplica; respostas editadas
 * atualizam a mesma linha).
 *
 * Segue o mesmo padrão de elefante-sync.gs (service_role em Propriedades do
 * script, upsert via PostgREST com Prefer: resolution=merge-duplicates).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SETUP (uma vez):
 *   1. Planilha das visitas ▸ Extensões ▸ Apps Script → cole este arquivo.
 *   2. Configurações do projeto (engrenagem) ▸ Propriedades do script:
 *         Nome:  SUPABASE_SERVICE_KEY
 *         Valor: <service_role key do Supabase>  (Project Settings ▸ API)
 *      ⚠ NUNCA cole a service_role no navegador nem commite no repositório.
 *         Ela ignora o RLS; só pode viver aqui, no servidor do Google.
 *   3. Crie a tabela no Supabase (SQL em supabase-migracao.md).
 *   4. Recarregue a planilha → menu "🔄 MAPA · Visitas".
 *   5. Menu ▸ "Ativar rotina automática (1x/hora)" — instala o gatilho por tempo.
 *
 * USO — menu "🔄 MAPA · Visitas":
 *   • Sincronizar agora            → roda o upsert das 4 abas na hora
 *   • Ativar rotina automática     → cria o gatilho por tempo (padrão: 1x/hora)
 *   • Desativar rotina automática  → remove o gatilho
 *   • Testar conexão               → valida a service_role sem enviar nada
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Config ────────────────────────────────────────────────────────────────
var SUPABASE_URL   = 'https://gmwotfulohkmuqrezeef.supabase.co';
var SCHEMA         = 'relatorios';           // schema das tabelas (exponha em Project Settings ▸ API)
var TABELA         = 'relatorios_visitas';
var TABELA_ESCOLAS = 'relatorios_escolas';   // cadastro oficial (EMEF/EMEI) → cobertura
var LOTE           = 500;
var FREQ_HORAS     = 1;    // frequência da rotina automática (horas)

// Abas de respostas → segmento. A coluna F (índice 5) traz a escola em todas.
var ABAS_SEGMENTO = {
  'Fundamental':  'fundamental',
  'Infantil':     'infantil',
  'Fundamental2': 'fundamental2',
  'Infantil2':    'infantil2'
};

// Abas de cadastro (col A = escola, col B = regional) para resolver a regional
// dos formulários "2", que não perguntam a regional no próprio registro.
var ABA_CADASTRO = { fundamental: 'EMEF', infantil: 'EMEI' };

var COL_REGIONAL = 'Marque a Regional a qual pertente a unidade escolar.';

// ── Menu ──────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 MAPA · Visitas')
    .addItem('Sincronizar agora', 'sincronizarVisitasMenu')
    .addSeparator()
    .addItem('Ativar rotina automática (1x/hora)', 'ativarRotina')
    .addItem('Desativar rotina automática', 'desativarRotina')
    .addSeparator()
    .addItem('Testar conexão', 'testarConexao')
    .addToUi();
}

// ── Rotina automática (gatilho por tempo) ──────────────────────────────────
// Ponto de entrada do gatilho — NÃO usa UI (roda sem planilha aberta).
function sincronizarVisitas() {
  var r = _sincronizar();
  console.log('Sincronização de visitas: ' + JSON.stringify(r));
  return r;
}

function ativarRotina() {
  desativarRotina(true); // evita duplicar gatilhos
  ScriptApp.newTrigger('sincronizarVisitas')
    .timeBased()
    .everyHours(FREQ_HORAS)
    .create();
  _alerta('Rotina ativada',
    'A sincronização vai rodar automaticamente a cada ' + FREQ_HORAS + 'h.\n' +
    'Novas respostas do formulário serão enviadas ao Supabase sem intervenção.');
}

function desativarRotina(silencioso) {
  var gats = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < gats.length; i++) {
    if (gats[i].getHandlerFunction() === 'sincronizarVisitas') {
      ScriptApp.deleteTrigger(gats[i]); n++;
    }
  }
  if (!silencioso) _alerta('Rotina desativada', 'Removidos ' + n + ' gatilho(s). A sincronização automática está desligada.');
}

// Execução manual pelo menu (mostra o resumo).
function sincronizarVisitasMenu() {
  _serviceKey(); // erro claro se faltar a chave
  var r = _sincronizar();
  var linhas = ['✅ Sincronização concluída.\n'];
  for (var seg in r.porSegmento) linhas.push('  • ' + seg + ': ' + r.porSegmento[seg] + ' visita(s)');
  linhas.push('\nTotal enviado (upsert): ' + r.total + ' visita(s).');
  linhas.push('Cadastro de escolas: ' + (r.escolas || 0) + ' registro(s).');
  if (r.erros.length) linhas.push('\n⚠ Erros:\n  ' + r.erros.join('\n  '));
  _alerta('Sincronização de visitas', linhas.join('\n'));
}

// ── Núcleo (sem UI) ────────────────────────────────────────────────────────
function _sincronizar() {
  _serviceKey();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapaReg = _carregarMapaRegional(ss);
  var porSegmento = {}, erros = [], total = 0;

  for (var aba in ABAS_SEGMENTO) {
    var seg = ABAS_SEGMENTO[aba];
    try {
      var registros = _lerAbaVisitas(ss, aba, seg, mapaReg);
      _upsert(TABELA, registros, ['visita_uid']);
      porSegmento[aba] = registros.length;
      total += registros.length;
    } catch (e) {
      erros.push(aba + ': ' + e.message);
    }
  }

  // Cadastro oficial (EMEF/EMEI) → relatorios_escolas: dá a cobertura de escolas
  // "sem visita" nas Estatísticas. Falha aqui não impede o sync das visitas.
  var escolas = 0;
  try { escolas = _sincronizarCadastro(ss, mapaReg); }
  catch (e) { erros.push('cadastro escolas: ' + e.message); }

  return { total: total, porSegmento: porSegmento, escolas: escolas, erros: erros };
}

// Espelha a lista de escolas (abas EMEF/EMEI, col A) em relatorios_escolas, com a
// regional resolvida a partir das RESPOSTAS dos formulários base (fonte autoritativa —
// é a regional que a própria escola marcou no formulário). A coluna B das abas de
// cadastro NÃO é usada para regional (na planilha ela repete o nome da escola).
// A gravação é feita pela RPC relat_sync_escolas, que preserva regionais editadas à
// mão no relatorios.html (regional_manual = true) e só preenche/atualiza as demais.
function _sincronizarCadastro(ss, mapaReg) {
  var registros = [];
  for (var base in ABA_CADASTRO) {
    var aba = ss.getSheetByName(ABA_CADASTRO[base]);
    if (!aba || aba.getLastRow() < 2) continue;
    var nomes = aba.getRange(2, 1, aba.getLastRow() - 1, 1).getValues();
    var mapaBase = mapaReg[base] || {};
    for (var i = 0; i < nomes.length; i++) {
      var nome = nomes[i][0] ? String(nomes[i][0]).trim() : '';
      if (!nome) continue;
      registros.push({ segmento: base, nome: nome, regional: mapaBase[nome] || null });
    }
  }
  _rpc('relat_sync_escolas', { p_rows: registros });
  return registros.length;
}

// Lê uma aba de respostas e devolve os registros prontos para o Supabase.
function _lerAbaVisitas(ss, nomeAba, segmento, mapaReg) {
  var aba = ss.getSheetByName(nomeAba);
  if (!aba) return []; // aba pode ainda não existir (ex.: Infantil2 sem respostas)
  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return [];

  var tz = Session.getScriptTimeZone();
  var cab = dados[0].map(function (c) { return String(c).trim(); });
  var out = [];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var escola = linha[5];                                   // coluna F
    if (!escola || String(escola).trim() === '') continue;
    escola = String(escola).trim();

    // dados jsonb = objeto idêntico ao que o relatorios.html consome
    var d = {};
    for (var j = 0; j < cab.length; j++) {
      if (!cab[j]) continue;
      var v = linha[j];
      d[cab[j]] = (v instanceof Date) ? Utilities.formatDate(v, tz, 'dd/MM/yyyy HH:mm')
        : (v !== null && v !== undefined ? String(v) : '');
    }
    d['_ESCOLA_']   = escola;
    d['_SEGMENTO_'] = segmento;

    // Regional: direta da resposta (formulário base) ou resolvida pelo mapa
    // escola → regional (formulários "2" não perguntam a regional). Nunca deixa a
    // regional virar o nome da escola (guarda contra dado inconsistente na planilha).
    var regional = String(d[COL_REGIONAL] || '').trim();
    if (regional === escola) regional = '';
    if (!regional) {
      var base = segmento.replace(/2$/, '');
      regional = (mapaReg[base] || {})[escola] || '';
    }
    if (regional) d[COL_REGIONAL] = regional; else delete d[COL_REGIONAL];

    var carimbo   = _paraData(linha[cab.indexOf('Carimbo de data/hora')]);
    var dataVisitaStr = d['Data da Visita:'] || d['Data da visita:'] || d['Carimbo de data/hora'] || '';
    var dataVisita = _paraData(dataVisitaStr);

    out.push({
      visita_uid:      _uid(segmento, d['Carimbo de data/hora'] || '', escola),
      segmento:        segmento,
      escola:          escola,
      regional:        regional || null,
      periodo:         d['Assinale o período da visita.'] || null,
      responsavel:     d['Nome(s) do(s) responsável(is) pelo acompanhamento pedagógico.'] || null,
      email:           d['Endereço de e-mail'] || null,
      data_visita:     dataVisita ? Utilities.formatDate(dataVisita, tz, 'yyyy-MM-dd') : null,
      carimbo:         carimbo ? carimbo.toISOString() : null,
      data_visita_txt: dataVisitaStr || null,   // string original (p/ casar com devolutivas)
      dados:           d
    });
  }
  return out;
}

// Mapa escola → regional montado a partir das RESPOSTAS dos formulários base
// (abas Fundamental/Infantil): a coluna "Marque a Regional..." traz a regional que a
// própria escola marcou — fonte autoritativa. É esse mapa que preenche a regional das
// visitas dos formulários "2" (que não perguntam a regional) e o cadastro de escolas.
// A coluna B das abas EMEF/EMEI não é usada (na planilha ela repete o nome da escola).
function _carregarMapaRegional(ss) {
  var mapa = { fundamental: {}, infantil: {} };
  var ABAS_BASE = { Fundamental: 'fundamental', Infantil: 'infantil' };
  for (var nomeAba in ABAS_BASE) {
    var base = ABAS_BASE[nomeAba];
    var aba = ss.getSheetByName(nomeAba);
    if (!aba || aba.getLastRow() < 2) continue;
    var dados = aba.getDataRange().getValues();
    var cab = dados[0].map(function (c) { return String(c).trim(); });
    var iReg = cab.indexOf(COL_REGIONAL);
    if (iReg < 0) continue;
    for (var i = 1; i < dados.length; i++) {
      var esc = dados[i][5] ? String(dados[i][5]).trim() : '';   // coluna F
      var reg = dados[i][iReg] ? String(dados[i][iReg]).trim() : '';
      if (esc && reg && reg !== esc) mapa[base][esc] = reg;       // nunca escola como regional
    }
  }
  return mapa;
}

// ── Identidade estável da visita ──────────────────────────────────────────
// Chave imutável: segmento + carimbo (timestamp da submissão) + escola.
// Respostas editadas mantêm o carimbo → mesmo uid → upsert atualiza a linha.
function _uid(segmento, carimbo, escola) {
  var base = (segmento + '|' + carimbo + '|' + escola).toLowerCase().replace(/\s+/g, '_');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base)
    .map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); })
    .join('').substring(0, 16);
}

// ── Datas: aceita Date ou "dd/MM/yyyy[ HH:mm[:ss]]" → Date (ou null) ────────
function _paraData(v) {
  if (v instanceof Date) return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var m = s.match(/(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

// ── Envio ao Supabase (upsert em lote) ────────────────────────────────────
function _upsert(tabela, registros, onConflict) {
  if (!registros.length) return;
  var key = _serviceKey();
  for (var i = 0; i < registros.length; i += LOTE) {
    var lote = registros.slice(i, i + LOTE);
    var url = SUPABASE_URL + '/rest/v1/' + tabela + '?on_conflict=' + onConflict.join(',');
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Profile': SCHEMA,            // grava no schema (não em public)
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(lote),
      muteHttpExceptions: true
    });
    var cod = resp.getResponseCode();
    if (cod < 200 || cod >= 300) {
      throw new Error(tabela + ' → ' + cod + ': ' + resp.getContentText());
    }
  }
}

// Chama uma RPC (função em public). Usada para o cadastro de escolas, cuja gravação
// tem lógica (preservar regionais editadas à mão), logo não é um upsert cru.
function _rpc(fn, args) {
  var key = _serviceKey();
  var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },  // RPC em public → sem Content-Profile
    payload: JSON.stringify(args || {}),
    muteHttpExceptions: true
  });
  var cod = resp.getResponseCode();
  if (cod < 200 || cod >= 300) throw new Error('rpc ' + fn + ' → ' + cod + ': ' + resp.getContentText());
  return resp.getContentText();
}

// ── Diagnóstico / util ─────────────────────────────────────────────────────
function testarConexao() {
  var key = _serviceKey();
  var url = SUPABASE_URL + '/rest/v1/' + TABELA + '?select=visita_uid&limit=1';
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Accept-Profile': SCHEMA },
    muteHttpExceptions: true
  });
  var cod = resp.getResponseCode();
  var msg = 'HTTP ' + cod + ' · schema ' + SCHEMA + '\nChave: ' + key.slice(0, 6) + '…' + key.slice(-4) +
            ' (' + key.length + ' chars)\n\n' + resp.getContentText().slice(0, 400);
  if (cod >= 200 && cod < 300)  msg = '✅ Conexão OK (' + SCHEMA + '.' + TABELA + ' acessível).\n\n' + msg;
  else if (cod === 401)         msg = '❌ Chave inválida (401). Recopie a service_role.\n\n' + msg;
  else if (cod === 404)         msg = '❌ Tabela não encontrada. Rode o SQL e exponha o schema "' + SCHEMA +
                                      '" em Project Settings ▸ API ▸ Exposed schemas.\n\n' + msg;
  _alerta('Teste de conexão', msg);
}

function _serviceKey() {
  var k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) {
    throw new Error('Falta a propriedade SUPABASE_SERVICE_KEY nas Propriedades do script. ' +
                    'Configurações do projeto ▸ Propriedades do script.');
  }
  return String(k).replace(/\s+/g, '');
}

function _alerta(titulo, msg) {
  SpreadsheetApp.getUi().alert(titulo, msg, SpreadsheetApp.getUi().ButtonSet.OK);
}
