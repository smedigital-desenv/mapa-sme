/**
 * =====================================================================
 * Backend_Bimestre.gs — Bimestres com suporte a multiplanilhas
 * =====================================================================
 * Prioridade de leitura:
 * 1) CONFIG_FONTES + abas Resumo_* da planilha externa.
 * 2) Aba local/externa completa, como fallback para não quebrar o sistema.
 * =====================================================================
 */

function getAvaliacaoBimestreRapida(key, filtros) {
  filtros = filtros || {};

  var fonte = getFonteAvaliacao_(key);
  if (fonte && fonteTemResumos_(fonte)) {
    var rapido = _getAvaliacaoBimestreResumoFonte_(fonte, filtros);
    if (rapido && rapido.ok) return rapido;
  }

  return _getAvaliacaoBimestreRaw_(key, filtros);
}

function getHierarquiaBimestre(key, filtros) {
  filtros = filtros || {};

  var fonte = getFonteAvaliacao_(key);
  if (fonte && fonteTemResumos_(fonte)) {
    var h = _getHierarquiaResumoFonte_(fonte, filtros);
    if (h && h.ok) return h;
  }

  return _getHierarquiaRaw_(key, filtros);
}

function getAlunosPorRespostaBimestre(key, filtros) {
  filtros = filtros || {};

  var fonte = getFonteAvaliacao_(key);
  if (fonte) {
    var alunos = _getAlunosPorRespostaFonte_(fonte, filtros);
    if (alunos && alunos.ok) return alunos;
  }

  return _getAlunosPorRespostaRaw_(key, filtros);
}

function getDetalheEixo(key, filtros) {
  filtros = filtros || {};

  var fonte = getFonteAvaliacao_(key);
  if (fonte && fonteTemResumos_(fonte)) {
    var det = _getDetalheEixoResumoFonte_(fonte, filtros);
    if (det && det.ok) return det;
  }

  return _getDetalheEixoRaw_(key, filtros);
}



// =======================================================
// PACOTE RÁPIDO DO BIMESTRE — leitura única para filtro local no front
// =======================================================
function getPacoteBimestreRapido(key, filtrosBase) {
  filtrosBase = filtrosBase || {};

  var fonte = getFonteAvaliacao_(key);
  if (fonte && fonteTemResumos_(fonte)) {
    var pacote = _getPacoteBimestreResumoFonte_(fonte, filtrosBase);
    if (pacote && pacote.ok) return pacote;
  }

  return _getPacoteBimestreRaw_(key, filtrosBase);
}

function _getPacoteBimestreResumoFonte_(fonte, filtrosBase) {
  filtrosBase = filtrosBase || {};
  var anoBanco = anoParaBanco_(filtrosBase.ano || '');

  var cacheKey = [
    'pacote_bim_fonte_v3',
    fonte.key,
    fonte.spreadsheetId,
    anoBanco || 'TODOS'
  ].join('_');

  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var shResumo = getFonteSheet_(fonte, fonte.abaResumoFiltros);
  var shHier = getFonteSheet_(fonte, fonte.abaResumoHierarquia);

  if (!shResumo || shResumo.getLastRow() < 2) {
    return {
      ok: false,
      message: 'Resumo_Filtros não encontrado ou vazio.',
      columns: ['u', 'a', 't', 'd', 'e', 'r', 'q'],
      linhas: [],
      arvore: {},
      disciplinas: [],
      unidades: [],
      anos: [],
      turmas: [],
      alunosTotal: 0,
      hierLinhas: []
    };
  }

  var data = shResumo.getRange(1, 1, shResumo.getLastRow(), shResumo.getLastColumn()).getValues();
  var h = data[0];

  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iD = idx_(h, ['DISCIPLINA']);
  var iE = idx_(h, ['EIXO', 'DESCRIÇÃO FNE', 'DESCRICAO FNE']);
  var iR = idx_(h, ['RESPOSTA']);
  var iQtd = idx_(h, ['QTD', 'TOTAL']);

  var linhas = [];
  var disciplinas = {};
  var unidades = {};
  var anos = {};
  var turmas = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = String(safeCell_(row, iU) || '').trim();
    var ano = anoParaBanco_(safeCell_(row, iAno));
    var t = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var disc = String(safeCell_(row, iD) || '').trim();
    var eixo = String(safeCell_(row, iE) || '').trim();
    var resp = String(safeCell_(row, iR) || '').trim() || 'Não Avaliado';
    var qtd = Number(safeCell_(row, iQtd) || 0);

    if (!u || !ano || !t || !disc || !eixo || !qtd) continue;
    if (anoBanco && ano !== anoBanco) continue;

    linhas.push([u, ano, t, disc, eixo, resp, qtd]);
    disciplinas[disc] = true;
    unidades[u] = true;
    anos[ano] = true;
    turmas[t] = true;
  }

  var hier = _montarArvorePacoteFonte_(shHier, anoBanco);

  var result = {
    ok: true,
    source: 'fonte_pacote_resumo',
    compact: true,
    columns: ['u', 'a', 't', 'd', 'e', 'r', 'q'],
    linhas: linhas,
    arvore: hier.arvore,
    hierLinhas: hier.hierLinhas || [],
    disciplinas: Object.keys(disciplinas).sort(),
    unidades: Object.keys(unidades).sort(),
    anos: Object.keys(anos).sort(),
    turmas: Object.keys(turmas).sort(),
    alunosTotal: hier.alunosTotal,
    generatedAt: new Date().toISOString()
  };

  cachePut_(cacheKey, result, 21600);
  return result;
}

function _montarArvorePacoteFonte_(shHier, anoBanco) {
  var out = { arvore: {}, alunosTotal: 0, hierLinhas: [] };
  if (!shHier || shHier.getLastRow() < 2) return out;

  var data = shHier.getRange(1, 1, shHier.getLastRow(), shHier.getLastColumn()).getValues();
  var h = data[0];
  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iAl = idx_(h, ['QTD_ALUNOS', 'ALUNOS']);

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = String(safeCell_(row, iU) || '').trim();
    var ano = anoParaBanco_(safeCell_(row, iAno));
    var t = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var qtd = Number(safeCell_(row, iAl) || 0);

    if (!u || !ano || !t) continue;

    // Sempre envia as linhas da hierarquia para permitir filtro de ano 100% local no front.
    out.hierLinhas.push([u, ano, t, qtd]);

    if (anoBanco && ano !== anoBanco) continue;

    if (!out.arvore[u]) out.arvore[u] = {};
    out.arvore[u][t] = (out.arvore[u][t] || 0) + qtd;
    out.alunosTotal += qtd;
  }

  return out;
}

function _getPacoteBimestreRaw_(key, filtrosBase) {
  filtrosBase = filtrosBase || {};
  var sh = _getRawBimestreSheet_(key);
  if (!sh || sh.getLastRow() < 2) {
    return {
      ok: true,
      source: 'raw_pacote_vazio',
      compact: true,
      columns: ['u', 'a', 't', 'd', 'e', 'r', 'q'],
      linhas: [],
      arvore: {},
      disciplinas: [],
      unidades: [],
      anos: [],
      turmas: [],
      alunosTotal: 0
    };
  }

  var anoBanco = anoParaBanco_(filtrosBase.ano || '');
  var cacheKey = [
    'pacote_bim_raw_v3',
    key,
    sh.getParent().getId(),
    sh.getName(),
    sh.getLastRow(),
    anoBanco || 'TODOS'
  ].join('_');

  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];
  var idx = _getIndicesAvaliacaoFonte_(h);

  var map = {};
  var alunosMap = {};
  var disciplinas = {};
  var unidades = {};
  var anos = {};
  var turmas = {};
  var arvoreTemp = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = cleanUnit_(safeCell_(row, idx.unidade));
    var ano = anoParaBanco_(safeCell_(row, idx.ano));
    var t = String(safeCell_(row, idx.turma) || '').trim().toUpperCase();
    var ra = String(safeCell_(row, idx.ra) || '').trim().replace(/\.0$/, '');
    var nome = String(safeCell_(row, idx.nome) || '').trim();
    var disc = normalizarDisciplina_(safeCell_(row, idx.disciplina));
    var eixo = String(safeCell_(row, idx.eixo) || '').trim().toUpperCase();
    var resp = labelRespostaPainel_(eixo, safeCell_(row, idx.valor), safeCell_(row, idx.resposta));

    if (!u || !ano || !t || !nome || !disc || !eixo) continue;
    if (anoBanco && ano !== anoBanco) continue;

    var alunoKey = (ra || nome) + '|' + u + '|' + ano + '|' + t;
    alunosMap[alunoKey] = true;

    if (!arvoreTemp[u]) arvoreTemp[u] = {};
    if (!arvoreTemp[u][t]) arvoreTemp[u][t] = {};
    arvoreTemp[u][t][ra || nome] = true;

    disciplinas[disc] = true;
    unidades[u] = true;
    anos[ano] = true;
    turmas[t] = true;

    var k = [u, ano, t, disc, eixo, resp].join('||');
    map[k] = (map[k] || 0) + 1;
  }

  var linhas = Object.keys(map).map(function(k) {
    var p = k.split('||');
    return [p[0], p[1], p[2], p[3], p[4], p[5], map[k]];
  });

  var arvore = {};
  var hierLinhas = [];
  Object.keys(arvoreTemp).forEach(function(u) {
    arvore[u] = {};
    Object.keys(arvoreTemp[u]).forEach(function(t) {
      arvore[u][t] = Object.keys(arvoreTemp[u][t]).length;
      // No fallback raw, o pacote já vem filtrado por ano quando anoBanco existe.
      // Para pacote TODOS, tentamos recuperar o ano a partir das chaves de alunos.
    });
  });

  // Recalcula a hierarquia por ano a partir do mapa de alunos para permitir filtro local.
  var hierPorAno = {};
  Object.keys(alunosMap).forEach(function(k) {
    var p = k.split('|');
    var u = p[1];
    var ano = p[2];
    var t = p[3];
    var hk = [u, ano, t].join('|');
    hierPorAno[hk] = (hierPorAno[hk] || 0) + 1;
  });
  Object.keys(hierPorAno).forEach(function(k) {
    var p = k.split('|');
    hierLinhas.push([p[0], p[1], p[2], hierPorAno[k]]);
  });

  var result = {
    ok: true,
    source: 'raw_pacote',
    compact: true,
    columns: ['u', 'a', 't', 'd', 'e', 'r', 'q'],
    linhas: linhas,
    arvore: arvore,
    hierLinhas: hierLinhas,
    disciplinas: Object.keys(disciplinas).sort(),
    unidades: Object.keys(unidades).sort(),
    anos: Object.keys(anos).sort(),
    turmas: Object.keys(turmas).sort(),
    alunosTotal: Object.keys(alunosMap).length,
    generatedAt: new Date().toISOString()
  };

  cachePut_(cacheKey, result, 21600);
  return result;
}

// =======================================================
// LEITURA DAS ABAS DE RESUMO EXTERNAS
// =======================================================
function _getAvaliacaoBimestreResumoFonte_(fonte, filtros) {
  var anoBanco = anoParaBanco_(filtros.ano || '');
  var cacheKey = ['bim_fonte_v1', fonte.key, fonte.spreadsheetId, filtros.unidade || 'TODAS', anoBanco || 'TODOS', filtros.turma || 'TODAS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var shResumo = getFonteSheet_(fonte, fonte.abaResumoFiltros);
  var shHier = getFonteSheet_(fonte, fonte.abaResumoHierarquia);

  if (!shResumo || shResumo.getLastRow() < 2) {
    return { ok: false, message: 'Resumo_Filtros não encontrado ou vazio.', disciplinas: [], unidades: [], anos: [], turmas: [], alunosTotal: 0, resumo: {} };
  }

  var data = shResumo.getRange(1, 1, shResumo.getLastRow(), shResumo.getLastColumn()).getValues();
  var h = data[0];

  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iD = idx_(h, ['DISCIPLINA']);
  var iE = idx_(h, ['EIXO', 'DESCRIÇÃO FNE']);
  var iR = idx_(h, ['RESPOSTA']);
  var iQtd = idx_(h, ['QTD', 'TOTAL']);

  var resumo = {};
  var disciplinas = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = String(safeCell_(row, iU) || '').trim();
    var ano = anoParaBanco_(safeCell_(row, iAno));
    var t = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var disc = String(safeCell_(row, iD) || '').trim();
    var eixo = String(safeCell_(row, iE) || '').trim();
    var resp = String(safeCell_(row, iR) || '').trim() || 'Não Avaliado';
    var qtd = Number(safeCell_(row, iQtd) || 0);

    if (!qtd || !disc || !eixo) continue;
    if (filtros.unidade && filtros.unidade !== 'TODAS' && u !== filtros.unidade) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (filtros.turma && filtros.turma !== 'TODAS' && t !== filtros.turma) continue;

    disciplinas[disc] = true;
    if (!resumo[disc]) resumo[disc] = {};
    if (!resumo[disc][eixo]) resumo[disc][eixo] = {};
    resumo[disc][eixo][resp] = (resumo[disc][eixo][resp] || 0) + qtd;
  }

  var listas = _listasHierarquiaFonte_(shHier, filtros);

  var result = {
    ok: true,
    source: 'fonte_resumo',
    sheetName: fonte.abaResumoFiltros,
    disciplinas: Object.keys(disciplinas).sort(),
    unidades: listas.unidades,
    anos: listas.anos,
    turmas: listas.turmas,
    alunosTotal: listas.alunosTotal,
    resumo: resumo,
    generatedAt: new Date().toISOString()
  };

  cachePut_(cacheKey, result, 21600);
  return result;
}

function _listasHierarquiaFonte_(shHier, filtros) {
  var out = { unidades: [], anos: [], turmas: [], alunosTotal: 0 };
  if (!shHier || shHier.getLastRow() < 2) return out;

  var anoBanco = anoParaBanco_(filtros.ano || '');
  var data = shHier.getRange(1, 1, shHier.getLastRow(), shHier.getLastColumn()).getValues();
  var h = data[0];
  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iAl = idx_(h, ['QTD_ALUNOS', 'ALUNOS']);

  var unidades = {};
  var anos = {};
  var turmas = {};
  var alunosTotal = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = String(safeCell_(row, iU) || '').trim();
    var ano = anoParaBanco_(safeCell_(row, iAno));
    var t = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var qtdAl = Number(safeCell_(row, iAl) || 0);

    if (u) unidades[u] = true;
    if (ano) anos[ano] = true;
    if (t) turmas[t] = true;

    if (filtros.unidade && filtros.unidade !== 'TODAS' && u !== filtros.unidade) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (filtros.turma && filtros.turma !== 'TODAS' && t !== filtros.turma) continue;

    alunosTotal += qtdAl;
  }

  return {
    unidades: Object.keys(unidades).sort(),
    anos: Object.keys(anos).sort(),
    turmas: Object.keys(turmas).sort(),
    alunosTotal: alunosTotal
  };
}

function _getHierarquiaResumoFonte_(fonte, filtros) {
  var anoBanco = anoParaBanco_(filtros.ano || '');
  var cacheKey = ['hier_bim_fonte_v1', fonte.key, fonte.spreadsheetId, anoBanco || 'TODOS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var sh = getFonteSheet_(fonte, fonte.abaResumoHierarquia);
  if (!sh || sh.getLastRow() < 2) return { ok: true, arvore: {} };

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];

  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iAl = idx_(h, ['QTD_ALUNOS', 'ALUNOS']);

  var arvore = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = String(safeCell_(row, iU) || '').trim();
    var ano = anoParaBanco_(safeCell_(row, iAno));
    var t = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var qtd = Number(safeCell_(row, iAl) || 0);

    if (!u || !t) continue;
    if (anoBanco && ano !== anoBanco) continue;

    if (!arvore[u]) arvore[u] = {};
    arvore[u][t] = (arvore[u][t] || 0) + qtd;
  }

  var result = { ok: true, source: 'fonte_resumo', arvore: arvore };
  cachePut_(cacheKey, result, 21600);
  return result;
}

function _getAlunosPorRespostaFonte_(fonte, filtros) {
  var anoBanco = anoParaBanco_(filtros.ano || '');

  // Usa Detalhe_Alunos somente se ele tiver dados reais.
  // Se a aba existir só com cabeçalho, faz fallback automático para a ABA_DADOS.
  var shDetalhe = getFonteSheet_(fonte, fonte.abaDetalheAlunos);
  var shDados = getFonteSheet_(fonte, fonte.abaDados);
  var sh = (shDetalhe && shDetalhe.getLastRow() > 1) ? shDetalhe : shDados;

  if (!sh || sh.getLastRow() < 2) return null;

  var cacheKey = ['alunos_fonte_v1', fonte.key, fonte.spreadsheetId, filtros.unidade || 'TODAS', anoBanco || 'TODOS', filtros.turma || 'TODAS', filtros.disciplina || 'TODAS', filtros.tipo || 'TODOS', filtros.resposta || 'TODAS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];

  var isDetalhe = idx_(h, ['ALUNO']) !== -1 && idx_(h, ['RESPOSTA']) !== -1 && idx_(h, ['EIXO']) !== -1;
  var idx = isDetalhe ? {
    unidade: idx_(h, ['UNIDADE']),
    ano: idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']),
    turma: idx_(h, ['TURMA']),
    ra: idx_(h, ['RA', 'REMA - ALUNO']),
    nome: idx_(h, ['ALUNO', 'NOME DO ALUNO']),
    disciplina: idx_(h, ['DISCIPLINA']),
    eixo: idx_(h, ['EIXO']),
    resposta: idx_(h, ['RESPOSTA']),
    valor: idx_(h, ['VALOR_RESPOSTA'])
  } : _getIndicesAvaliacaoFonte_(h);

  var alunosMap = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = cleanUnit_(safeCell_(row, idx.unidade));
    var ano = anoParaBanco_(safeCell_(row, idx.ano));
    var t = String(safeCell_(row, idx.turma) || '').trim().toUpperCase();
    var ra = String(safeCell_(row, idx.ra) || '').trim().replace(/\.0$/, '');
    var nome = String(safeCell_(row, idx.nome) || '').trim();
    var disc = isDetalhe ? String(safeCell_(row, idx.disciplina) || '').trim() : normalizarDisciplina_(safeCell_(row, idx.disciplina));
    var eixo = String(safeCell_(row, idx.eixo) || '').trim().toUpperCase();
    var resposta = isDetalhe ? String(safeCell_(row, idx.resposta) || '').trim() : labelRespostaPainel_(eixo, safeCell_(row, idx.valor), safeCell_(row, idx.resposta));

    if (!u || !ano || !t || !nome || !disc || !eixo) continue;
    if (filtros.unidade && filtros.unidade !== 'TODAS' && u !== filtros.unidade) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (filtros.turma && filtros.turma !== 'TODAS' && t !== filtros.turma) continue;
    if (filtros.disciplina && filtros.disciplina !== 'TODAS' && disc !== filtros.disciplina) continue;
    if (filtros.tipo && filtros.tipo !== 'TODOS' && eixo !== filtros.tipo) continue;
    if (filtros.resposta && filtros.resposta !== 'TODAS' && resposta !== filtros.resposta) continue;

    var k = (ra || nome) + '|' + u + '|' + ano + '|' + t + '|' + eixo + '|' + resposta;
    alunosMap[k] = { u: u, a: ano, t: t, ra: ra, n: nome, disciplina: disc, tipo: eixo, resposta: resposta };
  }

  var alunos = Object.keys(alunosMap).map(function(k) { return alunosMap[k]; });
  alunos.sort(function(a, b) { return a.u.localeCompare(b.u) || a.a.localeCompare(b.a) || a.t.localeCompare(b.t) || a.n.localeCompare(b.n); });

  var result = { ok: true, source: 'fonte_detalhe', alunos: alunos };
  cachePut_(cacheKey, result, 21600);
  return result;
}

function _getDetalheEixoResumoFonte_(fonte, filtros) {
  var anoBanco = anoParaBanco_(filtros.ano || '');
  var sh = getFonteSheet_(fonte, fonte.abaResumoPerguntas);
  if (!sh || sh.getLastRow() < 2) return null;

  var eixoFiltro = String(filtros.eixo || '').trim().toUpperCase();
  var cacheKey = ['det_fonte_v1', fonte.key, fonte.spreadsheetId, filtros.unidade || 'TODAS', anoBanco || 'TODOS', filtros.turma || 'TODAS', filtros.disciplina || 'TODAS', eixoFiltro || 'TODOS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];

  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iD = idx_(h, ['DISCIPLINA']);
  var iE = idx_(h, ['EIXO']);
  var iFqs = idx_(h, ['FQS', 'PERGUNTA']);
  var iResp = idx_(h, ['RESPOSTA']);
  var iQtd = idx_(h, ['QTD']);

  var perguntas = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = String(safeCell_(row, iU) || '').trim();
    var ano = anoParaBanco_(safeCell_(row, iAno));
    var t = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var disc = String(safeCell_(row, iD) || '').trim();
    var eixo = String(safeCell_(row, iE) || '').trim().toUpperCase();
    var fqs = String(safeCell_(row, iFqs) || eixo).trim();
    var resp = String(safeCell_(row, iResp) || '').trim() || 'Não Avaliado';
    var qtd = Number(safeCell_(row, iQtd) || 0);

    if (!qtd) continue;
    if (filtros.unidade && filtros.unidade !== 'TODAS' && u !== filtros.unidade) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (filtros.turma && filtros.turma !== 'TODAS' && t !== filtros.turma) continue;
    if (filtros.disciplina && filtros.disciplina !== 'TODAS' && disc !== filtros.disciplina) continue;
    if (eixoFiltro && eixoFiltro !== 'TODOS' && eixo !== eixoFiltro) continue;

    var pk = normalizeKey_(fqs).substring(0, 120) || 'QUESTAO';
    if (!perguntas[pk]) perguntas[pk] = { label: fqs, contagem: {} };
    perguntas[pk].contagem[resp] = (perguntas[pk].contagem[resp] || 0) + qtd;
  }

  var result = { ok: true, source: 'fonte_resumo_perguntas', perguntas: perguntas };
  cachePut_(cacheKey, result, 21600);
  return result;
}

// =======================================================
// FALLBACK RAW — mantém compatibilidade com o formato antigo
// =======================================================
function _getRawBimestreSheet_(key) {
  var fonte = getFonteAvaliacao_(key);
  if (fonte) {
    var shFonte = getFonteSheet_(fonte, fonte.abaDados);
    if (shFonte) return shFonte;
  }
  var sheetName = AVALIACAO_SHEETS[key] || key;
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}

function _getAvaliacaoBimestreRaw_(key, filtros) {
  filtros = filtros || {};
  var sh = _getRawBimestreSheet_(key);
  if (!sh) return { ok: false, message: 'Fonte/aba do bimestre não encontrada.', disciplinas: [], unidades: [], anos: [], turmas: [], alunosTotal: 0, resumo: {} };
  if (sh.getLastRow() < 2) return { ok: true, disciplinas: [], unidades: [], anos: [], turmas: [], alunosTotal: 0, resumo: {} };

  var anoBanco = anoParaBanco_(filtros.ano || '');
  var cacheKey = ['bim_raw_v2', key, sh.getParent().getId(), sh.getName(), sh.getLastRow(), filtros.unidade || 'TODAS', anoBanco || 'TODOS', filtros.turma || 'TODAS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];
  var idx = _getIndicesAvaliacaoFonte_(h);

  var disciplinas = {}, unidades = {}, anos = {}, turmas = {}, alunos = {}, resumo = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = cleanUnit_(safeCell_(row, idx.unidade));
    var ano = anoParaBanco_(safeCell_(row, idx.ano));
    var t = String(safeCell_(row, idx.turma) || '').trim().toUpperCase();
    var ra = String(safeCell_(row, idx.ra) || '').trim().replace(/\.0$/, '');
    var nome = String(safeCell_(row, idx.nome) || '').trim();
    var disc = normalizarDisciplina_(safeCell_(row, idx.disciplina));
    var eixo = String(safeCell_(row, idx.eixo) || '').trim().toUpperCase();
    var resp = labelRespostaPainel_(eixo, safeCell_(row, idx.valor), safeCell_(row, idx.resposta));

    if (!u || !ano || !t || !nome || !disc || !eixo) continue;
    unidades[u] = true; anos[ano] = true; turmas[t] = true;
    if (filtros.unidade && filtros.unidade !== 'TODAS' && u !== filtros.unidade) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (filtros.turma && filtros.turma !== 'TODAS' && t !== filtros.turma) continue;

    disciplinas[disc] = true;
    alunos[(ra || nome) + '|' + u + '|' + ano + '|' + t] = true;
    if (!resumo[disc]) resumo[disc] = {};
    if (!resumo[disc][eixo]) resumo[disc][eixo] = {};
    resumo[disc][eixo][resp] = (resumo[disc][eixo][resp] || 0) + 1;
  }

  var result = { ok: true, source: 'raw_fallback', disciplinas: Object.keys(disciplinas).sort(), unidades: Object.keys(unidades).sort(), anos: Object.keys(anos).sort(), turmas: Object.keys(turmas).sort(), alunosTotal: Object.keys(alunos).length, resumo: resumo, generatedAt: new Date().toISOString() };
  cachePut_(cacheKey, result, 21600);
  return result;
}

function _getHierarquiaRaw_(key, filtros) {
  filtros = filtros || {};
  var sh = _getRawBimestreSheet_(key);
  if (!sh || sh.getLastRow() < 2) return { ok: true, arvore: {} };
  var anoBanco = anoParaBanco_(filtros.ano || '');
  var cacheKey = ['hier_raw_v2', key, sh.getParent().getId(), sh.getName(), sh.getLastRow(), anoBanco || 'TODOS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];
  var idx = _getIndicesAvaliacaoFonte_(h);
  var temp = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = cleanUnit_(safeCell_(row, idx.unidade));
    var ano = anoParaBanco_(safeCell_(row, idx.ano));
    var t = String(safeCell_(row, idx.turma) || '').trim().toUpperCase();
    var ra = String(safeCell_(row, idx.ra) || '').trim().replace(/\.0$/, '');
    var nome = String(safeCell_(row, idx.nome) || '').trim();
    if (!u || !ano || !t || !nome) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (!temp[u]) temp[u] = {};
    if (!temp[u][t]) temp[u][t] = {};
    temp[u][t][(ra || nome)] = true;
  }

  var arvore = {};
  Object.keys(temp).forEach(function(u) {
    arvore[u] = {};
    Object.keys(temp[u]).forEach(function(t) { arvore[u][t] = Object.keys(temp[u][t]).length; });
  });
  var result = { ok: true, source: 'raw_fallback', arvore: arvore };
  cachePut_(cacheKey, result, 21600);
  return result;
}

function _getAlunosPorRespostaRaw_(key, filtros) {
  var fonte = getFonteAvaliacao_(key);
  if (fonte) return _getAlunosPorRespostaFonte_(fonte, filtros) || { ok: true, alunos: [] };
  return { ok: true, alunos: [] };
}

function _getDetalheEixoRaw_(key, filtros) {
  var sh = _getRawBimestreSheet_(key);
  if (!sh || sh.getLastRow() < 2) return { ok: true, perguntas: {} };
  var fonteFake = { key: key, spreadsheetId: sh.getParent().getId(), abaResumoPerguntas: '', abaDetalheAlunos: sh.getName(), abaDados: sh.getName() };
  // Sem Resumo_Perguntas, monta via Detalhe/Raw lendo a base.
  return _getDetalheEixoRawSheet_(sh, filtros);
}

function _getDetalheEixoRawSheet_(sh, filtros) {
  filtros = filtros || {};
  var anoBanco = anoParaBanco_(filtros.ano || '');
  var eixoFiltro = String(filtros.eixo || '').trim().toUpperCase();
  var cacheKey = ['det_raw_v2', sh.getParent().getId(), sh.getName(), sh.getLastRow(), filtros.unidade || 'TODAS', anoBanco || 'TODOS', filtros.turma || 'TODAS', filtros.disciplina || 'TODAS', eixoFiltro || 'TODOS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];
  var idx = _getIndicesAvaliacaoFonte_(h);
  var perguntas = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = cleanUnit_(safeCell_(row, idx.unidade));
    var ano = anoParaBanco_(safeCell_(row, idx.ano));
    var t = String(safeCell_(row, idx.turma) || '').trim().toUpperCase();
    var disc = normalizarDisciplina_(safeCell_(row, idx.disciplina));
    var eixo = String(safeCell_(row, idx.eixo) || '').trim().toUpperCase();
    var fqs = String(safeCell_(row, idx.pergunta) || eixo).trim();
    var resp = labelRespostaPainel_(eixo, safeCell_(row, idx.valor), safeCell_(row, idx.resposta));

    if (!u || !ano || !t || !disc || !eixo) continue;
    if (filtros.unidade && filtros.unidade !== 'TODAS' && u !== filtros.unidade) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (filtros.turma && filtros.turma !== 'TODAS' && t !== filtros.turma) continue;
    if (filtros.disciplina && filtros.disciplina !== 'TODAS' && disc !== filtros.disciplina) continue;
    if (eixoFiltro && eixoFiltro !== 'TODOS' && eixo !== eixoFiltro) continue;

    var pk = normalizeKey_(fqs).substring(0, 120) || 'QUESTAO';
    if (!perguntas[pk]) perguntas[pk] = { label: fqs, contagem: {} };
    perguntas[pk].contagem[resp] = (perguntas[pk].contagem[resp] || 0) + 1;
  }

  var result = { ok: true, source: 'raw_fallback', perguntas: perguntas };
  cachePut_(cacheKey, result, 21600);
  return result;
}
