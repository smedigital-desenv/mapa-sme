/**
 * =====================================================================
 * Backend_Dashboard.gs — Dashboard rápido de Turmas
 * =====================================================================
 * - getDashboardLeve(): carrega PPA/PRA e resumos de TODAS as disciplinas.
 * - getDashboardAlunos(): carrega Diagnóstica em background.
 * - getDetalhesTurmasDisciplina(): detalhes sob demanda para não pesar a tela.
 * =====================================================================
 */

function getDashboardData() {
  var leve = getDashboardLeve();
  leve.alunos = getDashboardAlunos();
  return leve;
}

function _idxDisciplinaTurmas_(headers) {
  var idxDisc = idx_(headers, [
    'Descrição da Disciplina-Atribuição',
    'DESCRIÇÃO DA DISCIPLINA-ATRIBUIÇÃO',
    'GPRV07_DES_DIS_ATR',
    'DISCIPLINA'
  ]);

  // Coluna P = índice 15. Fallback solicitado pelo usuário.
  if (idxDisc < 0 && headers.length > 15) idxDisc = 15;
  return idxDisc;
}

function _periodoDescTurmas_(valor) {
  var period = String(valor || '').trim().toUpperCase();
  if (period === 'M') return 'Manhã';
  if (period === 'T') return 'Tarde';
  if (period === 'N') return 'Noite';
  return period || '-';
}

function _disciplinaLabelTurmas_(valor) {
  return String(valor || '').trim().toUpperCase();
}

function _statusAtribuidoTurmas_(status) {
  var s = String(status || '').toUpperCase();
  return s.indexOf('2 -') !== -1 || s.indexOf('4 -') !== -1;
}

function _isSubstitutoTurmas_(status) {
  return String(status || '').toUpperCase().indexOf('4 -') !== -1;
}

function _makeDetailTurmas_(row, idx, isAtribuido, isSubst, disc, workload, anoDesc, letraTurma) {
  return {
    profName: isAtribuido ? (isSubst ? safeCell_(row, idx.profSub) : safeCell_(row, idx.profProp)) : 'S/ ATRIBUIÇÃO',
    profCode: isAtribuido ? (isSubst ? safeCell_(row, idx.codProfSub) : safeCell_(row, idx.codProfProp)) : '-',
    profStatus: isAtribuido ? (isSubst ? safeCell_(row, idx.sitProfSub) : safeCell_(row, idx.sitProfProp)) : '-',
    turma: (anoDesc + ' ' + letraTurma).trim(),
    disc: disc,
    workload: workload
  };
}

function getDashboardLeve() {
  // Caminho rápido: lê o snapshot persistente da tela Turmas.
  // Isso evita varrer a aba Turmas a cada abertura do painel.
  var snap = _lerSnapshotDashboardTurmas_();
  if (snap && snap.ok && snap.data) return snap.data;

  // Fallback: monta pela aba Turmas e já grava o snapshot para os próximos acessos.
  var result = _montarDashboardLeveDaAbaTurmas_();
  try { _salvarSnapshotDashboardTurmas_(result); } catch (e) { Logger.log('Falha ao salvar snapshot Turmas: ' + e); }
  return result;
}

function atualizarResumoTurmasDashboard() {
  var result = _montarDashboardLeveDaAbaTurmas_();
  _salvarSnapshotDashboardTurmas_(result);
  return {
    ok: true,
    ppa: (result.ppa || []).length,
    pra: (result.pra || []).length,
    disciplinas: (result.disciplinasLista || []).length,
    atualizadoEm: new Date().toISOString()
  };
}

function invalidarResumoTurmasDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('_Resumo_Turmas_Dashboard');
  if (sh) sh.clear();
  return 'Resumo de Turmas invalidado.';
}

function _lerSnapshotDashboardTurmas_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('_Resumo_Turmas_Dashboard');
    if (!sh || sh.getLastRow() < 2) return null;

    var status = String(sh.getRange(1, 1).getValue() || '').trim();
    if (status !== 'OK') return null;

    var lastRow = sh.getLastRow();
    var values = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    var json = values.map(function(r) { return String(r[0] || ''); }).join('');
    if (!json) return null;

    var data = JSON.parse(json);
    return { ok: true, data: data };
  } catch (e) {
    Logger.log('Erro lendo snapshot Turmas: ' + e);
    return null;
  }
}

function _salvarSnapshotDashboardTurmas_(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('_Resumo_Turmas_Dashboard') || ss.insertSheet('_Resumo_Turmas_Dashboard');
  sh.clear();

  var json = JSON.stringify(data || {});
  var chunkSize = 45000; // limite seguro por célula
  var rows = [];
  for (var i = 0; i < json.length; i += chunkSize) {
    rows.push([json.substring(i, i + chunkSize)]);
  }

  sh.getRange(1, 1, 1, 4).setValues([['OK', 'ATUALIZADO_EM', new Date(), 'CHUNKS']]);
  if (rows.length) sh.getRange(2, 1, rows.length, 1).setValues(rows);
  sh.hideSheet();
}

function _montarDashboardLeveDaAbaTurmas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetTurmas = ss.getSheetByName('Turmas');
  var sheetMapa = ss.getSheetByName('Base_MAPA');

  var lastTurmas = sheetTurmas ? sheetTurmas.getLastRow() : 0;
  var lastMapa = sheetMapa ? sheetMapa.getLastRow() : 0;
  var cacheKey = ['dash_leve_v8_all_disc', lastTurmas, lastMapa].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var ppaSummary = {};
  var praSummary = {};
  var disciplinasTurmas = {};

  if (sheetTurmas && lastTurmas > 1) {
    var data = sheetTurmas.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });

    var idxUnit = idx_(headers, ['Descrição da Unidade Atribuída', 'GPRV07_NOM_UNI_ATR', 'UNIDADE']);
    var idxDisc = _idxDisciplinaTurmas_(headers);
    var idxWork = idx_(headers, ['Carga Horária', 'GPRV07_CARGA_HOR', 'CARGA HORÁRIA']);
    var idxPeriod = idx_(headers, ['Período', 'GPRV07_COD_PERIODO']);

    var idx = {
      status: 1,
      profProp: headers.indexOf('Nome do Professor - proprietário'),
      profSub: headers.indexOf('Nome do Professor - Substituto'),
      codProfProp: headers.indexOf('Código do Professor - proprietário'),
      codProfSub: headers.indexOf('Código do Professor - Substituto'),
      sitProfProp: headers.indexOf('Descrição da Situação do Professor - proprietário'),
      sitProfSub: headers.indexOf('Descrição da Situação do Professor - Substituto')
    };

    var idxTurma = headers.indexOf('Letra da Turma');
    var idxAno = headers.indexOf('Descrição do Ano Escolar');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var unitRaw = String(safeCell_(row, idxUnit) || '');
      if (!unitRaw || unitRaw === 'undefined') continue;

      var unit = cleanUnit_(unitRaw);
      var disc = _disciplinaLabelTurmas_(safeCell_(row, idxDisc));
      if (!disc) continue;

      var workload = parseFloat(safeCell_(row, idxWork)) || 0;
      var pDesc = _periodoDescTurmas_(safeCell_(row, idxPeriod));
      var statusAtrib = String(safeCell_(row, idx.status) || '').toUpperCase();
      var isAtribuido = _statusAtribuidoTurmas_(statusAtrib) || statusAtrib.indexOf('TROCA') !== -1;  // ← Adiciona reconhecimento de TROCA aqui
      var isSubst = _isSubstitutoTurmas_(statusAtrib);
      var anoDesc = String(safeCell_(row, idxAno) || '').toUpperCase();
      var letraTurma = String(safeCell_(row, idxTurma) || '').toUpperCase();
      var detailObj = _makeDetailTurmas_(row, idx, isAtribuido, isSubst, disc, workload, anoDesc, letraTurma);
      var key = unit.toUpperCase() + '|' + pDesc.toUpperCase();

      // Resumo genérico de TODAS as disciplinas — detalhes carregados sob demanda.
      if (!disciplinasTurmas[disc]) disciplinasTurmas[disc] = {};
      if (!disciplinasTurmas[disc][key]) {
        disciplinasTurmas[disc][key] = {
          unit: unit,
          period: pDesc,
          disciplina: disc,
          criadas: 0,
          atribuidas: 0,
          cargaCriada: 0,
          cargaAtribuida: 0,
          detailsCount: 0,
          lazyDetails: true,
          details: []
        };
      }
      disciplinasTurmas[disc][key].criadas++;
      disciplinasTurmas[disc][key].cargaCriada += workload;
      disciplinasTurmas[disc][key].detailsCount++;
      if (isAtribuido) {
        disciplinasTurmas[disc][key].atribuidas++;
        disciplinasTurmas[disc][key].cargaAtribuida += workload;
      }

      // PPA — mantém regra especial e detalhes necessários para atribuição.
      if (((anoDesc.indexOf('2º ANO') !== -1 || anoDesc.indexOf('2O ANO') !== -1 || anoDesc.indexOf('2 ANO') !== -1) && disc.indexOf('MAGISTERIO II') !== -1) ||
          disc.indexOf('PROJ. PROF. ALFABETIZADOR') !== -1 ||
          anoDesc.indexOf('PROJETO PROFESSOR ALFABETIZADOR') !== -1) {
        if (!ppaSummary[key]) ppaSummary[key] = { unit: unit, period: pDesc, magisterio: 0, cargaAtribuida: 0, details: [] };
        if (disc.indexOf('MAGISTERIO II') !== -1) ppaSummary[key].magisterio++;
        if (isAtribuido && (disc.indexOf('ALFABETIZADOR') !== -1 || disc.indexOf('PPA') !== -1)) ppaSummary[key].cargaAtribuida += workload;
        ppaSummary[key].details.push(detailObj);
      }

      // PRA — mantém atalho antigo.
      if (disc.indexOf('PROJ. RECUP. APREND. ANOS INIC') !== -1) {
        if (!praSummary[key]) praSummary[key] = { unit: unit, period: pDesc, criadas: 0, atribuidas: 0, details: [] };
        praSummary[key].criadas++;
        if (isAtribuido) praSummary[key].atribuidas++;
        praSummary[key].details.push(detailObj);
      }
    }
  }

  if (sheetMapa && lastMapa > 1) {
    var mapaData = sheetMapa.getDataRange().getValues();
    for (var m = 1; m < mapaData.length; m++) {
      var mUnit = String(safeCell_(mapaData[m], 0)).trim();
      var mPeriod = String(safeCell_(mapaData[m], 1)).trim().toUpperCase();
      var mTurma = String(safeCell_(mapaData[m], 3)).trim().toUpperCase();
      var mCarga = parseFloat(String(safeCell_(mapaData[m], 4)).replace(/[^\d.-]/g, '')) || 0;
      var keyMapa = mUnit.toUpperCase() + '|' + mPeriod;

      if (ppaSummary[keyMapa]) {
        // Extrair só a letra de Base_MAPA (ex: "PROJ. PROF. ALFABETIZADOR D" → "D")
        var mTurmaLetra = mTurma.split(' ').pop() || mTurma;
        
        // Encontrar a ÚLTIMA LETRA criada em Turmas para esta unidade+período
        var ultimaLetraEmTurmas = '';
        if (ppaSummary[keyMapa].details && Array.isArray(ppaSummary[keyMapa].details)) {
          for (var d = 0; d < ppaSummary[keyMapa].details.length; d++) {
            var detalhe = ppaSummary[keyMapa].details[d];
            var detalheLetra = String(detalhe.turma || '').split(' ').pop() || detalhe.turma;
            if (detalheLetra && detalheLetra.length === 1) {
              // Comparar letras: se a nova é maior alfabeticamente, atualiza
              if (detalheLetra > ultimaLetraEmTurmas) {
                ultimaLetraEmTurmas = detalheLetra;
              }
            }
          }
        }

        // SÓ ADICIONAR DE BASE_MAPA SE A LETRA FOR DEPOIS DA ÚLTIMA LETRA EM TURMAS
        // Exemplo: se Turmas tem até I, só aceita J, K, L, etc.
        if (!ultimaLetraEmTurmas || mTurmaLetra > ultimaLetraEmTurmas) {
          ppaSummary[keyMapa].cargaAtribuida += mCarga;
          ppaSummary[keyMapa].details.push({
            profName: 'ATRIBUÍDO VIA MAPA',
            profCode: String(safeCell_(mapaData[m], 2)).trim(),
            profStatus: 'SISTEMA',
            turma: mTurma,
            disc: 'PROJ. PROF. ALFABETIZADOR',
            workload: mCarga
          });
        }
      }
    }
  }

  var ppaRows = Object.keys(ppaSummary).map(function(k) { return ppaSummary[k]; })
    .filter(function(r) { return r.magisterio > 0; })
    .map(function(r) {
      r.meta = r.magisterio * 12;
      r.percAtribuido = r.meta > 0 ? Math.min((r.cargaAtribuida / r.meta) * 100, 100) : 0;
      r.faltaAtribuir = Math.max(0, r.meta - r.cargaAtribuida);
      return r;
    })
    .sort(function(a, b) { return a.unit.localeCompare(b.unit); });

  var praRows = Object.keys(praSummary).map(function(k) { return praSummary[k]; })
    .filter(function(r) { return r.criadas > 0; })
    .sort(function(a, b) { return a.unit.localeCompare(b.unit); });

  var disciplinasObjetoFinal = {};
  Object.keys(disciplinasTurmas).sort().forEach(function(disc) {
    disciplinasObjetoFinal[disc] = Object.keys(disciplinasTurmas[disc]).map(function(k) { return disciplinasTurmas[disc][k]; })
      .filter(function(r) { return r.criadas > 0; })
      .sort(function(a, b) { return a.unit.localeCompare(b.unit) || a.period.localeCompare(b.period); });
  });

  var result = {
    ppa: ppaRows,
    pra: praRows,
    disciplinasLista: Object.keys(disciplinasObjetoFinal).sort(),
    disciplinasTurmas: disciplinasObjetoFinal,
    alunos: [],
    avaliacoesConfig: [
      { key: 'primeiroBimestre', label: '1º Bimestre', sheet: 'Primeiro_Bimestre' },
      { key: 'segundoBimestre', label: '2º Bimestre', sheet: 'Segundo_Bimestre' },
      { key: 'terceiroBimestre', label: '3º Bimestre', sheet: 'Terceiro_Bimestre' },
      { key: 'quartoBimestre', label: '4º Bimestre', sheet: 'Quarto_Bimestre' }
    ]
  };

  cachePut_(cacheKey, result, 21600);
  return result;
}

function getDetalhesTurmasDisciplina(disciplina, unidade, periodo) {
  disciplina = _disciplinaLabelTurmas_(disciplina);
  unidade = cleanUnit_(unidade);
  periodo = String(periodo || '').trim();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetTurmas = ss.getSheetByName('Turmas');
  if (!sheetTurmas || sheetTurmas.getLastRow() < 2) return { ok: true, details: [] };

  var lastRow = sheetTurmas.getLastRow();
  var cacheKey = ['det_turma_disc_v3', lastRow, disciplina, unidade, periodo].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var data = sheetTurmas.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });

  var idxUnit = idx_(headers, ['Descrição da Unidade Atribuída', 'GPRV07_NOM_UNI_ATR', 'UNIDADE']);
  var idxDisc = _idxDisciplinaTurmas_(headers);
  var idxWork = idx_(headers, ['Carga Horária', 'GPRV07_CARGA_HOR', 'CARGA HORÁRIA']);
  var idxPeriod = idx_(headers, ['Período', 'GPRV07_COD_PERIODO']);
  var idxTurma = headers.indexOf('Letra da Turma');
  var idxAno = headers.indexOf('Descrição do Ano Escolar');

  var idx = {
    status: 1,
    profProp: headers.indexOf('Nome do Professor - proprietário'),
    profSub: headers.indexOf('Nome do Professor - Substituto'),
    codProfProp: headers.indexOf('Código do Professor - proprietário'),
    codProfSub: headers.indexOf('Código do Professor - Substituto'),
    sitProfProp: headers.indexOf('Descrição da Situação do Professor - proprietário'),
    sitProfSub: headers.indexOf('Descrição da Situação do Professor - Substituto')
  };

  var details = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var unit = cleanUnit_(safeCell_(row, idxUnit));
    var disc = _disciplinaLabelTurmas_(safeCell_(row, idxDisc));
    var pDesc = _periodoDescTurmas_(safeCell_(row, idxPeriod));

    if (unit !== unidade || disc !== disciplina || pDesc !== periodo) continue;

    var statusAtrib = String(safeCell_(row, idx.status) || '').toUpperCase();
    var isAtribuido = _statusAtribuidoTurmas_(statusAtrib);
    var isSubst = _isSubstitutoTurmas_(statusAtrib);
    var workload = parseFloat(safeCell_(row, idxWork)) || 0;
    var anoDesc = String(safeCell_(row, idxAno) || '').toUpperCase();
    var letraTurma = String(safeCell_(row, idxTurma) || '').toUpperCase();

    details.push(_makeDetailTurmas_(row, idx, isAtribuido, isSubst, disc, workload, anoDesc, letraTurma));
  }

  var result = { ok: true, details: details };
  cachePut_(cacheKey, result, 21600);
  return result;
}

function getDashboardAlunos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetAlunos = ss.getSheetByName('Alunos');
  if (!sheetAlunos || sheetAlunos.getLastRow() < 2) return [];

  var alData = sheetAlunos.getDataRange().getValues();
  var hAl = alData[0].map(function(h) { return String(h).trim().toUpperCase(); });

  var idxUnidade = hAl.indexOf('UNIDADE');
  var idxAnoAlunos = hAl.indexOf('ANO ESCOLAR');
  var idxTurmaAlunos = hAl.indexOf('TURMA');
  var idxFne = hAl.indexOf('DESCRIÇÃO FNE');
  if (idxFne === -1) idxFne = hAl.indexOf('DESCRICAO FNE');
  var idxVl = hAl.indexOf('VL. RESPOSTA');
  if (idxVl === -1) idxVl = hAl.indexOf('VL RESPOSTA');
  var idxRa = hAl.indexOf('REMA - ALUNO');
  var idxNome = hAl.indexOf('NOME DO ALUNO');

  var alunosDict = {};

  for (var k = 1; k < alData.length; k++) {
    var ra = String(safeCell_(alData[k], idxRa) || '').trim();
    var nome = String(safeCell_(alData[k], idxNome) || '').trim();
    if (!ra && !nome) continue;

    var unidade = cleanUnit_(safeCell_(alData[k], idxUnidade));
    var ano = String(safeCell_(alData[k], idxAnoAlunos)).trim().toUpperCase();
    var turma = String(safeCell_(alData[k], idxTurmaAlunos)).trim().toUpperCase();
    var key = (ra || nome) + '|' + unidade + '|' + ano + '|' + turma;

    if (!alunosDict[key]) alunosDict[key] = { u: unidade, a: ano, t: turma, n: nome, e: 'Não Avaliado', l: 'Não Avaliado', p: 'Não Avaliado' };

    var fne = String(safeCell_(alData[k], idxFne) || '').toUpperCase();
    var vl = safeCell_(alData[k], idxVl);

    if (fne.indexOf('ESCRITA') !== -1) alunosDict[key].e = labelCurto_('ESCRITA', vl);
    else if (fne.indexOf('LEITURA') !== -1) alunosDict[key].l = labelCurto_('LEITURA', vl);
    else if (fne.indexOf('PRODUÇÃO') !== -1 || fne.indexOf('PRODUCAO') !== -1) alunosDict[key].p = labelCurto_('PRODUCAO TEXTUAL', vl);
  }

  return Object.keys(alunosDict).map(function(k) { return alunosDict[k]; });
}