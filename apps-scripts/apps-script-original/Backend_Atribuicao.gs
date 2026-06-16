/**
 * =====================================================================
 * Backend_Atribuicao.gs
 * Atribuições PPA: criar novas turmas ou atribuir turmas existentes
 * =====================================================================
 */

function _normalizarPeriodoAtribuicao_(periodo) {
  var p = String(periodo || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (p === 'M' || p.indexOf('MANHA') !== -1) return 'MANHÃ';
  if (p === 'T' || p.indexOf('TARDE') !== -1) return 'TARDE';
  if (p === 'N' || p.indexOf('NOITE') !== -1) return 'NOITE';
  if (p === 'I' || p.indexOf('INTEGRAL') !== -1) return 'INTEGRAL';
  return p;
}

function _textoAtribuicao_(value) {
  return String(value || '').trim();
}

function _normAtribuicao_(value) {
  return String(value || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function _cleanUnitAtribuicao_(value) {
  return String(value || '').trim().split(',')[0].trim();
}

function _idxHeaderAtribuicao_(headers, nomes) {
  var normHeaders = headers.map(function(h) { return _normAtribuicao_(h); });
  for (var i = 0; i < nomes.length; i++) {
    var pos = normHeaders.indexOf(_normAtribuicao_(nomes[i]));
    if (pos !== -1) return pos;
  }
  return -1;
}

function _garantirCabecalhoBaseMapa_(sheetMapa) {
  var headers = [
    'Unidade', 'Período', 'Código Funcional',
    'Turma Atribuída', 'Carga Horária', 'Autor', 'Data',
    'Tipo', 'Disciplina', 'Origem'
  ];

  if (sheetMapa.getLastRow() === 0) {
    sheetMapa.appendRow(headers);
    sheetMapa.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#002b5e').setFontColor('white');
    return;
  }

  var lastCol = sheetMapa.getLastColumn();
  var atuais = sheetMapa.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });

  var precisaAtualizar = false;
  headers.forEach(function(h, idx) {
    if (!atuais[idx]) precisaAtualizar = true;
  });

  if (precisaAtualizar || lastCol < headers.length) {
    sheetMapa.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheetMapa.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#002b5e').setFontColor('white');
  }
}

function _turmasJaAtribuidasBaseMapa_(unidade, periodo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Base_MAPA');
  var mapa = {};

  if (!sh || sh.getLastRow() < 2) return mapa;

  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = values[0];
  var idxUnidade = _idxHeaderAtribuicao_(h, ['Unidade']);
  var idxPeriodo = _idxHeaderAtribuicao_(h, ['Período']);
  var idxTurma = _idxHeaderAtribuicao_(h, ['Turma Atribuída']);
  var idxDisc = _idxHeaderAtribuicao_(h, ['Disciplina']);

  var uFiltro = _normAtribuicao_(_cleanUnitAtribuicao_(unidade));
  var pFiltro = _normalizarPeriodoAtribuicao_(periodo);

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var u = _normAtribuicao_(_cleanUnitAtribuicao_(row[idxUnidade]));
    var p = _normalizarPeriodoAtribuicao_(row[idxPeriodo]);
    var turma = _normAtribuicao_(row[idxTurma]);
    var disc = idxDisc >= 0 ? _normAtribuicao_(row[idxDisc]) : '';

    if (u === uFiltro && p === pFiltro && turma && (!disc || disc.indexOf('ALFABETIZADOR') !== -1)) {
      mapa[turma] = true;
    }
  }

  return mapa;
}

function salvarNovaAtribuicaoPPA(unidade, periodo, codigoFuncional, turmasNomesArray, cargaPorTurma) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetMapa = ss.getSheetByName('Base_MAPA') || ss.insertSheet('Base_MAPA');
  _garantirCabecalhoBaseMapa_(sheetMapa);

  var autor = Session.getActiveUser().getEmail();
  var dataAtual = new Date();
  var turmas = turmasNomesArray || [];

  if (!String(codigoFuncional || '').trim()) throw new Error('Código funcional não informado.');
  if (!turmas.length) throw new Error('Nenhuma turma informada.');

  var linhas = turmas.map(function(turma) {
    return [
      unidade,
      periodo,
      codigoFuncional,
      turma,
      cargaPorTurma + 'h',
      autor,
      dataAtual,
      'CRIAR_NOVA',
      'PROJ. PROF. ALFABETIZADOR',
      'Base_MAPA'
    ];
  });

  sheetMapa.getRange(sheetMapa.getLastRow() + 1, 1, linhas.length, linhas[0].length).setValues(linhas);

  return {
    ok: true,
    message: 'Novas turmas PPA salvas com sucesso.',
    qtd: linhas.length
  };
}

function listarTurmasPPASemProfessor(unidade, periodo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Turmas');

  if (!sh || sh.getLastRow() < 2) {
    return { ok: false, turmas: [], message: 'Aba Turmas não encontrada ou vazia.' };
  }

  var data = sh.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h || '').trim(); });

  var idxUnidade = _idxHeaderAtribuicao_(headers, ['Descrição da Unidade Atribuída', 'GPRV07_NOM_UNI_ATR', 'UNIDADE']);
  var idxDisciplina = _idxHeaderAtribuicao_(headers, ['Descrição da Disciplina-Atribuição', 'GPRV07_DES_DIS_ATR', 'DISCIPLINA']);
  var idxPeriodo = _idxHeaderAtribuicao_(headers, ['Período', 'GPRV07_COD_PERIODO']);
  var idxAno = _idxHeaderAtribuicao_(headers, ['Descrição do Ano Escolar', 'ANO ESCOLAR', 'ANO']);
  var idxTurma = _idxHeaderAtribuicao_(headers, ['Letra da Turma', 'TURMA']);
  var idxStatus = 1;
  var idxCarga = _idxHeaderAtribuicao_(headers, ['Carga Horária', 'GPRV07_CARGA_HOR']);

  var idxProfProp = _idxHeaderAtribuicao_(headers, ['Nome do Professor - proprietário', 'Nome do Professor - Proprietário']);
  var idxProfSub = _idxHeaderAtribuicao_(headers, ['Nome do Professor - Substituto']);
  var idxCodProfProp = _idxHeaderAtribuicao_(headers, ['Código do Professor - proprietário', 'Código do Professor - Proprietário']);
  var idxCodProfSub = _idxHeaderAtribuicao_(headers, ['Código do Professor - Substituto']);

  if (idxUnidade < 0 || idxDisciplina < 0 || idxPeriodo < 0 || idxAno < 0 || idxTurma < 0) {
    throw new Error('Não encontrei as colunas necessárias na aba Turmas para listar PPA sem professor.');
  }

  var unidadeFiltro = _normAtribuicao_(_cleanUnitAtribuicao_(unidade));
  var periodoFiltro = _normalizarPeriodoAtribuicao_(periodo);
  var jaAtribuidas = _turmasJaAtribuidasBaseMapa_(unidade, periodo);

  var turmas = [];
  var vistos = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    var unidadeRow = _cleanUnitAtribuicao_(row[idxUnidade]);
    var unidadeNorm = _normAtribuicao_(unidadeRow);
    var disciplina = _normAtribuicao_(row[idxDisciplina]);
    var periodoRow = _normalizarPeriodoAtribuicao_(row[idxPeriodo]);
    var periodoOriginal = String(row[idxPeriodo] || '').trim();
    var ano = String(row[idxAno] || '').trim();
    var letra = String(row[idxTurma] || '').trim();
    var status = String(row[idxStatus] || '').trim();

    if (disciplina.indexOf('PROJ') === -1 || disciplina.indexOf('ALFABETIZADOR') === -1) continue;
    if (unidadeFiltro && unidadeNorm !== unidadeFiltro) continue;
    if (periodoFiltro && periodoRow !== periodoFiltro) continue;

    var nomeProfProp = idxProfProp >= 0 ? String(row[idxProfProp] || '').trim() : '';
    var nomeProfSub = idxProfSub >= 0 ? String(row[idxProfSub] || '').trim() : '';
    var codProfProp = idxCodProfProp >= 0 ? String(row[idxCodProfProp] || '').trim() : '';
    var codProfSub = idxCodProfSub >= 0 ? String(row[idxCodProfSub] || '').trim() : '';
    var statusNorm = _normAtribuicao_(status);

    var temProfessor = !!(nomeProfProp || nomeProfSub || codProfProp || codProfSub ||
      statusNorm.indexOf('2 -') !== -1 || statusNorm.indexOf('4 -') !== -1 ||
      statusNorm.indexOf('ATRIBUID') !== -1);

    if (temProfessor) continue;

    var turmaNome = (ano + ' ' + letra).trim();
    var turmaKey = _normAtribuicao_(turmaNome || letra);

    if (!turmaKey || vistos[turmaKey] || jaAtribuidas[turmaKey]) continue;
    vistos[turmaKey] = true;

    turmas.push({
      rowNumber: i + 1,
      unidade: unidadeRow,
      periodo: periodoOriginal || periodo,
      periodoNormalizado: periodoRow,
      ano: ano,
      turma: letra,
      turmaNome: turmaNome,
      disciplina: 'PROJ. PROF. ALFABETIZADOR',
      carga: idxCarga >= 0 ? (Number(row[idxCarga]) || 0) : 0,
      status: status || 'Sem professor'
    });
  }

  turmas.sort(function(a, b) {
    return String(a.ano).localeCompare(String(b.ano)) || String(a.turma).localeCompare(String(b.turma));
  });

  return { ok: true, turmas: turmas };
}

function salvarAtribuicaoTurmaPPAExistente(payload) {
  payload = payload || {};

  var unidade = String(payload.unidade || '').trim();
  var periodo = String(payload.periodo || '').trim();
  var codigoFuncional = String(payload.codigoFuncional || '').trim();
  var turmas = payload.turmas || [];
  var cargaPorTurma = Number(payload.cargaPorTurma || 0);

  if (!unidade) throw new Error('Unidade não informada.');
  if (!periodo) throw new Error('Período não informado.');
  if (!codigoFuncional) throw new Error('Código funcional não informado.');
  if (!turmas.length) throw new Error('Nenhuma turma selecionada.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetMapa = ss.getSheetByName('Base_MAPA') || ss.insertSheet('Base_MAPA');
  _garantirCabecalhoBaseMapa_(sheetMapa);

  var autor = Session.getActiveUser().getEmail();
  var dataAtual = new Date();

  var linhas = turmas.map(function(turma) {
    return [
      unidade,
      periodo,
      codigoFuncional,
      turma.turmaNome || turma.turma || '',
      (cargaPorTurma || turma.carga || '') + 'h',
      autor,
      dataAtual,
      'ATRIBUIR_EXISTENTE',
      'PROJ. PROF. ALFABETIZADOR',
      'Turmas'
    ];
  });

  sheetMapa.getRange(sheetMapa.getLastRow() + 1, 1, linhas.length, linhas[0].length).setValues(linhas);

  return {
    ok: true,
    message: 'Turma(s) PPA existente(s) atribuída(s) com sucesso.',
    qtd: linhas.length
  };
}

function limparCacheAvaliacoes() {
  try { CacheService.getScriptCache().removeAll(['dummy']); } catch(e) {}
  return 'Cache renovado. As chaves versionadas serão recarregadas no próximo acesso.';
}

function getAvaliacaoBimestre(key) { return getAvaliacaoBimestreRapida(key, {}); }
function getBimestre1Data() { return getAvaliacaoBimestreRapida('primeiroBimestre', {}); }
function getTotalAvaliacoesData() { return getTotalAvaliacoesRapido({}); }
