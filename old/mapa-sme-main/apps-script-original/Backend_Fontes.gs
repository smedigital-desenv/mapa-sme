/**
 * =====================================================================
 * Backend_Fontes.gs — Fontes externas + geração incremental de resumos
 * Versão v3
 * =====================================================================
 * Corrige o caso em que só a aba Detalhe_Alunos era criada:
 * - Cria imediatamente as abas de resumo com cabeçalho.
 * - Processa a base em partes, respeitando o limite de execução do Apps Script.
 * - Salva progresso e agenda continuação automática por gatilho temporizado.
 * - O painel só usa os resumos quando Meta_Atualizacao estiver STATUS=CONCLUIDO.
 * =====================================================================
 */

var CONFIG_FONTES_SHEET = 'CONFIG_FONTES';
var MAPA_RESUMO_JOB_PREFIX = 'MAPA_RESUMO_JOB_';
var MAPA_RESUMO_QUEUE_KEY = 'MAPA_RESUMO_QUEUE';
var MAPA_RESUMO_TRIGGER_FN = 'continuarGeracaoResumosFontes';
var MAPA_AUX_HIER_ALUNOS = '_Resumo_Hierarquia_Alunos_Aux';

var FONTE_DEFAULTS = {
  ABA_DADOS: 'Dados_Completos',
  ABA_RESUMO_REDE: 'Resumo_Rede',
  ABA_RESUMO_FILTROS: 'Resumo_Filtros',
  ABA_RESUMO_HIERARQUIA: 'Resumo_Hierarquia',
  ABA_RESUMO_PERGUNTAS: 'Resumo_Perguntas',
  ABA_DETALHE_ALUNOS: 'Detalhe_Alunos',
  ABA_META: 'Meta_Atualizacao'
};

var FONTE_HEADERS = [
  'AVALIACAO',
  'SPREADSHEET_ID',
  'ABA_DADOS',
  'ABA_RESUMO_REDE',
  'ABA_RESUMO_FILTROS',
  'ABA_RESUMO_HIERARQUIA',
  'ABA_RESUMO_PERGUNTAS',
  'ABA_DETALHE_ALUNOS',
  'ATIVO'
];

function setupConfigFontesModelo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG_FONTES_SHEET) || ss.insertSheet(CONFIG_FONTES_SHEET);

  sh.clear();
  sh.getRange(1, 1, 1, FONTE_HEADERS.length).setValues([FONTE_HEADERS]);
  sh.getRange(1, 1, 1, FONTE_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#002b5e')
    .setFontColor('#ffffff');

  var linhas = [
    ['primeiroBimestre', '', 'Primeiro_Bimestre', 'Resumo_Rede', 'Resumo_Filtros', 'Resumo_Hierarquia', 'Resumo_Perguntas', 'Detalhe_Alunos', 'SIM'],
    ['segundoBimestre',  '', 'Segundo_Bimestre',  'Resumo_Rede', 'Resumo_Filtros', 'Resumo_Hierarquia', 'Resumo_Perguntas', 'Detalhe_Alunos', 'SIM'],
    ['terceiroBimestre', '', 'Terceiro_Bimestre', 'Resumo_Rede', 'Resumo_Filtros', 'Resumo_Hierarquia', 'Resumo_Perguntas', 'Detalhe_Alunos', 'SIM'],
    ['quartoBimestre',   '', 'Quarto_Bimestre',   'Resumo_Rede', 'Resumo_Filtros', 'Resumo_Hierarquia', 'Resumo_Perguntas', 'Detalhe_Alunos', 'SIM']
  ];

  sh.getRange(2, 1, linhas.length, FONTE_HEADERS.length).setValues(linhas);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, FONTE_HEADERS.length);

  sh.getRange('A10').setValue('INSTRUÇÕES').setFontWeight('bold').setFontColor('#002b5e');
  sh.getRange('A11').setValue('1. Cole o ID da planilha de cada bimestre na coluna SPREADSHEET_ID.');
  sh.getRange('A12').setValue('2. A ABA_DADOS deve apontar para a base completa do bimestre.');
  sh.getRange('A13').setValue('3. Execute reiniciarGeracaoResumosDaFonte("primeiroBimestre") para criar/atualizar.');
  sh.getRange('A14').setValue('4. O painel usará automaticamente as abas Resumo_* quando Meta_Atualizacao estiver CONCLUIDO.');

  return 'Aba CONFIG_FONTES criada. Preencha os IDs e execute reiniciarGeracaoResumosDaFonte("primeiroBimestre").';
}

function getFontesMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG_FONTES_SHEET);
  var map = {};

  if (!sh || sh.getLastRow() < 2) return map;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];

  var iAvaliacao = idx_(h, ['AVALIACAO', 'AVALIAÇÃO']);
  var iId = idx_(h, ['SPREADSHEET_ID', 'ID', 'ID_PLANILHA']);
  var iDados = idx_(h, ['ABA_DADOS']);
  var iRede = idx_(h, ['ABA_RESUMO_REDE']);
  var iFiltros = idx_(h, ['ABA_RESUMO_FILTROS', 'ABA_RESUMO']);
  var iHier = idx_(h, ['ABA_RESUMO_HIERARQUIA', 'ABA_HIERARQUIA']);
  var iPerg = idx_(h, ['ABA_RESUMO_PERGUNTAS', 'ABA_PERGUNTAS']);
  var iDetalhe = idx_(h, ['ABA_DETALHE_ALUNOS', 'ABA_DETALHE']);
  var iAtivo = idx_(h, ['ATIVO']);

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var key = String(safeCell_(row, iAvaliacao) || '').trim();
    if (!key) continue;

    var ativo = String(safeCell_(row, iAtivo) || 'SIM').trim().toUpperCase();
    var id = String(safeCell_(row, iId) || '').trim();

    if (!id || ativo === 'NÃO' || ativo === 'NAO' || ativo === 'FALSE' || ativo === '0') continue;

    map[key] = {
      key: key,
      spreadsheetId: id,
      abaDados: String(safeCell_(row, iDados) || FONTE_DEFAULTS.ABA_DADOS).trim(),
      abaResumoRede: String(safeCell_(row, iRede) || FONTE_DEFAULTS.ABA_RESUMO_REDE).trim(),
      abaResumoFiltros: String(safeCell_(row, iFiltros) || FONTE_DEFAULTS.ABA_RESUMO_FILTROS).trim(),
      abaResumoHierarquia: String(safeCell_(row, iHier) || FONTE_DEFAULTS.ABA_RESUMO_HIERARQUIA).trim(),
      abaResumoPerguntas: String(safeCell_(row, iPerg) || FONTE_DEFAULTS.ABA_RESUMO_PERGUNTAS).trim(),
      abaDetalheAlunos: String(safeCell_(row, iDetalhe) || FONTE_DEFAULTS.ABA_DETALHE_ALUNOS).trim()
    };
  }

  return map;
}

function getFonteAvaliacao_(key) {
  var map = getFontesMap_();
  return map[key] || null;
}

function openFonteSpreadsheet_(fonte) {
  if (!fonte || !fonte.spreadsheetId) return null;
  return SpreadsheetApp.openById(fonte.spreadsheetId);
}

function getFonteSheet_(fonte, sheetName) {
  var ss = openFonteSpreadsheet_(fonte);
  if (!ss) return null;
  return ss.getSheetByName(sheetName);
}

function fonteTemResumos_(fonte) {
  if (!fonte) return false;

  try {
    var ss = openFonteSpreadsheet_(fonte);
    if (!ss) return false;

    var shFiltros = ss.getSheetByName(fonte.abaResumoFiltros);
    var shHier = ss.getSheetByName(fonte.abaResumoHierarquia);
    if (!shFiltros || !shHier || shFiltros.getLastRow() < 2 || shHier.getLastRow() < 2) return false;

    var meta = _lerMetaResumo_(ss);
    return String(meta.STATUS || '').toUpperCase() === 'CONCLUIDO';
  } catch (e) {
    return false;
  }
}

function criarPlanilhaBimestreModelo(nome) {
  nome = nome || 'MAPA - Bimestre';
  var ss = SpreadsheetApp.create(nome);
  var sh = ss.getActiveSheet();
  sh.setName(FONTE_DEFAULTS.ABA_DADOS);

  var headers = [
    'UNIDADE', 'AVALIAÇÃO', 'ANO ESCOLAR', 'BIMESTRE', 'TURMA',
    'REMA - ALUNO', 'NOME DO ALUNO', 'FNC-DISCIPLINA', 'DESCRIÇÃO FNE',
    'FQS', 'CÓD. RESPOSTA', 'TEXTO RESPOSTA', 'VL. RESPOSTA'
  ];

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#002b5e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, headers.length);

  return {
    ok: true,
    id: ss.getId(),
    url: ss.getUrl(),
    message: 'Planilha criada. Cole a base na aba Dados_Completos e coloque este ID em CONFIG_FONTES.'
  };
}

/**
 * Use esta função para começar do zero a geração do bimestre.
 * Ela cria todas as abas de resumo imediatamente e agenda continuação automática.
 */
function reiniciarGeracaoResumosDaFonte(avaliacaoKey, options) {
  options = options || {};

  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(MAPA_RESUMO_JOB_PREFIX + avaliacaoKey);

  var r = gerarResumosDaFonte(avaliacaoKey, {
    reset: true,
    maxMs: options.maxMs || 240000,
    chunkSize: options.chunkSize || 10000
  });

  return r;
}

/**
 * Continua uma geração existente. Se não existir job ativo, inicia um novo.
 */
function gerarResumosDaFonte(avaliacaoKey, options) {
  options = options || {};

  var fonte = getFonteAvaliacao_(avaliacaoKey);
  if (!fonte) return { ok: false, message: 'Fonte não configurada para ' + avaliacaoKey };

  var ss = openFonteSpreadsheet_(fonte);
  var sh = ss.getSheetByName(fonte.abaDados);
  if (!sh || sh.getLastRow() < 2) {
    return { ok: false, message: 'Aba de dados não encontrada ou vazia: ' + fonte.abaDados };
  }

  var props = PropertiesService.getScriptProperties();
  var propKey = MAPA_RESUMO_JOB_PREFIX + avaliacaoKey;
  var job = null;

  if (!options.reset) {
    try {
      job = JSON.parse(props.getProperty(propKey) || 'null');
    } catch (e) {
      job = null;
    }
  }

  if (!job || options.reset) {
    job = _criarJobResumo_(ss, sh, fonte, avaliacaoKey, options);
    props.setProperty(propKey, JSON.stringify(job));
  }

  return _processarJobResumo_(fonte, job, options);
}

function gerarTodosResumosFontes() {
  var fontes = getFontesMap_();
  var keys = Object.keys(fontes).sort();

  if (!keys.length) {
    return 'Nenhuma fonte configurada. Execute setupConfigFontesModelo() e preencha os IDs.';
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty(MAPA_RESUMO_QUEUE_KEY, JSON.stringify(keys));

  var primeiro = keys[0];
  var r = reiniciarGeracaoResumosDaFonte(primeiro);
  _agendarContinuacaoResumos_();

  return 'Fila criada para: ' + keys.join(', ') + '\nIniciado: ' + primeiro + '\n' + JSON.stringify(r, null, 2);
}

function continuarGeracaoResumosFontes() {
  var props = PropertiesService.getScriptProperties();
  var queue = [];

  try {
    queue = JSON.parse(props.getProperty(MAPA_RESUMO_QUEUE_KEY) || '[]');
  } catch (e) {
    queue = [];
  }

  var fontes = getFontesMap_();

  if (!queue.length) {
    queue = Object.keys(fontes).filter(function(k) {
      return !!props.getProperty(MAPA_RESUMO_JOB_PREFIX + k);
    }).sort();
  }

  if (!queue.length) {
    _limparGatilhosResumo_();
    return 'Nenhum job pendente.';
  }

  var key = queue[0];
  var result = gerarResumosDaFonte(key, { maxMs: 240000, chunkSize: 10000 });

  if (result.done) {
    queue.shift();
    props.setProperty(MAPA_RESUMO_QUEUE_KEY, JSON.stringify(queue));

    if (queue.length) {
      reiniciarGeracaoResumosDaFonte(queue[0]);
      _agendarContinuacaoResumos_();
      return 'Finalizado ' + key + '. Iniciado próximo: ' + queue[0];
    }

    _limparGatilhosResumo_();
    return 'Todos os resumos foram finalizados.';
  }

  _agendarContinuacaoResumos_();
  return 'Processamento parcial de ' + key + ': ' + JSON.stringify(result, null, 2);
}

function statusGeracaoResumosFontes() {
  var props = PropertiesService.getScriptProperties();
  var fontes = getFontesMap_();
  var out = [];

  Object.keys(fontes).sort().forEach(function(key) {
    var raw = props.getProperty(MAPA_RESUMO_JOB_PREFIX + key);
    if (!raw) {
      out.push(key + ': sem job ativo');
      return;
    }

    var job = JSON.parse(raw);
    var pct = job.lastRow > 1 ? Math.round(((job.nextRow - 2) / (job.lastRow - 1)) * 100) : 0;
    out.push(key + ': ' + pct + '% | próxima linha ' + job.nextRow + ' de ' + job.lastRow);
  });

  return out.join('\n');
}

function cancelarGeracaoResumosFontes() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function(k) {
    if (k.indexOf(MAPA_RESUMO_JOB_PREFIX) === 0 || k === MAPA_RESUMO_QUEUE_KEY) props.deleteProperty(k);
  });
  _limparGatilhosResumo_();
  return 'Jobs e gatilhos de resumo cancelados.';
}

function gerarDetalheAlunosDaFonte(avaliacaoKey, options) {
  return {
    ok: false,
    message: 'Nesta versão, não é recomendado gerar Detalhe_Alunos completo. O painel lê a ABA_DADOS sob demanda ao abrir os detalhes.'
  };
}

function _criarJobResumo_(ss, shDados, fonte, avaliacaoKey, options) {
  var lastRow = shDados.getLastRow();
  var lastCol = shDados.getLastColumn();
  var h = shDados.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = _getIndicesAvaliacaoFonte_(h);
  var validacao = _validarIndicesFonte_(idx);

  if (!validacao.ok) {
    throw new Error('Colunas obrigatórias não encontradas: ' + validacao.faltando.join(', '));
  }

  _prepararAbasResumo_(ss, fonte, avaliacaoKey, lastRow);

  return {
    key: avaliacaoKey,
    spreadsheetId: fonte.spreadsheetId,
    abaDados: fonte.abaDados,
    nextRow: 2,
    lastRow: lastRow,
    lastCol: lastCol,
    startedAt: new Date().toISOString(),
    linhasValidas: 0,
    done: false
  };
}

function _prepararAbasResumo_(ss, fonte, avaliacaoKey, lastRow) {
  _resetSheet_(ss, fonte.abaResumoFiltros,
    ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'DISCIPLINA', 'EIXO', 'RESPOSTA', 'VALOR_RESPOSTA', 'QTD', 'QTD_ADEQUADO']
  );

  _resetSheet_(ss, fonte.abaResumoRede,
    ['DISCIPLINA', 'EIXO', 'RESPOSTA', 'VALOR_RESPOSTA', 'QTD', 'QTD_ADEQUADO']
  );

  _resetSheet_(ss, fonte.abaResumoPerguntas,
    ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'DISCIPLINA', 'EIXO', 'FQS', 'RESPOSTA', 'VALOR_RESPOSTA', 'QTD', 'QTD_ADEQUADO']
  );

  _resetSheet_(ss, fonte.abaResumoHierarquia,
    ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'QTD_REGISTROS', 'QTD_ALUNOS']
  );

  _resetSheet_(ss, fonte.abaDetalheAlunos,
    ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'RA', 'ALUNO', 'DISCIPLINA', 'EIXO', 'FQS', 'RESPOSTA', 'VALOR_RESPOSTA']
  );

  var aux = _resetSheet_(ss, MAPA_AUX_HIER_ALUNOS,
    ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'ALUNO_KEY']
  );
  try { aux.hideSheet(); } catch (e) {}

  _writeMetaParcial_(ss, fonte, avaliacaoKey, 'PROCESSANDO', 0, lastRow, 0, 'Abas preparadas.');
}

function _processarJobResumo_(fonte, job, options) {
  options = options || {};
  var maxMs = Number(options.maxMs || 240000);
  var reserveMs = 50000;
  var chunkSize = Number(options.chunkSize || 10000);
  var t0 = Date.now();

  var ss = openFonteSpreadsheet_(fonte);
  var shDados = ss.getSheetByName(fonte.abaDados);
  if (!shDados) return { ok: false, message: 'Aba de dados não encontrada: ' + fonte.abaDados };

  var h = shDados.getRange(1, 1, 1, job.lastCol).getValues()[0];
  var idx = _getIndicesAvaliacaoFonte_(h);
  var validacao = _validarIndicesFonte_(idx);
  if (!validacao.ok) return { ok: false, message: 'Colunas obrigatórias não encontradas: ' + validacao.faltando.join(', ') };

  var resumoFiltros = _readResumoMapFromSheet_(ss.getSheetByName(fonte.abaResumoFiltros), 7);
  var resumoRede = _readResumoMapFromSheet_(ss.getSheetByName(fonte.abaResumoRede), 4);
  var resumoPerguntas = _readResumoMapFromSheet_(ss.getSheetByName(fonte.abaResumoPerguntas), 8);
  var hierReg = _readHierRegistros_(ss.getSheetByName(fonte.abaResumoHierarquia));
  var hierAlunos = _readHierAlunosAux_(ss.getSheetByName(MAPA_AUX_HIER_ALUNOS));

  var linhasValidasSessao = 0;
  var startRowInicial = job.nextRow;

  while (job.nextRow <= job.lastRow && (Date.now() - t0) < (maxMs - reserveMs)) {
    var numRows = Math.min(chunkSize, job.lastRow - job.nextRow + 1);
    var data = shDados.getRange(job.nextRow, 1, numRows, job.lastCol).getValues();

    for (var r = 0; r < data.length; r++) {
      var item = _normalizarLinhaFonte_(data[r], idx);
      if (!item) continue;

      linhasValidasSessao++;

      _incResumo_(
        resumoFiltros,
        [item.unidade, item.ano, item.turma, item.disciplina, item.eixo, item.rotulo, item.valor],
        item.adequado
      );

      _incResumo_(
        resumoRede,
        [item.disciplina, item.eixo, item.rotulo, item.valor],
        item.adequado
      );

      _incResumo_(
        resumoPerguntas,
        [item.unidade, item.ano, item.turma, item.disciplina, item.eixo, item.pergunta || item.eixo, item.rotulo, item.valor],
        item.adequado
      );

      var hKey = item.unidade + '||' + item.ano + '||' + item.turma;
      hierReg[hKey] = (hierReg[hKey] || 0) + 1;

      var alunoKey = (item.ra || item.nome) + '|' + item.unidade + '|' + item.ano + '|' + item.turma;
      hierAlunos[hKey + '||' + alunoKey] = true;
    }

    job.nextRow += numRows;
  }

  job.linhasValidas = Number(job.linhasValidas || 0) + linhasValidasSessao;
  job.done = job.nextRow > job.lastRow;

  _writeResumoMap_(ss, fonte.abaResumoFiltros,
    ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'DISCIPLINA', 'EIXO', 'RESPOSTA', 'VALOR_RESPOSTA', 'QTD', 'QTD_ADEQUADO'],
    resumoFiltros
  );

  _writeResumoMap_(ss, fonte.abaResumoRede,
    ['DISCIPLINA', 'EIXO', 'RESPOSTA', 'VALOR_RESPOSTA', 'QTD', 'QTD_ADEQUADO'],
    resumoRede
  );

  _writeResumoMap_(ss, fonte.abaResumoPerguntas,
    ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'DISCIPLINA', 'EIXO', 'FQS', 'RESPOSTA', 'VALOR_RESPOSTA', 'QTD', 'QTD_ADEQUADO'],
    resumoPerguntas
  );

  _writeHierAlunosAux_(ss, hierAlunos);
  _writeHierarquiaFromMaps_(ss, fonte.abaResumoHierarquia, hierReg, hierAlunos);

  var status = job.done ? 'CONCLUIDO' : 'PROCESSANDO';
  _writeMetaParcial_(ss, fonte, job.key, status, job.nextRow - 2, job.lastRow, job.linhasValidas, 'Linhas ' + startRowInicial + ' até ' + (job.nextRow - 1));

  var props = PropertiesService.getScriptProperties();
  var propKey = MAPA_RESUMO_JOB_PREFIX + job.key;

  if (job.done) {
    props.deleteProperty(propKey);
  } else {
    props.setProperty(propKey, JSON.stringify(job));
    _agendarContinuacaoResumos_();
  }

  var pct = job.lastRow > 1 ? Math.round(((job.nextRow - 2) / (job.lastRow - 1)) * 100) : 100;

  return {
    ok: true,
    done: job.done,
    status: status,
    percentual: pct,
    linhasProcessadasNestaExecucao: Math.max(0, job.nextRow - startRowInicial),
    linhasValidasNestaExecucao: linhasValidasSessao,
    proximaLinha: job.nextRow,
    ultimaLinha: job.lastRow,
    duracaoSegundos: Math.round((Date.now() - t0) / 1000),
    message: job.done ? 'Resumos concluídos.' : 'Processamento parcial. A continuação foi agendada.'
  };
}

function _validarIndicesFonte_(idx) {
  var obrig = {
    unidade: 'UNIDADE',
    ano: 'ANO ESCOLAR',
    turma: 'TURMA',
    nome: 'NOME DO ALUNO',
    disciplina: 'FNC-DISCIPLINA',
    eixo: 'DESCRIÇÃO FNE',
    resposta: 'TEXTO RESPOSTA',
    valor: 'VL. RESPOSTA'
  };

  var faltando = [];
  Object.keys(obrig).forEach(function(k) {
    if (idx[k] === -1 || idx[k] === undefined || idx[k] === null) faltando.push(obrig[k]);
  });

  return { ok: faltando.length === 0, faltando: faltando };
}

function _normalizarLinhaFonte_(row, idx) {
  var unidade = cleanUnit_(safeCell_(row, idx.unidade));
  var ano = anoParaBanco_(safeCell_(row, idx.ano));
  var turma = String(safeCell_(row, idx.turma) || '').trim().toUpperCase();
  var ra = String(safeCell_(row, idx.ra) || '').trim().replace(/\.0$/, '');
  var nome = String(safeCell_(row, idx.nome) || '').trim();
  var disciplina = normalizarDisciplina_(safeCell_(row, idx.disciplina));
  var eixo = String(safeCell_(row, idx.eixo) || '').trim().toUpperCase();
  var pergunta = String(safeCell_(row, idx.pergunta) || '').trim();
  var vlRaw = safeCell_(row, idx.valor);
  var textoResp = String(safeCell_(row, idx.resposta) || '').trim();

  if (!unidade || !ano || !turma || !nome || !disciplina || !eixo) return null;

  var rotulo = labelRespostaPainel_(eixo, vlRaw, textoResp);
  if (!rotulo) rotulo = 'Não Avaliado';

  var valor = valorNumericoPainel_(eixo, vlRaw, rotulo);
  var adequado = isRespostaAdequadaBackend_(eixo, rotulo) ? 1 : 0;

  return {
    unidade: unidade,
    ano: ano,
    turma: turma,
    ra: ra,
    nome: nome,
    disciplina: disciplina,
    eixo: eixo,
    pergunta: pergunta,
    rotulo: rotulo,
    valor: valor,
    adequado: adequado
  };
}

function _getIndicesAvaliacaoFonte_(h) {
  return {
    unidade: idx_(h, ['UNIDADE', 'ESCOLA', 'UNIDADE ESCOLAR']),
    ano: idx_(h, ['ANO ESCOLAR', 'ANO', 'SÉRIE', 'SERIE']),
    turma: idx_(h, ['TURMA', 'CLASSE']),
    ra: idx_(h, ['REMA - ALUNO', 'RA', 'CODIGO ALUNO', 'CÓDIGO ALUNO', 'ID ALUNO']),
    nome: idx_(h, ['NOME DO ALUNO', 'ALUNO', 'NOME']),
    disciplina: idx_(h, ['FNC-DISCIPLINA', 'DISCIPLINA', 'COMPONENTE CURRICULAR', 'COMPONENTE', 'MATÉRIA', 'MATERIA']),
    eixo: idx_(h, ['DESCRIÇÃO FNE', 'DESCRICAO FNE', 'FNE', 'EIXO']),
    pergunta: idx_(h, ['FQS', 'PERGUNTA', 'QUESTÃO', 'QUESTAO', 'ITEM']),
    resposta: idx_(h, ['TEXTO RESPOSTA', 'RESPOSTA', 'DESCRIÇÃO RESPOSTA', 'DESCRICAO RESPOSTA']),
    valor: idx_(h, ['VL. RESPOSTA', 'VL RESPOSTA', 'VALOR RESPOSTA', 'VALOR', 'PONTUAÇÃO', 'PONTUACAO', 'NOTA'])
  };
}

function _incResumo_(map, campos, adequado) {
  var chave = campos.map(function(v) { return v === null || v === undefined ? '' : String(v); }).join('||');
  if (!map[chave]) map[chave] = { campos: campos, qtd: 0, adequado: 0 };
  map[chave].qtd++;
  map[chave].adequado += adequado ? 1 : 0;
}

function _readResumoMapFromSheet_(sh, numCampos) {
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var campos = row.slice(0, numCampos);
    var qtd = Number(row[numCampos] || 0);
    var adequado = Number(row[numCampos + 1] || 0);
    if (!qtd) continue;
    var chave = campos.map(function(v) { return v === null || v === undefined ? '' : String(v); }).join('||');
    map[chave] = { campos: campos, qtd: qtd, adequado: adequado };
  }

  return map;
}

function _readHierRegistros_(sh) {
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(sh.getLastColumn(), 5)).getValues();
  for (var i = 0; i < data.length; i++) {
    var u = String(data[i][0] || '').trim();
    var a = String(data[i][1] || '').trim();
    var t = String(data[i][2] || '').trim();
    var qtd = Number(data[i][3] || 0);
    if (!u || !a || !t) continue;
    map[u + '||' + a + '||' + t] = qtd;
  }
  return map;
}

function _readHierAlunosAux_(sh) {
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < data.length; i++) {
    var u = String(data[i][0] || '').trim();
    var a = String(data[i][1] || '').trim();
    var t = String(data[i][2] || '').trim();
    var alunoKey = String(data[i][3] || '').trim();
    if (!u || !a || !t || !alunoKey) continue;
    map[u + '||' + a + '||' + t + '||' + alunoKey] = true;
  }
  return map;
}

function _writeResumoMap_(ss, sheetName, headers, map) {
  var sh = _resetSheet_(ss, sheetName, headers);
  var keys = Object.keys(map).sort();
  var rows = [];

  keys.forEach(function(k) {
    var it = map[k];
    rows.push(it.campos.concat([it.qtd, it.adequado]));
  });

  _writeRowsChunk_(sh, rows, 2);
  _formatResumoSheet_(sh, headers.length);
}

function _writeHierAlunosAux_(ss, map) {
  var sh = _resetSheet_(ss, MAPA_AUX_HIER_ALUNOS, ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'ALUNO_KEY']);
  var rows = [];

  Object.keys(map).sort().forEach(function(k) {
    var parts = k.split('||');
    rows.push([parts[0], parts[1], parts[2], parts.slice(3).join('||')]);
  });

  _writeRowsChunk_(sh, rows, 2);
  try { sh.hideSheet(); } catch (e) {}
}

function _writeHierarquiaFromMaps_(ss, sheetName, hierReg, hierAlunos) {
  var headers = ['UNIDADE', 'ANO_ESCOLAR', 'TURMA', 'QTD_REGISTROS', 'QTD_ALUNOS'];
  var sh = _resetSheet_(ss, sheetName, headers);
  var alunosPorHier = {};

  Object.keys(hierAlunos).forEach(function(k) {
    var parts = k.split('||');
    var hKey = parts[0] + '||' + parts[1] + '||' + parts[2];
    alunosPorHier[hKey] = (alunosPorHier[hKey] || 0) + 1;
  });

  var allKeys = {};
  Object.keys(hierReg).forEach(function(k) { allKeys[k] = true; });
  Object.keys(alunosPorHier).forEach(function(k) { allKeys[k] = true; });

  var rows = [];
  Object.keys(allKeys).sort().forEach(function(k) {
    var parts = k.split('||');
    rows.push([parts[0], parts[1], parts[2], hierReg[k] || 0, alunosPorHier[k] || 0]);
  });

  _writeRowsChunk_(sh, rows, 2);
  _formatResumoSheet_(sh, headers.length);
}

function _writeMetaParcial_(ss, fonte, avaliacaoKey, status, processadas, lastRow, linhasValidas, obs) {
  var headers = ['CAMPO', 'VALOR'];
  var sh = _resetSheet_(ss, FONTE_DEFAULTS.ABA_META, headers);
  var rows = [
    ['STATUS', status],
    ['AVALIACAO', avaliacaoKey],
    ['DATA_ATUALIZACAO', new Date()],
    ['SPREADSHEET_ID', fonte.spreadsheetId],
    ['ABA_DADOS', fonte.abaDados],
    ['LAST_ROW_DADOS', lastRow],
    ['LINHAS_PROCESSADAS', processadas],
    ['LINHAS_VALIDAS', linhasValidas],
    ['PERCENTUAL', lastRow > 1 ? Math.round((processadas / (lastRow - 1)) * 100) + '%' : '100%'],
    ['VERSAO_RESUMO', 'multiplanilha_v3_incremental'],
    ['OBS', obs || '']
  ];
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  _formatResumoSheet_(sh, 2);
}

function _lerMetaResumo_(ss) {
  var sh = ss.getSheetByName(FONTE_DEFAULTS.ABA_META);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  data.forEach(function(r) {
    out[String(r[0] || '').trim()] = r[1];
  });
  return out;
}

function _resetSheet_(ss, sheetName, headers) {
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#002b5e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

function _writeRowsChunk_(sh, rows, startRow) {
  if (!rows || !rows.length) return;
  var chunk = 5000;
  for (var i = 0; i < rows.length; i += chunk) {
    var part = rows.slice(i, i + chunk);
    sh.getRange(startRow + i, 1, part.length, part[0].length).setValues(part);
  }
}

function _formatResumoSheet_(sh, cols) {
  try {
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, cols);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, cols).setFontSize(9);
  } catch (e) {}
}

function _agendarContinuacaoResumos_() {
  _limparGatilhosResumo_();
  ScriptApp.newTrigger(MAPA_RESUMO_TRIGGER_FN).timeBased().after(60 * 1000).create();
}

function _limparGatilhosResumo_() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === MAPA_RESUMO_TRIGGER_FN) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function labelRespostaPainel_(eixo, vlRaw, textoResposta) {
  var eixoN = normalizeKey_(eixo);
  var vl = normVl_(vlRaw);

  if (vl === 'S') return 'Sim';
  if (vl === 'N') return 'Não';
  if (vl === 'X') return 'Não Avaliado';

  if (eixoN.indexOf('ESCRITA') !== -1) return ({ '1':'Pré-silábica','2':'Silábica','3':'Silábico-alf.','4':'Alfabética','5':'Ortográfica' })[vl] || labelCurto_(eixo, vlRaw);
  if (eixoN.indexOf('LEITURA') !== -1) return ({ '1':'N1 Pré-leitor','2':'N2 Pré-leitor','3':'N3 Pré-leitor','4':'N4 Pré-leitor','5':'L. Iniciante','6':'L. Fluente' })[vl] || labelCurto_(eixo, vlRaw);
  if (eixoN.indexOf('PRODUCAO TEXTUAL') !== -1) return ({ '1':'Nível 1','2':'Nível 2','3':'Nível 3','4':'Nível 4','5':'Nível 5','9':'Não produz' })[vl] || labelCurto_(eixo, vlRaw);

  if (
    eixoN.indexOf('AUTONOMIA') !== -1 ||
    eixoN.indexOf('AUTORREGUL') !== -1 ||
    eixoN.indexOf('COMUNICAC') !== -1 ||
    eixoN.indexOf('ENGAJAMENTO') !== -1 ||
    eixoN.indexOf('SEGURANCA') !== -1
  ) {
    return ({ '0':'Autônomo','1':'Apoio leve','2':'Apoio frequente','3':'Dependente' })[vl] || labelCurto_(eixo, vlRaw);
  }

  if (textoResposta) {
    var txt = String(textoResposta).trim();
    if (normalizeKey_(txt).indexOf('NAO AVAL') !== -1) return 'Não Avaliado';
    if (txt.length <= 45) return txt;
  }

  return labelCurto_(eixo, vlRaw);
}

function valorNumericoPainel_(eixo, vlRaw, rotulo) {
  var eixoN = normalizeKey_(eixo);
  var vl = normVl_(vlRaw);

  if (vl === 'S') return 1;
  if (vl === 'N') return 0;
  if (vl === 'X') return null;
  if (vl === '9' && eixoN.indexOf('PRODUCAO TEXTUAL') !== -1) return null;

  var n = parseFloat(String(vl).replace(',', '.'));
  if (!isNaN(n)) return n;

  var r = normalizeKey_(rotulo);
  var map = {
    'PRE-SILABICA': 1, 'SILABICA': 2, 'SILABICO-ALF.': 3, 'SILABICO-ALFABETICA': 3, 'ALFABETICA': 4, 'ORTOGRAFICA': 5,
    'N1 PRE-LEITOR': 1, 'N2 PRE-LEITOR': 2, 'N3 PRE-LEITOR': 3, 'N4 PRE-LEITOR': 4, 'L. INICIANTE': 5, 'L. FLUENTE': 6,
    'NIVEL 1': 1, 'NIVEL 2': 2, 'NIVEL 3': 3, 'NIVEL 4': 4, 'NIVEL 5': 5,
    'DEPENDENTE': 1, 'APOIO FREQUENTE': 2, 'APOIO LEVE': 3, 'AUTONOMO': 4
  };
  if (map[r] !== undefined) return map[r];
  return null;
}

function isRespostaAdequadaBackend_(eixo, rotulo) {
  var e = normalizeKey_(eixo);
  var r = normalizeKey_(rotulo);

  if (r === 'SIM') return true;
  if (e.indexOf('LEITURA') !== -1) return r === 'L. INICIANTE' || r === 'L. FLUENTE';
  if (e.indexOf('ESCRITA') !== -1) return r === 'ALFABETICA' || r === 'ORTOGRAFICA';
  if (e.indexOf('PRODUCAO TEXTUAL') !== -1) return r === 'NIVEL 4' || r === 'NIVEL 5';
  if (r === 'AUTONOMO') return true;
  return false;
}

function normalizarDisciplina_(valor) {
  var txt = String(valor || '').trim();
  if (!txt) return '';
  var norm = normalizeKey_(txt);

  if (norm.indexOf('LINGUA PORTUGUESA') !== -1 || norm.indexOf('PORTUGUES') !== -1) return 'Língua Portuguesa';
  if (norm.indexOf('MATEMATICA') !== -1) return 'Matemática';
  if (norm.indexOf('CIENCIAS') !== -1) return 'Ciências';
  if (norm.indexOf('HISTORIA') !== -1) return 'História';
  if (norm.indexOf('GEOGRAFIA') !== -1) return 'Geografia';
  if (norm.indexOf('ARTE') !== -1) return 'Arte';
  if (norm.indexOf('EDUCACAO FISICA') !== -1) return 'Educação Física';
  if (norm.indexOf('LINGUA INGLESA') !== -1 || norm.indexOf('INGLES') !== -1) return 'Língua Inglesa';
  if (norm.indexOf('ATENDIMENTO EDUCACIONAL') !== -1 || norm === 'AEE') return 'Atendimento Educacional Especializado';
  return txt;
}

function normFne_(fne) {
  return normalizeKey_(fne);
}

function _lerSheetComoObjetos_(sh) {
  if (!sh || sh.getLastRow() < 2) return { headers: [], rows: [] };
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  return { headers: data[0], rows: data.slice(1) };
}

function _numResumo_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}
