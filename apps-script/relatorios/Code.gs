// ════════════════════════════════════════════════════════════════
//  Code.gs — Relatório por Escola + Análise Gemini
//  Módulo de Relatórios para MAPA-SME
// ════════════════════════════════════════════════════════════════

// Coluna de regional nos formulários de visita — mantida para leitura das visitas existentes
var COL_REGIONAL_ = "Marque a Regional a qual pertente a unidade escolar.";

// ── Modo 1: Acessar como Web App (com interface) ──
function doGet() {
  return HtmlService.createTemplateFromFile('relatorios')
    .evaluate()
    .setTitle('Relatórios de Acompanhamento')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Modo 2: Acessar como API (para chamadas externas) ──
function doPost(e) {
  try {
    const action = e.parameter.action || '';
    let resultado = {};

    switch(action) {
      case 'getDados':
        resultado = getDadosCompletos();
        break;
      case 'autenticar':
        resultado = autenticarUsuario();
        break;
      case 'analisar':
        const dadosVisita = JSON.parse(e.parameter.dados || '{}');
        resultado = analisarVisitaComGemini(dadosVisita);
        break;
      case 'salvarDevolutiva':
        const payload = JSON.parse(e.parameter.payload || '{}');
        resultado = salvarDevolutiva(payload);
        break;
      case 'lerDevolutivas':
        resultado = lerDevolutivas();
        break;
      case 'excluirDevolutiva':
        resultado = excluirDevolutiva(e.parameter.id);
        break;
      default:
        resultado = { ok: false, erro: 'Ação não reconhecida' };
    }

    // O endpoint /exec do Apps Script já envia Access-Control-Allow-Origin: *
    // automaticamente. TextOutput NÃO possui setHeader(), então não o usamos.
    return ContentService.createTextOutput(JSON.stringify(resultado))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, erro: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Verificação de administrador ─────────────────────────────────
function _obterEmailUsuario() {
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (e) {}
  return '';
}

function autenticarUsuario() {
  try {
    const email = _obterEmailUsuario();
    const logado = !!email;
    const admin  = logado && _verificarEmailAdmin(email);
    return { ok: true, email: email, isAdmin: admin, estaLogado: logado };
  } catch (e) {
    return { ok: false, email: '', isAdmin: false, estaLogado: false, erro: e.message };
  }
}

function _verificarEmailAdmin(email) {
  try {
    if (!email) return false;
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const abaAdmin = planilha.getSheetByName("Admin");
    if (!abaAdmin) return false;
    const ultLinha = abaAdmin.getLastRow();
    if (ultLinha < 2) return false;
    const emails = abaAdmin.getRange(2, 2, ultLinha - 1, 1).getValues()
      .map(r => r[0].toString().trim().toLowerCase())
      .filter(Boolean);
    return emails.includes(email.toLowerCase());
  } catch (e) {
    return false;
  }
}

function verificarAdmin() {
  return _verificarEmailAdmin(_obterEmailUsuario());
}

// ── Leitura das planilhas (Fundamental e Infantil) ───────────────
// Os dados das visitas (parte pesada) são cacheados; os campos de
// identidade do usuário são sempre calculados na hora (não cacheáveis).
function getDadosCompletos() {
  const dados = _getDadosVisitasCacheado();
  return {
    fundamental:     dados.fundamental,
    infantil:        dados.infantil,
    escolasEMEF:     dados.escolasEMEF,
    escolasEMEI:     dados.escolasEMEI,
    regionalMapEMEF: dados.regionalMapEMEF,
    regionalMapEMEI: dados.regionalMapEMEI,
    isAdmin:         verificarAdmin(),
    emailUsuario:    _obterEmailUsuario(),
    estaLogado:      !!_obterEmailUsuario()
  };
}

function _getDadosVisitasCacheado() {
  const cacheKey = 'relat_visitas_v1';
  const cached = _cacheGetChunked(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  const dados = _lerDadosVisitas();
  try { _cachePutChunked(cacheKey, JSON.stringify(dados), 300); } catch (e) {}
  return dados;
}

function _lerDadosVisitas() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const abaFund  = planilha.getSheetByName("Fundamental");
  const abaInf   = planilha.getSheetByName("Infantil");
  const abaEMEF  = planilha.getSheetByName("EMEF");
  const abaEMEI  = planilha.getSheetByName("EMEI");

  function processarAba(aba) {
    if (!aba) return [];
    const dados = aba.getDataRange().getValues();
    if (dados.length < 2) return [];
    const cabecalho = dados[0].map(c => c.toString().trim());
    const resultado = [];
    for (let i = 1; i < dados.length; i++) {
      const linha = dados[i];
      const escola = linha[5];
      if (!escola || escola.toString().trim() === "") continue;
      const obj = {};
      cabecalho.forEach((col, j) => {
        const val = linha[j];
        obj[col] = (val instanceof Date)
          ? Utilities.formatDate(val, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm")
          : (val !== null && val !== undefined ? val.toString() : "");
      });
      obj["_ESCOLA_"] = escola.toString().trim();
      resultado.push(obj);
    }
    return resultado;
  }

  // ── Lê escolas E regionais da aba de cadastro (col A = escola, col B = regional) ──
  function lerEscolasComRegional(aba) {
    if (!aba) return { lista: [], mapaRegional: {} };
    const ultLinha = aba.getLastRow();
    if (ultLinha < 2) return { lista: [], mapaRegional: {} };
    const dados = aba.getRange(2, 1, ultLinha - 1, 2).getValues();
    const lista = [];
    const mapaRegional = {};
    dados.forEach(r => {
      const escola   = r[0] ? r[0].toString().trim() : '';
      const regional = r[1] ? r[1].toString().trim() : '';
      if (!escola) return;
      lista.push(escola);
      if (regional) mapaRegional[escola] = regional;
    });
    return { lista, mapaRegional };
  }

  const emef = lerEscolasComRegional(abaEMEF);
  const emei = lerEscolasComRegional(abaEMEI);

  return {
    fundamental:     processarAba(abaFund),
    infantil:        processarAba(abaInf),
    escolasEMEF:     emef.lista,
    escolasEMEI:     emei.lista,
    regionalMapEMEF: emef.mapaRegional,
    regionalMapEMEI: emei.mapaRegional
  };
}

// ── Cache em pedaços (CacheService limita ~100KB por item) ────────
function _cacheGetChunked(key) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(key + '_meta');
  if (!meta) return null;
  const n = parseInt(meta, 10);
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const all = cache.getAll(keys);
  let out = '';
  for (let i = 0; i < n; i++) {
    const p = all[key + '_' + i];
    if (p == null) return null; // algum pedaço expirou → cache inválido
    out += p;
  }
  return out;
}

function _cachePutChunked(key, str, ttl) {
  const cache = CacheService.getScriptCache();
  const size = 90000; // < 100KB por item
  const n = Math.ceil(str.length / size);
  const obj = {};
  for (let i = 0; i < n; i++) obj[key + '_' + i] = str.substring(i * size, (i + 1) * size);
  obj[key + '_meta'] = String(n);
  cache.putAll(obj, ttl);
}

function _cacheClear(key) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(key + '_meta');
  const keys = [key + '_meta'];
  if (meta) { const n = parseInt(meta, 10); for (let i = 0; i < n; i++) keys.push(key + '_' + i); }
  cache.removeAll(keys);
}

// ── Persistência de Devolutivas ──────────────────────────────────
function _getAbaDevolutivasIndividual() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName("Devolutivas_Individual");
  if (!aba) {
    aba = planilha.insertSheet("Devolutivas_Individual");
    aba.appendRow([
      "ID","Segmento","Escola","Data da Visita","Salvo em",
      "Pontos Fortes","Pontos Fracos","Pontos de Atenção",
      "Síntese Executiva","Prioridade","Justificativa Prioridade",
      "Encaminhamentos Próxima Visita","Perguntas Próxima Visita",
      "Risco Pedagógico Nível","Risco Pedagógico Descrição",
      "Foco Formativo Sugerido"
    ]);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 16).setFontWeight("bold");
  }
  return aba;
}

function salvarDevolutiva(payload) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { ok: false, erro: "Não foi possível obter lock de escrita: " + e.message }; }
  try {
    const aba  = _getAbaDevolutivasIndividual();
    const id   = _gerarId(payload.segmento, payload.escola, payload.dataVisita);
    const savedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    const dados = aba.getDataRange().getValues();
    for (let i = dados.length - 1; i >= 1; i--) {
      if (dados[i][0] === id) aba.deleteRow(i + 1);
    }
    const d = payload.dados;
    aba.appendRow([
      id, payload.segmento, payload.escola, payload.dataVisita, savedAt,
      (d.pontos_fortes                  || []).join(" | "),
      (d.pontos_fracos                  || []).join(" | "),
      (d.pontos_atencao                 || []).join(" | "),
      d.sintese_executiva               || "",
      d.prioridade                      || "",
      d.justificativa_prioridade        || "",
      (d.encaminhamentos_proxima_visita || []).join(" | "),
      (d.perguntas_para_proxima_visita  || []).join(" | "),
      (d.risco_pedagogico               || {}).nivel    || "",
      (d.risco_pedagogico               || {}).descricao || "",
      (d.foco_formativo_sugerido        || []).join(" | ")
    ]);
    _cacheClear('relat_devolutivas_v1');
    return { ok: true, id: id };
  } catch(e) { return { ok: false, erro: e.message }; }
  finally { lock.releaseLock(); }
}

function _gerarId(segmento, escola, dataVisita) {
  const base = (segmento + "|" + escola + "|" + dataVisita).toLowerCase().replace(/\s+/g, "_");
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, base
  ).map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('').substring(0, 12);
}

function lerDevolutivas() {
  const cacheKey = 'relat_devolutivas_v1';
  const cached = _cacheGetChunked(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  const resultado = _lerDevolutivasRaw();
  if (resultado && resultado.ok) {
    try { _cachePutChunked(cacheKey, JSON.stringify(resultado), 300); } catch (e) {}
  }
  return resultado;
}

function _lerDevolutivasRaw() {
  try {
    const split = str => str ? str.split(" | ").filter(Boolean) : [];
    const registros = [];

    function montaDadosIndividual(obj) {
      return {
        pontos_fortes:                  split(obj["Pontos Fortes"]),
        pontos_fracos:                  split(obj["Pontos Fracos"]),
        pontos_atencao:                 split(obj["Pontos de Atenção"]),
        sintese_executiva:              obj["Síntese Executiva"]              || "",
        prioridade:                     obj["Prioridade"]                     || "",
        justificativa_prioridade:       obj["Justificativa Prioridade"]       || "",
        encaminhamentos_proxima_visita: split(obj["Encaminhamentos Próxima Visita"]),
        perguntas_para_proxima_visita:  split(obj["Perguntas Próxima Visita"]),
        risco_pedagogico: {
          nivel:     obj["Risco Pedagógico Nível"]     || "",
          descricao: obj["Risco Pedagógico Descrição"]  || ""
        },
        foco_formativo_sugerido: split(obj["Foco Formativo Sugerido"])
      };
    }

    const tz = Session.getScriptTimeZone();
    function lerCelula(val) {
      if (val instanceof Date) return Utilities.formatDate(val, tz, "dd/MM/yyyy HH:mm");
      return val ? val.toString() : "";
    }

    // ── Individuais ──
    const abaInd   = _getAbaDevolutivasIndividual();
    const dadosInd = abaInd.getDataRange().getValues();
    if (dadosInd.length >= 2) {
      const cab = dadosInd[0];
      for (let i = 1; i < dadosInd.length; i++) {
        const linha = dadosInd[i];
        const obj   = {};
        cab.forEach((col, j) => { obj[col] = lerCelula(linha[j]); });
        // Payload enxuto: só o que o cliente usa (as colunas planas viram _dados).
        registros.push({
          "ID":             obj["ID"]             || "",
          "Escola":         obj["Escola"]         || "",
          "Data da Visita": obj["Data da Visita"] || "",
          "Segmento":       obj["Segmento"]       || "",
          "Salvo em":       obj["Salvo em"]       || "",
          "Regional":       "",
          "_tipo":          "individual",
          "_dados":         montaDadosIndividual(obj)
        });
      }
    }

    return { ok: true, registros: registros };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

function excluirDevolutiva(id) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { ok: false, erro: "Lock indisponível: " + e.message }; }
  try {
    const aba = _getAbaDevolutivasIndividual();
    const dados = aba.getDataRange().getValues();
    for (let i = dados.length - 1; i >= 1; i--) {
      if (dados[i][0] === id) {
        aba.deleteRow(i + 1);
        _cacheClear('relat_devolutivas_v1');
        return { ok: true };
      }
    }
    return { ok: false, erro: "ID não encontrado" };
  } catch(e) { return { ok: false, erro: e.message }; }
  finally { lock.releaseLock(); }
}

// ── Análise Individual com Gemini ────────────────────────────────
function analisarVisitaComGemini(dadosVisita) {
  try {
    if (!verificarAdmin()) {
      return { ok: false, erro: "Acesso restrito: apenas administradores podem gerar análises." };
    }

    const unidadeEscolar = dadosVisita['_ESCOLA_'] || 'Unidade escolar não informada';
    const dataVisita = dadosVisita['Data da Visita:'] || dadosVisita['Data da visita:'] || dadosVisita['Carimbo de data/hora'] || 'Data não informada';

    // Prompt simplificado para testes (implementar gemini-api conforme necessário)
    const prompt = `Analise este registro de visita pedagógica:\n\nEscola: ${unidadeEscolar}\nData: ${dataVisita}\n\nRegistro: ${JSON.stringify(dadosVisita, null, 2)}`;

    // TODO: Chamar API Gemini (implementar _chamarGemini)
    const dados = {
      unidade_escolar: unidadeEscolar,
      data_visita: dataVisita,
      pontos_fortes: ["Exemplo de ponto forte"],
      pontos_fracos: ["Exemplo de ponto fraco"],
      pontos_atencao: ["Exemplo de ponto de atenção"],
      sintese_executiva: "Análise em desenvolvimento",
      prioridade: "média",
      justificativa_prioridade: "Análise de exemplo",
      risco_pedagogico: { nivel: "baixo", descricao: "Sem riscos identificados" },
      foco_formativo_sugerido: ["Tema de formação sugerido"]
    };

    return { ok: true, dados: dados };
  } catch (e) {
    return { ok: false, erro: "Erro ao processar análise: " + e.message };
  }
}

// ── CORS preflight ──
// O cliente usa Content-Type text/plain (requisição "simples"), portanto o
// navegador não dispara preflight OPTIONS. Mantido apenas como no-op seguro.
function doOptions(e) {
  return ContentService.createTextOutput('');
}

function autorizarScript() {
  UrlFetchApp.fetch("https://www.google.com");
}
