/**
 * elefante-sync.gs — Envia os dados do Elefante Letrado direto da planilha
 * Google Sheets para o Supabase (tabelas elefante_escolas / elefante_turmas).
 *
 * Substitui a importação manual de .xlsx da tela elefante.html.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SETUP (fazer uma vez):
 *   1. Abra a planilha "Dados elefante letrado" no Google Sheets.
 *   2. Extensões ▸ Apps Script → cole este arquivo (ou crie elefante-sync.gs).
 *   3. Configurações do projeto (engrenagem) ▸ Propriedades do script ▸
 *      Adicionar propriedade:
 *         Nome:  SUPABASE_SERVICE_KEY
 *         Valor: <a "service_role" key do Supabase>
 *              (Supabase ▸ Project Settings ▸ API ▸ service_role  — a SECRETA)
 *      ⚠ NUNCA cole a service_role key no navegador nem commite no repositório.
 *         Ela ignora o RLS, então só pode viver aqui, no servidor do Google.
 *   4. Recarregue a planilha → aparece o menu "🐘 MAPA".
 *
 * USO — menu "🐘 MAPA":
 *   • Enviar meses novos    → compara com o Supabase e envia só o que falta (padrão)
 *   • Reenviar TODOS (forçar) → reenvia todos os meses (upsert; sobrescreve)
 *   • Enviar aba ativa      → sincroniza só o período da aba selecionada
 *   • Testar conexão        → valida a service_role sem enviar nada
 *
 * MÊS: detectado automaticamente pelo nome da aba (ex.: "Maio 2026" → 2026-05,
 *   "Março Abril - 2026" → 2026-03). Sem ano no nome ("Junho") usa ANO_PADRAO.
 *   Para forçar um período, registre em MONTH_MAP.
 *
 * NOMES DE ESCOLA: gravados com a grafia oficial da aba "email" (coluna A).
 *   O casamento com os nomes dos dados é feito por aproximação; casos incertos
 *   aparecem no relatório final. Para fixar um caso, use ALIAS.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Config ────────────────────────────────────────────────────────────────
var SUPABASE_URL = 'https://gmwotfulohkmuqrezeef.supabase.co';
var ANO_PADRAO   = 2026;   // usado quando o nome da aba não traz o ano

// Override de período (opcional): sufixo da aba → mês AAAA-MM-01.
// Só é preciso quando a detecção automática pelo nome falhar ou estiver errada.
var MONTH_MAP = {
  // 'Junho': '2026-06-01',
};

// Override de nome (opcional): chave normalizada do dado → grafia oficial exata.
// Preencha só se o relatório apontar um casamento errado.
// Ex.: 'EPONINA DE BRITTO ROSSETTO': 'EPONINA DE BRITTO ROSSETO, PROFª., EMEF'
var ALIAS = {};

var PREFIXO_ESCOLA = 'Por Escola - ';
var PREFIXO_TURMA  = 'Por Turma - ';
var ABA_EMAIL      = 'email';   // coluna A = grafia oficial das escolas
var LOTE           = 500;

// ── Menu ──────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🐘 MAPA')
    .addItem('Enviar meses novos', 'enviarNovos')
    .addSeparator()
    .addItem('Reenviar TODOS os meses (forçar)', 'enviarTodos')
    .addItem('Enviar aba ativa', 'enviarAbaAtiva')
    .addItem('Testar conexão', 'testarConexao')
    .addToUi();
}

// ── Ações ─────────────────────────────────────────────────────────────────
function enviarAbaAtiva() {
  var nome = SpreadsheetApp.getActiveSheet().getName();
  var sufixo = _sufixoDoNome(nome);
  if (!sufixo) {
    _alerta('Aba inválida',
      'Selecione uma aba "' + PREFIXO_ESCOLA + '..." ou "' + PREFIXO_TURMA + '...".');
    return;
  }
  _executar([sufixo]);
}

function enviarTodos() {
  var sufixos = _periodosDisponiveis(SpreadsheetApp.getActiveSpreadsheet());
  if (!sufixos.length) { _alerta('Nada a enviar', 'Nenhuma aba "Por Escola - ..." encontrada.'); return; }
  _executar(sufixos);
}

// Envia só os meses que ainda não estão no Supabase.
function enviarNovos() {
  _serviceKey();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var todos = _periodosDisponiveis(ss);
  if (!todos.length) { _alerta('Nada a enviar', 'Nenhuma aba "Por Escola - ..." encontrada.'); return; }

  var enviados = _mesesJaEnviados();  // { 'AAAA-MM-01': true }
  var novos = [], pulados = [];
  for (var i = 0; i < todos.length; i++) {
    var suf = todos[i], mes;
    try { mes = _mesReferencia(suf); }
    catch (e) { novos.push(suf); continue; }        // sem mês identificado → tenta (reporta erro)
    if (enviados[mes]) pulados.push(suf + ' (' + mes + ')');
    else novos.push(suf);
  }

  if (!novos.length) {
    _alerta('Tudo em dia', 'Nenhum mês novo para enviar.\n\nJá no Supabase:\n  ' + pulados.join('\n  '));
    return;
  }
  _executar(novos, pulados);
}

// Meses (mes_referencia) que já existem em elefante_escolas.
function _mesesJaEnviados() {
  var key = _serviceKey();
  var url = SUPABASE_URL + '/rest/v1/elefante_escolas?select=mes_referencia';
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Falha ao ler meses já enviados: ' + resp.getResponseCode() + ' ' + resp.getContentText());
  }
  var arr = JSON.parse(resp.getContentText() || '[]');
  var set = {};
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].mes_referencia) set[String(arr[i].mes_referencia).slice(0, 10)] = true;
  }
  return set;
}

// ── Orquestração ──────────────────────────────────────────────────────────
function _executar(sufixos, pulados) {
  _serviceKey(); // valida a chave antes de começar (erro claro se faltar)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var canon = _carregarCanonicos(ss);
  var rel = { aprox: [], semMatch: [], ambiguo: [] };
  var linhas = [];

  if (pulados && pulados.length) {
    linhas.push('⏭ Já no Supabase (pulados): ' + pulados.join(', ') + '\n');
  }

  for (var i = 0; i < sufixos.length; i++) {
    try {
      var r = _sincronizarPeriodo(ss, sufixos[i], canon, rel);
      linhas.push('✅ ' + sufixos[i] + ' (' + r.mes + '): ' + r.escolas + ' escolas · ' + r.turmas + ' turmas');
    } catch (e) {
      linhas.push('❌ ' + sufixos[i] + ': ' + e.message);
    }
  }

  // nomes casados por aproximação / não casados (deduplicados)
  var aprox    = _unico(rel.aprox);
  var semMatch = _unico(rel.semMatch);
  var ambiguo  = _unico(rel.ambiguo);
  if (aprox.length)    linhas.push('\n🔎 Casados por aproximação (confira):\n  ' + aprox.join('\n  '));
  if (ambiguo.length)  linhas.push('\n⚠ Ambíguos (mais de um candidato):\n  ' + ambiguo.join('\n  '));
  if (semMatch.length) linhas.push('\n❓ Sem correspondência na aba "' + ABA_EMAIL +
                                   '" (gravados como estão):\n  ' + semMatch.join('\n  '));

  _alerta('Sincronização concluída', linhas.join('\n'));
}

function _sincronizarPeriodo(ss, sufixo, canon, rel) {
  var mesRef = _mesReferencia(sufixo);
  var abaE = ss.getSheetByName(PREFIXO_ESCOLA + sufixo);
  var abaT = ss.getSheetByName(PREFIXO_TURMA  + sufixo);
  if (!abaE) throw new Error('Aba "' + PREFIXO_ESCOLA + sufixo + '" não encontrada.');
  if (!abaT) throw new Error('Aba "' + PREFIXO_TURMA  + sufixo + '" não encontrada.');

  var origem = ss.getName() + ' · ' + sufixo;

  var escolas = _lerObjetos(abaE)
    .map(function (r) { return _mapEscola(r, mesRef, origem, canon, rel); })
    .filter(function (e) { return e.nome_escola; });

  var turmas = _lerObjetos(abaT)
    .map(function (r) { return _mapTurma(r, mesRef, origem, canon, rel); })
    .filter(function (t) { return t.escola && t.turma; });

  _upsert('elefante_escolas', escolas, ['mes_referencia', 'nome_escola']);
  _upsert('elefante_turmas',  turmas,  ['mes_referencia', 'escola', 'turma']);

  return { escolas: escolas.length, turmas: turmas.length, mes: mesRef };
}

// ── Mês de referência a partir do nome da aba ─────────────────────────────
function _mesReferencia(sufixo) {
  if (MONTH_MAP[sufixo]) return MONTH_MAP[sufixo];

  var s = _semAcento(String(sufixo).toLowerCase());
  var MESES = ['janeiro','fevereiro','marco','abril','maio','junho',
               'julho','agosto','setembro','outubro','novembro','dezembro'];
  // primeiro mês que aparece no nome (posição mínima)
  var mes = 0, pos = Infinity;
  for (var i = 0; i < MESES.length; i++) {
    var p = s.indexOf(MESES[i]);
    if (p >= 0 && p < pos) { pos = p; mes = i + 1; }
  }
  if (!mes) {
    throw new Error('Não consegui identificar o mês em "' + sufixo +
                    '". Adicione ao MONTH_MAP.');
  }
  var ano = ANO_PADRAO;
  var my = s.match(/(\d{4})/);
  if (my) ano = +my[1];
  return ano + '-' + (mes < 10 ? '0' + mes : mes) + '-01';
}

// ── Nomes oficiais (aba "email", coluna A) ────────────────────────────────
function _carregarCanonicos(ss) {
  var aba = ss.getSheetByName(ABA_EMAIL);
  if (!aba) throw new Error('Aba "' + ABA_EMAIL + '" não encontrada (grafia oficial das escolas).');
  var col = aba.getRange(1, 1, aba.getLastRow(), 1).getValues();
  var vistos = {}, lista = [];
  for (var i = 0; i < col.length; i++) {
    var nome = _s(col[i][0]);
    if (!nome) continue;
    var chave = _normalizar(nome);
    if (!chave || chave === 'ESCOLA' || chave === 'SME') continue; // header / pseudo
    if (vistos[chave]) continue;
    vistos[chave] = true;
    lista.push({ nome: nome, chave: chave, tokens: chave.split(' ') });
  }
  return lista;
}

// Devolve a grafia oficial para um nome de escola dos dados (ou o próprio nome
// se não houver correspondência). Registra aproximações/falhas em `rel`.
function _canonizar(nomeDados, canon, rel) {
  var key = _normalizar(nomeDados);
  if (!key) return nomeDados;
  if (ALIAS[key]) return ALIAS[key];

  // 1) exato
  var ex = canon.filter(function (c) { return c.chave === key; });
  if (ex.length === 1) return ex[0].nome;
  if (ex.length > 1) { rel.ambiguo.push(nomeDados + ' → vários (exato)'); return ex[0].nome; }

  // 2) prefixo (um núcleo é começo do outro)
  var pre = canon.filter(function (c) { return _prefixo(key, c.chave) || _prefixo(c.chave, key); });
  if (pre.length === 1) { rel.aprox.push(nomeDados + ' → ' + pre[0].nome + '  (prefixo)'); return pre[0].nome; }

  // 3) subconjunto de tokens (um conjunto de palavras contém o outro)
  var kt = key.split(' ');
  var sub = canon.filter(function (c) { return _subset(c.tokens, kt) || _subset(kt, c.tokens); });
  if (sub.length === 1) { rel.aprox.push(nomeDados + ' → ' + sub[0].nome + '  (tokens)'); return sub[0].nome; }

  // 4) aproximado (distância de edição ≤ 2, melhor único)
  var best = null, bd = 99, empate = false;
  for (var i = 0; i < canon.length; i++) {
    var d = _lev(key, canon[i].chave);
    if (d < bd) { bd = d; best = canon[i]; empate = false; }
    else if (d === bd) { empate = true; }
  }
  if (best && bd <= 2 && !empate) {
    rel.aprox.push(nomeDados + ' → ' + best.nome + '  (~' + bd + ')');
    return best.nome;
  }

  rel.semMatch.push(nomeDados);
  return nomeDados;
}

// Normaliza p/ casamento: maiúsculas, sem acento, sem pontuação e sem títulos.
function _normalizar(nome) {
  var s = ' ' + _semAcento(String(nome == null ? '' : nome).toUpperCase()) + ' ';
  s = s.replace(/[.,;:]/g, ' ');
  var TITULOS = ['PROF','PROFA','PROFO','PROFESSOR','PROFESSORA','DR','DRA','DOUTOR',
                 'DOUTORA','VER','VEREADOR','VEREADORA','DOM','DONA','EMEF','EMEI',
                 'CEMEI','EMEB','ESCOLA','MUNICIPAL','DE ENSINO','FUNDAMENTAL'];
  for (var i = 0; i < TITULOS.length; i++) {
    var re = new RegExp('\\s' + TITULOS[i] + '\\s');  // sem /g: teste sem estado
    while (re.test(s)) s = s.replace(re, ' ');        // repete p/ títulos adjacentes
  }
  return s.replace(/\s+/g, ' ').trim();
}

function _semAcento(s) {
  return String(s)
    .replace(/[ÁÀÂÃÄáàâãä]/g, 'A').replace(/[ÉÈÊËéèêë]/g, 'E')
    .replace(/[ÍÌÎÏíìîï]/g, 'I').replace(/[ÓÒÔÕÖóòôõö]/g, 'O')
    .replace(/[ÚÙÛÜúùûü]/g, 'U').replace(/[Ççªº°]/g, function (c) { return c === 'Ç' || c === 'ç' ? 'C' : ''; });
}

function _prefixo(a, b) { return a === b || b.indexOf(a + ' ') === 0; }

function _subset(pequeno, grande) {
  if (pequeno.length < 2 || pequeno.length >= grande.length) return false;
  for (var i = 0; i < pequeno.length; i++) if (grande.indexOf(pequeno[i]) < 0) return false;
  return true;
}

function _lev(a, b) {
  var m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  var prev = [], cur = [];
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (var i = 1; i <= m; i++) {
    cur[0] = i;
    for (var k = 1; k <= n; k++) {
      var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
    }
    for (var t = 0; t <= n; t++) prev[t] = cur[t];
  }
  return prev[n];
}

// ── Mapeamento (mesmos cabeçalhos/colunas do lerXlsx em elefante.html) ─────
function _mapEscola(r, mesRef, origem, canon, rel) {
  return {
    nome_escola:             _canonizar(_s(r['Nome da Escola']), canon, rel),
    estudantes_leitura:      _n(r['Estudantes (Leitura)']),
    leituras_concluidas:     _n(r['Leituras Concluídas']),
    tempo_medio_leitura_seg: _t(r['Tempo Médio de Leitura']),
    tempo_total_leitura_seg: _t(r['Tempo Total de Leitura']),
    estudantes_escuta:       _n(r['Estudantes (Escuta)']),
    escutas_concluidas:      _n(r['Escutas Concluídas']),
    tempo_medio_escuta_seg:  _t(r['Tempo Médio de Escuta']),
    tempo_total_escuta_seg:  _t(r['Tempo Total de Escuta']),
    mes_referencia:          mesRef,
    arquivo_origem:          origem
  };
}

function _mapTurma(r, mesRef, origem, canon, rel) {
  return {
    escola:            _canonizar(_s(r['Escola']), canon, rel),
    ano_escolar:       _s(r['Ano']),
    turma:             _s(r['Turma']),
    turno:             _s(r['Turno']),
    tipo:              _s(r['Tipo']),
    professores:       _s(r['Professores']),
    estudantes:        _n(r['Estudantes']),
    leitores:          _n(r['Leitores']),
    livros_lidos:      _n(r['Livros Lidos']),
    tempo_leitura_seg: _t(r['Tempo de Leitura']),
    mes_referencia:    mesRef,
    arquivo_origem:    origem
  };
}

// ── Leitor de aba: linha 1 = cabeçalhos → array de objetos ────────────────
function _lerObjetos(sheet) {
  var valores = sheet.getDataRange().getValues();
  if (valores.length < 2) return [];
  var cab = valores[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < valores.length; i++) {
    var linha = valores[i];
    var vazia = linha.every(function (c) { return c === '' || c === null; });
    if (vazia) continue;
    var obj = {};
    for (var j = 0; j < cab.length; j++) if (cab[j]) obj[cab[j]] = linha[j];
    out.push(obj);
  }
  return out;
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

// ── Helpers de parsing (replicam n() e t() de elefante.html) ──────────────
function _s(v) { return String(v == null ? '' : v).trim(); }

function _n(v) {
  if (typeof v === 'number') return Math.round(v);
  var x = parseFloat(String(v == null ? 0 : v).replace(',', '.'));
  return isNaN(x) ? 0 : Math.round(x);
}

// "32min 49s", "128h01s", "11h 25min41s" → segundos
function _t(v) {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return Math.round(v); // já em segundos, se for número
  var s = String(v).toLowerCase().replace(/\s+/g, '');
  if (!s || s === '00s') return 0;
  var h = s.match(/(\d+)h/), m = s.match(/(\d+)min/), sc = s.match(/(\d+)s/);
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (sc ? +sc[1] : 0);
}

// ── Utilidades ────────────────────────────────────────────────────────────
function _periodosDisponiveis(ss) {
  var abas = ss.getSheets(), vistos = {}, out = [];
  for (var i = 0; i < abas.length; i++) {
    var nome = abas[i].getName();
    if (nome.indexOf(PREFIXO_ESCOLA) === 0) {
      var suf = nome.slice(PREFIXO_ESCOLA.length);
      if (!vistos[suf]) { vistos[suf] = true; out.push(suf); }
    }
  }
  return out;
}

function _sufixoDoNome(nome) {
  if (nome.indexOf(PREFIXO_ESCOLA) === 0) return nome.slice(PREFIXO_ESCOLA.length);
  if (nome.indexOf(PREFIXO_TURMA)  === 0) return nome.slice(PREFIXO_TURMA.length);
  return null;
}

function _unico(arr) {
  var v = {}, out = [];
  for (var i = 0; i < arr.length; i++) if (!v[arr[i]]) { v[arr[i]] = true; out.push(arr[i]); }
  return out;
}

function _serviceKey() {
  var k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) {
    throw new Error('Falta a propriedade SUPABASE_SERVICE_KEY nas Propriedades do script. ' +
                    'Configurações do projeto ▸ Propriedades do script.');
  }
  return String(k).replace(/\s+/g, '');  // remove espaços/quebras coladas junto
}

// Diagnóstico rápido: valida a chave e o acesso às tabelas sem enviar nada.
function testarConexao() {
  var key = _serviceKey();
  var url = SUPABASE_URL + '/rest/v1/elefante_escolas?select=nome_escola&limit=1';
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  var cod = resp.getResponseCode();
  var ini = key.slice(0, 6), fim = key.slice(-4);
  var msg = 'HTTP ' + cod + '\n' +
            'Chave: ' + ini + '…' + fim + ' (' + key.length + ' chars)\n\n' +
            resp.getContentText().slice(0, 400);
  if (cod >= 200 && cod < 300) msg = '✅ Conexão OK.\n\n' + msg;
  else if (cod === 401)        msg = '❌ Chave inválida (401). Recopie a service_role do Supabase.\n\n' + msg;
  _alerta('Teste de conexão', msg);
}

function _alerta(titulo, msg) {
  SpreadsheetApp.getUi().alert(titulo, msg, SpreadsheetApp.getUi().ButtonSet.OK);
}
