/**
 * =====================================================================
 * Backend_Setup.gs — v3 com porTurma no PropertiesService
 * =====================================================================
 * Além do payload principal (rede+anos+unidades+arvore),
 * armazena porUniTurma separado por unidade — isso elimina a leitura
 * de 269k linhas ao selecionar uma turma específica.
 *
 * Formato das chaves:
 *   RESUMO_BIM_primeiroBimestre     → payload principal (91KB)
 *   TURMA_BIM_primeiroBimestre_ALCINA → dados de turma da unidade (18KB)
 *   LASTROW_Primeiro_Bimestre       → lastRow para invalidação automática
 * =====================================================================
 */

var PROP_RESUMO_BIM_PREFIX = 'RESUMO_BIM_';
var PROP_TURMA_BIM_PREFIX  = 'TURMA_BIM_';
var PROP_RESUMO_DIAG       = 'RESUMO_DIAG';
var PROP_LASTROW_PREFIX    = 'LASTROW_';

// =======================================================
// FUNÇÃO PRINCIPAL — execute no editor do Apps Script
// =======================================================
function setupResumos() {
  var log = [];
  var t0  = Date.now();

  Logger.log('=== SETUP MAPA v3 — Iniciando ===');

  var bimestres = [
    { key: 'primeiroBimestre',  bim: '1' },
    { key: 'segundoBimestre',   bim: '2' },
    { key: 'terceiroBimestre',  bim: '3' },
    { key: 'quartoBimestre',    bim: '4' }
  ];

  bimestres.forEach(function(b) {
    var t1  = Date.now();
    var res = _calcularEPersistirBimestre_(b.key, b.bim, true);
    var s   = Math.round((Date.now() - t1) / 1000);
    var msg = b.key + ': ' + res.linhas + ' combinações, ' + res.turmasChaves + ' chaves de turma em ' + s + 's';
    log.push(msg);
    Logger.log(msg);
  });

  var t2  = Date.now();
  var rD  = _calcularEPersistirDiagnostica_(true);
  var sD  = Math.round((Date.now() - t2) / 1000);
  var msgD = 'Diagnostica: ' + rD.linhas + ' combinações em ' + sD + 's';
  log.push(msgD);
  Logger.log(msgD);

  var total = Math.round((Date.now() - t0) / 1000);
  log.push('✅ Concluído em ' + total + 's — sistema pronto.');
  Logger.log('=== SETUP CONCLUÍDO em ' + total + 's ===');
  return log.join('\n');
}

// =======================================================
// VERIFICAR STATUS
// =======================================================
function verificarResumos() {
  var props = PropertiesService.getScriptProperties();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();

  ['primeiroBimestre','segundoBimestre','terceiroBimestre','quartoBimestre'].forEach(function(key) {
    var sheetName = AVALIACAO_SHEETS[key];
    var sh        = ss.getSheetByName(sheetName);
    var lastRow   = sh ? sh.getLastRow() : 0;
    var salvo     = props.getProperty(PROP_LASTROW_PREFIX + sheetName) || '0';
    var dados     = props.getProperty(PROP_RESUMO_BIM_PREFIX + key);
    var tamanho   = dados ? Math.round(dados.length / 1024) + 'KB' : 'VAZIO';
    var ok        = dados ? '✅' : '❌';
    var atualizado = String(lastRow) === salvo ? 'atualizado' : '⚠️  DESATUALIZADO — execute setupResumos()';
    Logger.log(ok + ' ' + key + ': ' + tamanho + ' | lastRow=' + lastRow + ' | ' + atualizado);
  });

  var diagDados = props.getProperty(PROP_RESUMO_DIAG);
  Logger.log((diagDados ? '✅' : '❌') + ' Diagnostica: ' + (diagDados ? Math.round(diagDados.length/1024) + 'KB' : 'VAZIO'));

  // Conta chaves de turma
  var allProps = props.getProperties();
  var turmaKeys = Object.keys(allProps).filter(function(k) { return k.indexOf(PROP_TURMA_BIM_PREFIX) === 0; });
  Logger.log('📦 Chaves de turma armazenadas: ' + turmaKeys.length);
}

function limparResumosSalvos() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log('Todos os resumos apagados. Execute setupResumos() para recalcular.');
}

// =======================================================
// CALCULAR E PERSISTIR BIMESTRE
// Gera payload principal + dados por unidade/turma
// =======================================================
function _calcularEPersistirBimestre_(key, bimNum, forcar) {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = AVALIACAO_SHEETS[key] || key;
  var sheet     = ss.getSheetByName(sheetName);
  var props     = PropertiesService.getScriptProperties();

  if (!sheet) { Logger.log('Aba não encontrada: ' + sheetName); return { linhas: 0, turmasChaves: 0 }; }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (!forcar) {
    var lastRowSalvo = props.getProperty(PROP_LASTROW_PREFIX + sheetName);
    var dadosSalvos  = props.getProperty(PROP_RESUMO_BIM_PREFIX + key);
    if (dadosSalvos && String(lastRow) === lastRowSalvo) return { linhas: 0, turmasChaves: 0, cached: true };
  }

  if (lastRow < 2) return { linhas: 0, turmasChaves: 0 };

  Logger.log('Lendo ' + sheetName + ' (' + (lastRow-1) + ' linhas)...');

  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var h    = data[0];

  var iU   = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO ESCOLAR']);
  var iT   = idx_(h, ['TURMA']);
  var iRa  = idx_(h, ['REMA - ALUNO', 'RA']);
  var iD   = idx_(h, ['FNC-DISCIPLINA', 'DISCIPLINA']);
  var iE   = idx_(h, ['DESCRIÇÃO FNE', 'DESCRICAO FNE']);
  var iVl  = idx_(h, ['VL. RESPOSTA', 'VL RESPOSTA']);
  var iTxt = idx_(h, ['TEXTO RESPOSTA']);

  var rede       = {};
  var porAno     = {};
  var porUni     = {};
  var porUniTurma = {};  // NOVO: unidade -> turma -> disc -> eixo -> rotulo -> count
  var arvore     = {};
  var anosSet    = {};
  var discSet    = {};

  for (var r = 1; r < data.length; r++) {
    var row   = data[r];
    var u     = cleanUnit_(safeCell_(row, iU));
    var ano   = String(safeCell_(row, iAno) || '').trim().toUpperCase();
    var t     = String(safeCell_(row, iT)   || '').trim().toUpperCase();
    var ra    = String(safeCell_(row, iRa)  || '').trim();
    var disc  = normalizarDisciplina_(safeCell_(row, iD));
    var eixo  = String(safeCell_(row, iE)   || '').trim();
    var vlRaw = safeCell_(row, iVl);
    var txt   = String(safeCell_(row, iTxt) || '').trim();

    if (!u || !disc || !eixo) continue;

    var rot = labelCurto_(normFne_(eixo), normVl_(String(vlRaw)));
    if (!rot || rot === '-') rot = txt.length > 50 ? txt.substring(0, 50) : txt;
    if (!rot) continue;

    discSet[disc] = true;
    anosSet[ano]  = true;

    // rede
    if (!rede[disc])             rede[disc]            = {};
    if (!rede[disc][eixo])       rede[disc][eixo]      = {};
    rede[disc][eixo][rot]        = (rede[disc][eixo][rot] || 0) + 1;

    // por ano
    if (!porAno[ano])             porAno[ano]            = {};
    if (!porAno[ano][disc])       porAno[ano][disc]      = {};
    if (!porAno[ano][disc][eixo]) porAno[ano][disc][eixo] = {};
    porAno[ano][disc][eixo][rot] = (porAno[ano][disc][eixo][rot] || 0) + 1;

    // por unidade (sem turma — para filtro de unidade)
    if (!porUni[u])               porUni[u]              = {};
    if (!porUni[u][disc])         porUni[u][disc]        = {};
    if (!porUni[u][disc][eixo])   porUni[u][disc][eixo]  = {};
    porUni[u][disc][eixo][rot]    = (porUni[u][disc][eixo][rot] || 0) + 1;

    // por unidade+turma — NOVO (para filtro de turma sem nova leitura)
    if (!porUniTurma[u])          porUniTurma[u]          = {};
    if (!porUniTurma[u][t])       porUniTurma[u][t]       = {};
    if (!porUniTurma[u][t][disc]) porUniTurma[u][t][disc] = {};
    if (!porUniTurma[u][t][disc][eixo]) porUniTurma[u][t][disc][eixo] = {};
    porUniTurma[u][t][disc][eixo][rot] = (porUniTurma[u][t][disc][eixo][rot] || 0) + 1;

    // árvore
    if (!arvore[u])        arvore[u]        = {};
    if (!arvore[u][t])     arvore[u][t]     = {};
    if (ra) arvore[u][t][ra] = true;
  }

  // Converte árvore
  var arvoreCount = {};
  Object.keys(arvore).forEach(function(u) {
    arvoreCount[u] = {};
    Object.keys(arvore[u]).forEach(function(t) {
      arvoreCount[u][t] = Object.keys(arvore[u][t]).length;
    });
  });

  // Payload principal
  var resultado = {
    ok:              true,
    disciplinas:     Object.keys(discSet).sort(),
    anosDisponiveis: Object.keys(anosSet).sort(),
    rede:            rede,
    anos:            porAno,
    unidades:        porUni,
    arvore:          arvoreCount,
    bimestre:        bimNum,
    generatedAt:     new Date().toISOString()
  };

  var json = JSON.stringify(resultado);
  Logger.log('Salvando payload principal ' + key + ': ' + Math.round(json.length / 1024) + 'KB');
  props.setProperty(PROP_RESUMO_BIM_PREFIX + key, json);
  props.setProperty(PROP_LASTROW_PREFIX + sheetName, String(lastRow));

  // Salva porUniTurma — uma chave por unidade (evita exceder 500KB/chave)
  var turmasChaves = 0;
  Object.keys(porUniTurma).forEach(function(u) {
    var chaveU  = PROP_TURMA_BIM_PREFIX + key + '_' + u.substring(0, 40).replace(/[^A-Z0-9]/gi, '_');
    var jsonU   = JSON.stringify(porUniTurma[u]);
    Logger.log('  Turma ' + u + ': ' + Math.round(jsonU.length / 1024) + 'KB');
    props.setProperty(chaveU, jsonU);
    turmasChaves++;
  });

  // Salva mapa de unidade → chave para lookup rápido
  var mapaChaves = {};
  Object.keys(porUniTurma).forEach(function(u) {
    mapaChaves[u] = PROP_TURMA_BIM_PREFIX + key + '_' + u.substring(0, 40).replace(/[^A-Z0-9]/gi, '_');
  });
  props.setProperty(PROP_TURMA_BIM_PREFIX + key + '_MAPA', JSON.stringify(mapaChaves));

  // Cache 6h no CacheService
  cachePut_('bim_v5_' + key, resultado, 21600);

  var linhas = Object.keys(rede).reduce(function(acc, d) {
    return acc + Object.keys(rede[d]).reduce(function(a, e) { return a + Object.keys(rede[d][e]).length; }, 0);
  }, 0);

  return { linhas: linhas, turmasChaves: turmasChaves };
}

// =======================================================
// CALCULAR E PERSISTIR DIAGNÓSTICA (sem alteração)
// =======================================================
function _calcularEPersistirDiagnostica_(forcar) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Alunos');
  var props = PropertiesService.getScriptProperties();

  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Aba Alunos não encontrada.'); return { linhas: 0 }; }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (!forcar) {
    var salvo  = props.getProperty(PROP_LASTROW_PREFIX + 'Alunos');
    var dados  = props.getProperty(PROP_RESUMO_DIAG);
    if (dados && String(lastRow) === salvo) return { linhas: 0, cached: true };
  }

  Logger.log('Lendo Alunos (' + (lastRow-1) + ' linhas)...');

  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var h    = data[0];

  var iU   = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO ESCOLAR']);
  var iT   = idx_(h, ['TURMA']);
  var iE   = idx_(h, ['DESCRIÇÃO FNE', 'DESCRICAO FNE']);
  var iVl  = idx_(h, ['VL. RESPOSTA', 'VL RESPOSTA']);
  var iTxt = idx_(h, ['TEXTO RESPOSTA']);
  var iRa  = idx_(h, ['REMA - ALUNO', 'RA']);

  var rede = {}, porAno = {}, porUni = {}, arvore = {}, anosSet = {};

  for (var r = 1; r < data.length; r++) {
    var row  = data[r];
    var u    = cleanUnit_(safeCell_(row, iU));
    var ano  = String(safeCell_(row, iAno) || '').trim().toUpperCase();
    var t    = String(safeCell_(row, iT)   || '').trim().toUpperCase();
    var ra   = String(safeCell_(row, iRa)  || '').trim();
    var eixo = String(safeCell_(row, iE)   || '').trim();
    var vlRaw = safeCell_(row, iVl);
    var txt   = String(safeCell_(row, iTxt) || '').trim();

    if (!u || !eixo) continue;

    var rot = labelCurto_(normFne_(eixo), normVl_(String(vlRaw)));
    if (!rot || rot === '-') rot = txt.length > 50 ? txt.substring(0, 50) : txt;
    if (!rot) continue;

    anosSet[ano] = true;

    if (!rede[eixo])             rede[eixo]          = {};
    rede[eixo][rot]              = (rede[eixo][rot] || 0) + 1;

    if (!porAno[ano])             porAno[ano]          = {};
    if (!porAno[ano][eixo])       porAno[ano][eixo]    = {};
    porAno[ano][eixo][rot]        = (porAno[ano][eixo][rot] || 0) + 1;

    if (!porUni[u])               porUni[u]            = {};
    if (!porUni[u][eixo])         porUni[u][eixo]      = {};
    porUni[u][eixo][rot]          = (porUni[u][eixo][rot] || 0) + 1;

    if (!arvore[u])    arvore[u]    = {};
    if (!arvore[u][t]) arvore[u][t] = {};
    if (ra) arvore[u][t][ra] = true;
  }

  var arvoreCount = {};
  Object.keys(arvore).forEach(function(u) {
    arvoreCount[u] = {};
    Object.keys(arvore[u]).forEach(function(t) { arvoreCount[u][t] = Object.keys(arvore[u][t]).length; });
  });

  var resultado = {
    ok: true, anosDisponiveis: Object.keys(anosSet).sort(),
    rede: rede, anos: porAno, unidades: porUni, arvore: arvoreCount,
    generatedAt: new Date().toISOString()
  };

  var json = JSON.stringify(resultado);
  Logger.log('Salvando Diagnostica: ' + Math.round(json.length / 1024) + 'KB');
  props.setProperty(PROP_RESUMO_DIAG, json);
  props.setProperty(PROP_LASTROW_PREFIX + 'Alunos', String(lastRow));
  cachePut_('diag_v5_resumo', resultado, 21600);

  return { linhas: Object.keys(rede).length };
}

// =======================================================
// LEITURA RÁPIDA DO PAYLOAD PRINCIPAL
// =======================================================
function getResumoBimestre_(key) {
  var fromCache = cacheGet_('bim_v5_' + key);
  if (fromCache) return fromCache;

  var props   = PropertiesService.getScriptProperties();
  var json    = props.getProperty(PROP_RESUMO_BIM_PREFIX + key);

  if (json) {
    try {
      var parsed = JSON.parse(json);
      if (parsed && parsed.ok) {
        var ss        = SpreadsheetApp.getActiveSpreadsheet();
        var sheetName = AVALIACAO_SHEETS[key] || key;
        var sh        = ss.getSheetByName(sheetName);
        var lastRow   = sh ? sh.getLastRow() : 0;
        var salvo     = props.getProperty(PROP_LASTROW_PREFIX + sheetName) || '0';

        if (String(lastRow) === salvo) {
          cachePut_('bim_v5_' + key, parsed, 21600);
          return parsed;
        }
        Logger.log(key + ': dados novos detectados, recalculando...');
      }
    } catch(e) {}
  }

  var bimMap = { primeiroBimestre:'1', segundoBimestre:'2', terceiroBimestre:'3', quartoBimestre:'4' };
  _calcularEPersistirBimestre_(key, bimMap[key] || '1', true);
  return cacheGet_('bim_v5_' + key);
}

// =======================================================
// LEITURA RÁPIDA DE TURMA — sem nova leitura de aba bruta
// =======================================================
function getResumoBimestreTurma_(key, unidade, turma) {
  // Chave de cache rápido (6h)
  var cacheKey  = 'bim_turma_v5_' + key + '_' + unidade + '_' + turma;
  var fromCache = cacheGet_(cacheKey);
  if (fromCache) return fromCache;

  // Busca no PropertiesService
  var props     = PropertiesService.getScriptProperties();
  var mapaJson  = props.getProperty(PROP_TURMA_BIM_PREFIX + key + '_MAPA');

  if (mapaJson) {
    try {
      var mapa    = JSON.parse(mapaJson);
      var chaveU  = mapa[unidade];

      if (chaveU) {
        var jsonU = props.getProperty(chaveU);
        if (jsonU) {
          var dadosU = JSON.parse(jsonU);
          var dadosT = dadosU[turma] || null;

          if (dadosT) {
            var result = { ok: true, resumo: dadosT, disciplinas: Object.keys(dadosT).sort() };
            cachePut_(cacheKey, result, 21600);
            return result;
          }
        }
      }
    } catch(e) {}
  }

  // Se não encontrou, retorna null (Backend_Bimestre vai ler aba bruta como fallback)
  return null;
}

// =======================================================
// LEITURA RÁPIDA DIAGNÓSTICA
// =======================================================
function getResumoDiagnostica_() {
  var fromCache = cacheGet_('diag_v5_resumo');
  if (fromCache) return fromCache;

  var props = PropertiesService.getScriptProperties();
  var json  = props.getProperty(PROP_RESUMO_DIAG);

  if (json) {
    try {
      var parsed = JSON.parse(json);
      if (parsed && parsed.ok) {
        var ss      = SpreadsheetApp.getActiveSpreadsheet();
        var sh      = ss.getSheetByName('Alunos');
        var lastRow = sh ? sh.getLastRow() : 0;
        var salvo   = props.getProperty(PROP_LASTROW_PREFIX + 'Alunos') || '0';

        if (String(lastRow) === salvo) {
          cachePut_('diag_v5_resumo', parsed, 21600);
          return parsed;
        }
        Logger.log('Diagnostica: dados novos detectados, recalculando...');
      }
    } catch(e) {}
  }

  _calcularEPersistirDiagnostica_(true);
  return cacheGet_('diag_v5_resumo');
}