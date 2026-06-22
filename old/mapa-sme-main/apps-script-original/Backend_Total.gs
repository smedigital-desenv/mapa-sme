/**
 * =====================================================================
 * Backend_Total.gs — Total com suporte a multiplanilhas e resumos estáticos
 * =====================================================================
 * Usa:
 * - Diagnóstica atual via getResumoDiagnostica_(), quando disponível.
 * - Bimestres externos via CONFIG_FONTES + Resumo_Filtros.
 * - Fallback para resumos antigos do PropertiesService ou base completa.
 * =====================================================================
 */

function getTotalAvaliacoesRapido(filtros) {
  filtros = filtros || {};

  // Compatibilidade de produção: o front usa esta função estável para pedir
  // o pacote compacto do Total sem depender de uma função nova no google.script.run.
  if (filtros.__pacote === true) {
    return getPacoteTotalRapido({ ano: filtros.ano || 'TODOS' });
  }

  var anoBanco = anoParaBanco_(filtros.ano || '');
  var cacheKey = ['total_multi_v2_norm', filtros.unidade || 'TODAS', anoBanco || 'TODOS', filtros.turma || 'TODAS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var mapa = {};

  function setMedia(disciplina, tipo, campo, media) {
    if (!disciplina || !tipo || media === null || media === undefined || isNaN(media)) return;

    disciplina = (typeof normalizarDisciplina_ === 'function')
      ? normalizarDisciplina_(disciplina)
      : String(disciplina || '').trim();

    tipo = _normalizarEixoTotal_(tipo);

    var k = disciplina + '||' + tipo;
    if (!mapa[k]) mapa[k] = { disciplina: disciplina, tipo: tipo, diag: null, b1: null, b2: null, b3: null, b4: null };
    mapa[k][campo] = Math.round(Number(media) * 100) / 100;
  }

  // Diagnóstica — atualmente é Língua Portuguesa.
  try {
    var diagResumo = typeof getResumoDiagnostica_ === 'function' ? getResumoDiagnostica_() : null;
    if (diagResumo && diagResumo.ok) {
      var objDiag = _selecionarResumoDiagnosticaTotal_(diagResumo, filtros, anoBanco);
      Object.keys(objDiag || {}).forEach(function(eixo) {
        setMedia('Língua Portuguesa', eixo, 'diag', _mediaPorContagemRotulos_(eixo, objDiag[eixo]));
      });
    }
  } catch (e) {
    // Diagnóstica não pode travar o Total.
  }

  var bimestres = [
    { key: 'primeiroBimestre', campo: 'b1' },
    { key: 'segundoBimestre',  campo: 'b2' },
    { key: 'terceiroBimestre', campo: 'b3' },
    { key: 'quartoBimestre',   campo: 'b4' }
  ];

  bimestres.forEach(function(b) {
    var added = _addTotalFonteResumo_(b.key, b.campo, filtros, anoBanco, setMedia);
    if (!added) _addTotalFallbackAntigo_(b.key, b.campo, filtros, anoBanco, setMedia);
  });

  var linhas = Object.keys(mapa).map(function(k) { return mapa[k]; });
  linhas.sort(function(a, b) { return a.disciplina.localeCompare(b.disciplina) || a.tipo.localeCompare(b.tipo); });

  var disciplinas = {};
  var tipos = {};
  linhas.forEach(function(l) { disciplinas[l.disciplina] = true; tipos[l.tipo] = true; });

  var result = {
    ok: true,
    linhas: linhas,
    disciplinas: Object.keys(disciplinas).sort(),
    tipos: Object.keys(tipos).sort(),
    generatedAt: new Date().toISOString(),
    source: 'multi_resumo'
  };

  cachePut_(cacheKey, result, 21600);
  return result;
}

function _addTotalFonteResumo_(key, campo, filtros, anoBanco, setMedia) {
  var fonte = getFonteAvaliacao_(key);
  if (!fonte || !fonteTemResumos_(fonte)) return false;

  var sh = getFonteSheet_(fonte, fonte.abaResumoFiltros);
  if (!sh || sh.getLastRow() < 2) return false;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];

  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iD = idx_(h, ['DISCIPLINA']);
  var iE = idx_(h, ['EIXO']);
  var iValor = idx_(h, ['VALOR_RESPOSTA']);
  var iQtd = idx_(h, ['QTD']);
  var iResp = idx_(h, ['RESPOSTA']);

  var ag = {};
  var encontrou = false;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var u = String(safeCell_(row, iU) || '').trim();
    var ano = anoParaBanco_(safeCell_(row, iAno));
    var t = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var disc = String(safeCell_(row, iD) || '').trim();
    var eixo = String(safeCell_(row, iE) || '').trim();
    var resp = String(safeCell_(row, iResp) || '').trim();
    var valor = _numResumo_(safeCell_(row, iValor));
    var qtd = Number(safeCell_(row, iQtd) || 0);

    if (!qtd || !disc || !eixo) continue;
    if (filtros.unidade && filtros.unidade !== 'TODAS' && u !== filtros.unidade) continue;
    if (anoBanco && ano !== anoBanco) continue;
    if (filtros.turma && filtros.turma !== 'TODAS' && t !== filtros.turma) continue;

    if (valor === null || isNaN(valor)) {
      valor = _valorNumericoRotuloTotal_(eixo, resp);
    }

    if (valor === null || isNaN(valor)) continue;

    encontrou = true;
    var k = disc + '||' + eixo;
    if (!ag[k]) ag[k] = { disciplina: disc, tipo: eixo, soma: 0, qtd: 0 };
    ag[k].soma += valor * qtd;
    ag[k].qtd += qtd;
  }

  Object.keys(ag).forEach(function(k) {
    var it = ag[k];
    if (it.qtd) setMedia(it.disciplina, it.tipo, campo, it.soma / it.qtd);
  });

  return encontrou;
}

function _addTotalFallbackAntigo_(key, campo, filtros, anoBanco, setMedia) {
  try {
    if (typeof getResumoBimestre_ === 'function') {
      var resumo = getResumoBimestre_(key);
      if (resumo && resumo.ok) {
        var obj = _selecionarResumoBimestreTotal_(key, resumo, filtros, anoBanco);
        Object.keys(obj || {}).forEach(function(disc) {
          Object.keys(obj[disc] || {}).forEach(function(eixo) {
            setMedia(disc, eixo, campo, _mediaPorContagemRotulos_(eixo, obj[disc][eixo]));
          });
        });
        return true;
      }
    }
  } catch (e) {}

  // Último fallback: usa a API de bimestre, que por sua vez pode ler raw.
  try {
    var res = getAvaliacaoBimestreRapida(key, filtros);
    if (!res || !res.ok) return false;
    Object.keys(res.resumo || {}).forEach(function(disc) {
      Object.keys(res.resumo[disc] || {}).forEach(function(eixo) {
        setMedia(disc, eixo, campo, _mediaPorContagemRotulos_(eixo, res.resumo[disc][eixo]));
      });
    });
    return true;
  } catch (err) {
    return false;
  }
}

function _selecionarResumoBimestreTotal_(key, resumo, filtros, anoBanco) {
  filtros = filtros || {};

  if (filtros.unidade && filtros.unidade !== 'TODAS' && filtros.turma && filtros.turma !== 'TODAS' && !anoBanco) {
    if (typeof getResumoBimestreTurma_ === 'function') {
      var turma = getResumoBimestreTurma_(key, filtros.unidade, filtros.turma);
      if (turma && turma.ok) return turma.resumo || {};
    }
  }

  if (filtros.unidade && filtros.unidade !== 'TODAS' && !anoBanco && (!filtros.turma || filtros.turma === 'TODAS')) {
    return (resumo.unidades || {})[filtros.unidade] || {};
  }

  if (anoBanco && (!filtros.unidade || filtros.unidade === 'TODAS') && (!filtros.turma || filtros.turma === 'TODAS')) {
    return (resumo.anos || {})[anoBanco] || {};
  }

  if ((!filtros.unidade || filtros.unidade === 'TODAS') && !anoBanco && (!filtros.turma || filtros.turma === 'TODAS')) {
    return resumo.rede || {};
  }

  if (filtros.unidade && filtros.unidade !== 'TODAS' && filtros.turma && filtros.turma !== 'TODAS') {
    if (typeof getResumoBimestreTurma_ === 'function') {
      var t = getResumoBimestreTurma_(key, filtros.unidade, filtros.turma);
      if (t && t.ok) return t.resumo || {};
    }
  }

  if (filtros.unidade && filtros.unidade !== 'TODAS') return (resumo.unidades || {})[filtros.unidade] || {};
  if (anoBanco) return (resumo.anos || {})[anoBanco] || {};
  return resumo.rede || {};
}

function _selecionarResumoDiagnosticaTotal_(diag, filtros, anoBanco) {
  filtros = filtros || {};
  if (filtros.unidade && filtros.unidade !== 'TODAS' && !anoBanco) return (diag.unidades || {})[filtros.unidade] || {};
  if (anoBanco && (!filtros.unidade || filtros.unidade === 'TODAS')) return (diag.anos || {})[anoBanco] || {};
  if (filtros.unidade && filtros.unidade !== 'TODAS') return (diag.unidades || {})[filtros.unidade] || {};
  if (anoBanco) return (diag.anos || {})[anoBanco] || {};
  return diag.rede || {};
}

function _valorNumericoRotuloTotal_(eixo, rotulo) {
  var r = String(rotulo || '').trim();
  var n = normalizeKey_(r);

  if (!r || n === 'NAO AVALIADO' || n === 'SEM DADO') return null;
  if (n === 'SIM') return 1;
  if (n === 'NAO') return 0;

  var escrita = { 'PRE-SILABICA': 1, 'SILABICA': 2, 'SILABICO-ALF.': 3, 'SILABICO-ALFABETICA': 3, 'ALFABETICA': 4, 'ORTOGRAFICA': 5 };
  if (escrita[n] !== undefined) return escrita[n];

  var leitura = { 'N1 PRE-LEITOR': 1, 'N2 PRE-LEITOR': 2, 'N3 PRE-LEITOR': 3, 'N4 PRE-LEITOR': 4, 'L. INICIANTE': 5, 'L. FLUENTE': 6 };
  if (leitura[n] !== undefined) return leitura[n];

  if (n === 'NAO PRODUZ') return null;
  var mNivel = n.match(/NIVEL\s*(\d+)/);
  if (mNivel) return parseFloat(mNivel[1]);

  var aee = { 'DEPENDENTE': 1, 'APOIO FREQUENTE': 2, 'APOIO LEVE': 3, 'AUTONOMO': 4 };
  if (aee[n] !== undefined) return aee[n];

  var num = parseFloat(String(r).replace(',', '.'));
  return isNaN(num) ? null : num;
}

function _mediaPorContagemRotulos_(eixo, contagem) {
  contagem = contagem || {};
  var soma = 0;
  var total = 0;

  Object.keys(contagem).forEach(function(rot) {
    var v = _valorNumericoRotuloTotal_(eixo, rot);
    var qtd = Number(contagem[rot] || 0);
    if (v !== null && !isNaN(v) && qtd > 0) {
      soma += v * qtd;
      total += qtd;
    }
  });

  if (!total) return null;
  return Math.round((soma / total) * 100) / 100;
}

function getHierarquiaTotal(filtros) {
  filtros = filtros || {};
  var anoBanco = anoParaBanco_(filtros.ano || '');
  var cacheKey = ['hier_total_multi_v1', anoBanco || 'TODOS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var bims = ['primeiroBimestre', 'segundoBimestre', 'terceiroBimestre', 'quartoBimestre'];
  var arvore = {};

  for (var i = 0; i < bims.length; i++) {
    var fonte = getFonteAvaliacao_(bims[i]);
    if (fonte && fonteTemResumos_(fonte)) {
      var h = _getHierarquiaResumoFonte_(fonte, { ano: filtros.ano || 'TODOS' });
      if (h && h.ok && Object.keys(h.arvore || {}).length) {
        arvore = h.arvore;
        break;
      }
    }
  }

  if (!Object.keys(arvore).length) {
    try {
      var resumo = typeof getResumoBimestre_ === 'function' ? getResumoBimestre_('primeiroBimestre') : null;
      if (resumo && resumo.ok && resumo.arvore) arvore = resumo.arvore;
    } catch (e) {}
  }

  if (!Object.keys(arvore).length) {
    try {
      var diag = typeof getResumoDiagnostica_ === 'function' ? getResumoDiagnostica_() : null;
      if (diag && diag.ok && diag.arvore) arvore = diag.arvore;
    } catch (e2) {}
  }

  var result = { ok: true, arvore: arvore || {} };
  cachePut_(cacheKey, result, 21600);
  return result;
}

function getTotalAvaliacoesData() {
  return getTotalAvaliacoesRapido({ unidade: 'TODAS', ano: 'TODOS', turma: 'TODAS' });
}

function getTotalTurmasDaUnidade(filtros) {
  filtros = filtros || {};

  var unidade = filtros.unidade || 'TODAS';
  var ano = filtros.ano || 'TODOS';

  if (!unidade || unidade === 'TODAS') {
    return { ok: false, message: 'Unidade não informada.', turmas: {} };
  }

  var anoBanco = anoParaBanco_(ano || '');
  var cacheKey = ['total_turmas_unidade_multi_v1', unidade, anoBanco || 'TODOS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var hier = getHierarquiaTotal({ ano: ano || 'TODOS' });
  var arv = hier && hier.ok ? (hier.arvore || {}) : {};
  var turmasObj = arv[unidade] || {};
  var turmas = Object.keys(turmasObj).sort();

  var result = {
    ok: true,
    unidade: unidade,
    ano: ano || 'TODOS',
    unidadeResumo: getTotalAvaliacoesRapido({ unidade: unidade, ano: ano || 'TODOS', turma: 'TODAS' }),
    turmas: {},
    turmasLista: turmas,
    generatedAt: new Date().toISOString()
  };

  turmas.forEach(function(turma) {
    result.turmas[turma] = getTotalAvaliacoesRapido({ unidade: unidade, ano: ano || 'TODOS', turma: turma });
  });

  cachePut_(cacheKey, result, 21600);
  return result;
}


/**
 * =====================================================================
 * PACOTE TOTAL RÁPIDO — v2
 * =====================================================================
 * Retorna dados compactos para o front filtrar unidade/turma localmente.
 * Formato de cada linha:
 * [UNIDADE, ANO, TURMA, DISCIPLINA, EIXO, PERIODO, SOMA_VALOR, QTD]
 * PERIODO: diag, b1, b2, b3, b4
 */
function getPacoteTotalRapido(filtrosBase) {
  filtrosBase = filtrosBase || {};
  var anoBanco = anoParaBanco_(filtrosBase.ano || '');
  var cacheKey = ['pacote_total_multi_v3_norm', anoBanco || 'TODOS'].join('_');
  var cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var linhas = [];

  try {
    _addPacoteTotalDiagnostica_(linhas, anoBanco);
  } catch (e) {
    Logger.log('Pacote Total: erro ao adicionar Diagnóstica: ' + e);
  }

  var bimestres = [
    { key: 'primeiroBimestre', campo: 'b1' },
    { key: 'segundoBimestre',  campo: 'b2' },
    { key: 'terceiroBimestre', campo: 'b3' },
    { key: 'quartoBimestre',   campo: 'b4' }
  ];

  bimestres.forEach(function(b) {
    try {
      var ok = _addPacoteTotalFonteResumo_(b.key, b.campo, linhas, anoBanco);
      if (!ok) _addPacoteTotalFallbackResumo_(b.key, b.campo, linhas, anoBanco);
    } catch (e) {
      Logger.log('Pacote Total: erro em ' + b.key + ': ' + e);
    }
  });

  var result = {
    ok: true,
    linhas: linhas,
    generatedAt: new Date().toISOString(),
    source: 'pacote_total_multi_v3_norm'
  };

  cachePut_(cacheKey, result, 21600);
  return result;
}


function _normalizarEixoTotal_(eixo) {
  var raw = String(eixo || '').trim();
  if (!raw) return '';

  var n = normalizeKey_(raw);

  if (n.indexOf('PRODUCAO') !== -1 || n.indexOf('TEXTUAL') !== -1) return 'PRODUÇÃO TEXTUAL';
  if (n.indexOf('LEITURA') !== -1) return 'LEITURA';
  if (n.indexOf('ESCRITA') !== -1) return 'ESCRITA';
  if (n.indexOf('ORALIDADE') !== -1) return 'ORALIDADE';
  if (n.indexOf('COMPLEMENTAR') !== -1) return 'COMPLEMENTAR';

  // AEE e demais eixos permanecem legíveis, mas sem duplicidade por caixa/acentuação.
  return raw.toUpperCase();
}

function _pushPacoteTotal_(linhas, unidade, ano, turma, disciplina, eixo, periodo, valor, qtd) {
  qtd = Number(qtd || 0);
  valor = Number(valor);
  if (!qtd || !disciplina || !eixo || isNaN(valor)) return;

  disciplina = (typeof normalizarDisciplina_ === 'function')
    ? normalizarDisciplina_(disciplina)
    : String(disciplina || '').trim();

  eixo = _normalizarEixoTotal_(eixo);

  linhas.push([
    cleanUnit_(unidade),
    String(ano || '').replace(/[º°]/g, '').trim().toUpperCase(),
    String(turma || '').trim().toUpperCase(),
    disciplina,
    eixo,
    periodo,
    Math.round((valor * qtd) * 100) / 100,
    qtd
  ]);
}

function _addPacoteTotalFonteResumo_(key, periodo, linhas, anoBanco) {
  var fonte = getFonteAvaliacao_(key);
  if (!fonte || !fonteTemResumos_(fonte)) return false;

  var sh = getFonteSheet_(fonte, fonte.abaResumoFiltros);
  if (!sh || sh.getLastRow() < 2) return false;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];

  var iU = idx_(h, ['UNIDADE']);
  var iAno = idx_(h, ['ANO_ESCOLAR', 'ANO ESCOLAR']);
  var iT = idx_(h, ['TURMA']);
  var iD = idx_(h, ['DISCIPLINA']);
  var iE = idx_(h, ['EIXO']);
  var iResp = idx_(h, ['RESPOSTA']);
  var iValor = idx_(h, ['VALOR_RESPOSTA']);
  var iQtd = idx_(h, ['QTD']);

  var encontrou = false;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var ano = anoParaBanco_(safeCell_(row, iAno));
    if (anoBanco && ano !== anoBanco) continue;

    var disc = String(safeCell_(row, iD) || '').trim();
    var eixo = String(safeCell_(row, iE) || '').trim();
    var resp = String(safeCell_(row, iResp) || '').trim();
    var qtd = Number(safeCell_(row, iQtd) || 0);
    if (!qtd || !disc || !eixo) continue;

    var valor = _numResumo_(safeCell_(row, iValor));
    if (valor === null || isNaN(valor)) valor = _valorNumericoRotuloTotal_(eixo, resp);
    if (valor === null || isNaN(valor)) continue;

    encontrou = true;
    _pushPacoteTotal_(
      linhas,
      safeCell_(row, iU),
      safeCell_(row, iAno),
      safeCell_(row, iT),
      disc,
      eixo,
      periodo,
      valor,
      qtd
    );
  }

  return encontrou;
}

function _addPacoteTotalFallbackResumo_(key, periodo, linhas, anoBanco) {
  try {
    var res = getAvaliacaoBimestreRapida(key, { unidade: 'TODAS', ano: anoBanco || 'TODOS', turma: 'TODAS' });
    if (!res || !res.ok) return false;

    Object.keys(res.resumo || {}).forEach(function(disc) {
      Object.keys(res.resumo[disc] || {}).forEach(function(eixo) {
        var cont = res.resumo[disc][eixo] || {};
        Object.keys(cont).forEach(function(resp) {
          var qtd = Number(cont[resp] || 0);
          var valor = _valorNumericoRotuloTotal_(eixo, resp);
          if (valor !== null && !isNaN(valor)) {
            _pushPacoteTotal_(linhas, 'TODAS', anoBanco || 'TODOS', 'TODAS', disc, eixo, periodo, valor, qtd);
          }
        });
      });
    });
    return true;
  } catch (e) {
    return false;
  }
}

function _addPacoteTotalDiagnostica_(linhas, anoBanco) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Alunos');
  if (!sh || sh.getLastRow() < 2) return false;

  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var h = data[0];

  var iU = idx_(h, ['UNIDADE', 'ESCOLA', 'UNIDADE ESCOLAR']);
  var iAno = idx_(h, ['ANO ESCOLAR', 'ANO', 'SÉRIE', 'SERIE']);
  var iT = idx_(h, ['TURMA', 'CLASSE']);
  var iFne = idx_(h, ['DESCRIÇÃO FNE', 'DESCRICAO FNE', 'FNE', 'EIXO']);
  var iVl = idx_(h, ['VL. RESPOSTA', 'VL RESPOSTA', 'VALOR RESPOSTA', 'VALOR']);
  var iResp = idx_(h, ['TEXTO RESPOSTA', 'RESPOSTA']);

  var ag = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var unidade = cleanUnit_(safeCell_(row, iU));
    var ano = String(safeCell_(row, iAno) || '').replace(/[º°]/g, '').trim().toUpperCase();
    if (anoBanco && anoParaBanco_(ano) !== anoBanco) continue;

    var turma = String(safeCell_(row, iT) || '').trim().toUpperCase();
    var fneRaw = String(safeCell_(row, iFne) || '').trim();
    var fne = normalizeKey_(fneRaw);
    var eixo = '';

    if (fne.indexOf('ESCRITA') !== -1) eixo = 'ESCRITA';
    else if (fne.indexOf('LEITURA') !== -1) eixo = 'LEITURA';
    else if (fne.indexOf('PRODUCAO') !== -1 || fne.indexOf('TEXTUAL') !== -1) eixo = 'PRODUÇÃO TEXTUAL';
    else continue;

    var vl = normVl_(safeCell_(row, iVl));
    if (!vl) vl = normVl_(safeCell_(row, iResp));

    var label = labelCurto_(eixo, vl);
    var valor = _valorNumericoRotuloTotal_(eixo, label);
    if (valor === null || isNaN(valor)) continue;

    var k = [unidade, ano, turma, eixo, valor].join('||');
    if (!ag[k]) ag[k] = { u: unidade, a: ano, t: turma, e: eixo, v: valor, q: 0 };
    ag[k].q++;
  }

  Object.keys(ag).forEach(function(k) {
    var it = ag[k];
    _pushPacoteTotal_(linhas, it.u, it.a, it.t, 'Língua Portuguesa', it.e, 'diag', it.v, it.q);
  });

  return true;
}
