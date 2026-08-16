// ════════════════════════════════════════════════════════════════
//  Code.gs — Relatório por Escola + Análise Gemini
//  Módulo de Relatórios para MAPA-SME
//  Segmentos: Fundamental / Infantil (visita pedagógica)
//             Fundamental2 / Infantil2 (visita de diálogo/PPA/boas práticas)
// ════════════════════════════════════════════════════════════════

// Coluna de regional nos formulários de visita — mantida para leitura das visitas existentes.
// Os formulários "2" (Fundamental2/Infantil2) não perguntam a regional; ela é resolvida
// via mapa oficial escola → regional (abas EMEF/EMEI) nas funções que precisam dela.
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
        resultado = analisarVisitaComGemini(JSON.parse(e.parameter.dados || '{}'));
        break;
      case 'analisarRede':
        resultado = analisarRedeComGemini(JSON.parse(e.parameter.payload || '{}'));
        break;
      case 'analisarRegional':
        resultado = analisarRegionalComGemini(JSON.parse(e.parameter.payload || '{}'));
        break;
      case 'analisarRedeAPartirDeRegionais':
        resultado = analisarRedeAPartirDeRegionaisComGemini(JSON.parse(e.parameter.payload || '{}'));
        break;
      case 'salvarDevolutiva':
        resultado = salvarDevolutiva(JSON.parse(e.parameter.payload || '{}'));
        break;
      case 'salvarDevolutivaRede':
        resultado = salvarDevolutivaRede(JSON.parse(e.parameter.payload || '{}'));
        break;
      case 'salvarDevolutivaRegional':
        resultado = salvarDevolutivaRegional(JSON.parse(e.parameter.payload || '{}'));
        break;
      case 'salvarSinteseRedeGlobal':
        resultado = salvarSinteseRedeGlobal(JSON.parse(e.parameter.payload || '{}'));
        break;
      case 'lerDevolutivas':
        resultado = lerDevolutivas();
        break;
      case 'excluirDevolutiva':
        resultado = excluirDevolutiva(e.parameter.id);
        break;
      case 'chat':
        resultado = chat(e.parameter.pergunta, e.parameter.contexto, e.parameter.historico, e.parameter.usuario);
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

// ── CORS preflight ──
// O cliente usa Content-Type text/plain (requisição "simples"), portanto o
// navegador não dispara preflight OPTIONS. Mantido apenas como no-op seguro.
function doOptions(e) {
  return ContentService.createTextOutput('');
}

function autorizarScript() {
  UrlFetchApp.fetch("https://www.google.com");
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

// ── Leitura das planilhas (Fundamental/Infantil + Fundamental2/Infantil2) ──
// Os dados das visitas (parte pesada) são cacheados; os campos de
// identidade do usuário são sempre calculados na hora (não cacheáveis).
function getDadosCompletos() {
  const dados = _getDadosVisitasCacheado();
  return {
    fundamental:     dados.fundamental,
    infantil:        dados.infantil,
    fundamental2:    dados.fundamental2,
    infantil2:       dados.infantil2,
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
  const cacheKey = 'relat_visitas_v2'; // v2: inclui Fundamental2/Infantil2
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
  const abaFund2 = planilha.getSheetByName("Fundamental2");
  const abaInf2  = planilha.getSheetByName("Infantil2");
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
    fundamental2:    processarAba(abaFund2),
    infantil2:       processarAba(abaInf2),
    escolasEMEF:     emef.lista,
    escolasEMEI:     emei.lista,
    regionalMapEMEF: emef.mapaRegional,
    regionalMapEMEI: emei.mapaRegional
  };
}

// ── Helper interno: retorna visitas de um segmento (fundamental|infantil|fundamental2|infantil2) ──
function _dadosSegmento(segmento) {
  return _getDadosVisitasCacheado()[segmento] || [];
}

// Resolve a regional oficial de uma escola pelo segmento (mesmas escolas em fundamental/fundamental2
// e infantil/infantil2 — o mapa é o mesmo, cadastrado uma única vez em EMEF/EMEI).
function _mapaRegionalDoSegmento_(segmento, dadosCompletos) {
  const dados = dadosCompletos || _getDadosVisitasCacheado();
  return segmento.indexOf('infantil') === 0 ? dados.regionalMapEMEI : dados.regionalMapEMEF;
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

// ════════════════════════════════════════════════════════════════
//  UTILITÁRIOS INTERNOS — Gemini
// ════════════════════════════════════════════════════════════════

function limitarTexto_(item, maxChars) {
  const chavesFiltradas = Object.entries(item)
    .filter(([k]) => k !== "_ESCOLA_" && k !== "_SEGMENTO_")
    .map(([k, v]) => k + ": " + (v || "Não informado"))
    .join("\n");
  if (chavesFiltradas.length <= maxChars) return chavesFiltradas;
  return chavesFiltradas.substring(0, maxChars) + "\n[... conteúdo truncado por limite de tamanho ...]";
}

// ── Cache da chave ativa + retry 5xx com backoff exponencial ─────
function _chamarGemini(prompt, maxOutputTokens) {
  const propriedades = PropertiesService.getScriptProperties();
  const chavesRaw    = propriedades.getProperty("GEMINI_KEYS");

  if (!chavesRaw) {
    throw new Error("Nenhuma chave de API configurada na propriedade 'GEMINI_KEYS'.");
  }

  const poolDeChaves = chavesRaw.split(",").map(k => k.trim()).filter(Boolean);

  // Lê índice inicial do cache (evita testar chave esgotada repetidamente)
  const cache      = CacheService.getScriptCache();
  const idxCached  = parseInt(cache.get("gemini_key_idx") || "0", 10);
  const idxInicial = isNaN(idxCached) ? 0 : idxCached % poolDeChaves.length;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: maxOutputTokens || 3000,
      responseMimeType: "application/json"
    }
  };

  const MAX_RETRIES_5XX = 5; // tentativas por chave em caso de 5xx

  for (let i = 0; i < poolDeChaves.length; i++) {
    const idxChave = (idxInicial + i) % poolDeChaves.length;
    const apiKey   = poolDeChaves[idxChave];
    const url      = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" + apiKey;

    let ultimoErro = null;

    // Retry com backoff exponencial para erros 5xx
    for (let tentativa = 0; tentativa < MAX_RETRIES_5XX; tentativa++) {
      if (tentativa > 0) Utilities.sleep(1000 * Math.pow(2, tentativa - 1));

      try {
        const response    = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const statusCode  = response.getResponseCode();
        const responseText = response.getContentText();
        const jsonRetorno = JSON.parse(responseText);

        if (jsonRetorno.error) {
          const codigoErro   = jsonRetorno.error.code;
          const mensagemErro = jsonRetorno.error.message || "";

          // Cota esgotada: rotaciona chave
          if (statusCode === 429 || codigoErro === 429 || mensagemErro.includes("quota")) {
            console.warn("Chave " + (idxChave + 1) + " estourou cota. Tentando próxima...");
            // Persiste índice da próxima chave com TTL de 1h
            cache.put("gemini_key_idx", String((idxChave + 1) % poolDeChaves.length), 3600);
            ultimoErro = "quota";
            break; // sai do retry desta chave, vai pra próxima
          }

          // Erro de servidor: vale fazer retry
          if (statusCode >= 500) {
            const base = statusCode === 503 ? 3000 : 1000;
            ultimoErro = "Erro servidor [" + statusCode + "]: " + mensagemErro;
            if (tentativa < MAX_RETRIES_5XX - 1) Utilities.sleep(base * Math.pow(2, tentativa));
            continue;
          }

          // Outros erros (4xx que não sejam 429): falha definitiva
          throw new Error("Erro API Gemini [Status " + statusCode + "]: " + mensagemErro);
        }

        // Sucesso
        let texto = jsonRetorno.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        texto = texto.replace(/^```json/i, '').replace(/```$/i, '').trim();
        return JSON.parse(texto);

      } catch (e) {
        if (e.message.startsWith("Erro API Gemini")) throw e;
        ultimoErro = e.message;
        if (tentativa > 0) Utilities.sleep(3000 * Math.pow(2, tentativa - 1));
        if (tentativa < MAX_RETRIES_5XX - 1) continue;
      }
    }

    // Se saiu do retry interno por quota, continua para próxima chave do pool
    if (ultimoErro === "quota") continue;

    // Se esgotou retries de 5xx na última chave do pool
    if (i === poolDeChaves.length - 1) {
      throw new Error("Todas as chaves falharam. Último erro: " + ultimoErro);
    }
  }

  // Garante que nunca retorna undefined silenciosamente
  throw new Error("Todas as chaves de API estouraram a cota ou falharam.");
}

// ════════════════════════════════════════════════════════════════
//  CHATBOT (assistente) — usa a MESMA chave central (GEMINI_KEYS).
//  O contexto vem pronto do navegador (dados que o usuário pode ver, montados
//  pelas RPCs que já filtram por permissão). A chave nunca sai do servidor.
// ════════════════════════════════════════════════════════════════

// Variante do _chamarGemini para respostas em TEXTO (não JSON). Mesmo pool de
// chaves, rotação em caso de cota (429). Retorna o texto puro do modelo.
function _chamarGeminiTexto(prompt, maxOutputTokens) {
  const props = PropertiesService.getScriptProperties();
  const chavesRaw = props.getProperty("GEMINI_KEYS");
  if (!chavesRaw) throw new Error("Nenhuma chave de API configurada na propriedade 'GEMINI_KEYS'.");
  const pool = chavesRaw.split(",").map(k => k.trim()).filter(Boolean);
  // Modelo(s) do chat. Por padrão, SÓ o Flash Lite (mais barato/rápido, 500 req/dia
  // no gratuito). O mecanismo aceita uma LISTA (fallback entre modelos, cada um com
  // cota separada) via GEMINI_MODELOS_CHAT — mas, por decisão, o padrão é Lite puro,
  // sem cair para o Flash normal. Para trocar/estender: GEMINI_MODELOS_CHAT (lista)
  // ou GEMINI_MODELO_CHAT (um só).
  const modelosRaw = props.getProperty("GEMINI_MODELOS_CHAT")
                  || props.getProperty("GEMINI_MODELO_CHAT")
                  || "gemini-flash-lite-latest";
  const modelos = modelosRaw.split(",").map(m => m.trim()).filter(Boolean);
  const cache = CacheService.getScriptCache();
  const idxIni = (parseInt(cache.get("gemini_key_idx") || "0", 10) || 0) % pool.length;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: maxOutputTokens || 2000 }
  };

  let ultimoErro = "";
  for (let m = 0; m < modelos.length; m++) {
    const modelo = modelos[m];
    for (let i = 0; i < pool.length; i++) {
      const idx = (idxIni + i) % pool.length;
      const url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelo + ":generateContent?key=" + pool[idx];
      try {
        const resp = UrlFetchApp.fetch(url, {
          method: "post", contentType: "application/json",
          payload: JSON.stringify(payload), muteHttpExceptions: true
        });
        const code = resp.getResponseCode();
        const j = JSON.parse(resp.getContentText());
        if (j.error) {
          const msg = j.error.message || "";
          if (code === 429 || j.error.code === 429 || /quota/i.test(msg)) {
            cache.put("gemini_key_idx", String((idx + 1) % pool.length), 3600);
            ultimoErro = "cota esgotada (" + modelo + ")";
            continue;                 // próxima CHAVE deste modelo
          }
          ultimoErro = "Erro API Gemini [" + code + "] em " + modelo + ": " + msg;
          break;                      // erro não-cota (ex.: modelo inexistente) → próximo MODELO
        }
        const texto = j.candidates && j.candidates[0] && j.candidates[0].content
          && j.candidates[0].content.parts && j.candidates[0].content.parts[0]
          && j.candidates[0].content.parts[0].text;
        return (texto || "").trim();  // sucesso
      } catch (e) {
        ultimoErro = e.message;
        break;                        // falha de rede → tenta o próximo MODELO
      }
    }
    // esgotou as chaves deste modelo (cota/erro) → tenta o próximo modelo da lista
  }
  throw new Error("Falha ao chamar o Gemini (todos os modelos/chaves): " + ultimoErro);
}

// Teto de perguntas por usuário por dia (guarda-custo do pool compartilhado).
// Contagem persistida por usuário em ScriptProperties, com carimbo de data.
// O limite é ajustável pela propriedade CHAT_LIMITE_DIARIO (padrão 30).
// Observação: o e-mail vem do navegador — é guarda de custo entre usuários
// confiáveis (a tela já é restrita à secretaria), não uma barreira de segurança.
var CHAT_LIMITE_PADRAO = 30;
function _limiteChatOk(usuario) {
  const props = PropertiesService.getScriptProperties();
  let limite = parseInt(props.getProperty("CHAT_LIMITE_DIARIO") || "", 10);
  if (isNaN(limite) || limite <= 0) limite = CHAT_LIMITE_PADRAO;
  const quem = String(usuario || "").trim().toLowerCase() || "anonimo";
  const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
  const chave = "chatlim_" + quem;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return { ok: true }; }   // sem lock: não trava o uso
  try {
    const parts = String(props.getProperty(chave) || "").split(":");
    const count = (parts[0] === hoje) ? (parseInt(parts[1], 10) || 0) : 0;
    if (count >= limite) {
      return { ok: false, erro: "Você atingiu o limite de " + limite + " perguntas hoje. Tente novamente amanhã." };
    }
    props.setProperty(chave, hoje + ":" + (count + 1));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Responde perguntas SOMENTE com base no contexto recebido do navegador.
function chat(pergunta, contexto, historicoJson, usuario) {
  try {
    if (!pergunta || !String(pergunta).trim()) return { ok: false, erro: "Pergunta vazia." };
    const lim = _limiteChatOk(usuario);
    if (!lim.ok) return lim;
    let historico = [];
    try { historico = JSON.parse(historicoJson || "[]"); } catch (e) { historico = []; }
    const prompt = _promptChat(String(pergunta), String(contexto || ""), historico);
    const resposta = _chamarGeminiTexto(prompt, 2000);
    return { ok: true, resposta: resposta };
  } catch (e) {
    return { ok: false, erro: "Erro no assistente: " + e.message };
  }
}

function _promptChat(pergunta, contexto, historico) {
  const hist = (historico || []).slice(-6).map(function (m) {
    return (m.role === 'user' ? 'Usuário' : 'Assistente') + ': ' + m.texto;
  }).join('\n');
  return 'Você é o assistente do MAPA, sistema de acompanhamento pedagógico da Secretaria Municipal da Educação de Ribeirão Preto. Você responde a gestores e técnicos com base EXCLUSIVAMENTE nos dados de visitas e devolutivas fornecidos abaixo.\n\n' +
    'REGRAS:\n' +
    '- Você PODE e DEVE calcular, somar, contar, agrupar, ordenar, tirar médias/percentuais, ranquear e CRUZAR os dados fornecidos para responder. Isso NÃO é inventar — é usar os dados. Ex.: média de fluência por regional, qual regional está pior/melhor, ranking de escolas por risco, cruzar % de fluentes com o engajamento do Elefante.\n' +
    '- Cada escola aparece com a sua regional entre colchetes ([Regional X]) nas seções de Fluência, Elefante e Escolas Visitadas. Use isso para agrupar e comparar por regional; se uma pergunta é por regional, agregue as escolas daquela regional a partir das linhas por escola.\n' +
    '- Só diga que a informação "não consta nos registros" quando o dado BRUTO necessário realmente não estiver presente — NUNCA quando ele apenas precisa ser calculado ou agrupado a partir do que foi fornecido.\n' +
    '- Não invente escolas, números, datas ou fatos que não estejam nos dados nem sejam deriváveis deles por cálculo/agrupamento.\n' +
    '- Ao citar uma escola, use o nome exato. Seja objetivo e institucional; pode usar listas e negrito (markdown simples).\n' +
    '- Não repita o contexto inteiro; responda direto à pergunta. Quando fizer um ranking ou média, mostre os números que sustentam a conclusão.\n\n' +
    'DADOS DISPONÍVEIS:\n' + contexto + '\n' +
    (hist ? '\nCONVERSA ATÉ AGORA:\n' + hist + '\n' : '') +
    '\nPERGUNTA DO USUÁRIO:\n' + pergunta + '\n\n' +
    'Responda em português, de forma direta e fundamentada nos dados.';
}

// ════════════════════════════════════════════════════════════════
//  ANÁLISE INDIVIDUAL
//  Dois roteiros de prompt, escolhidos pelo segmento da visita:
//   - fundamental / infantil   → visita pedagógica (alfabetização, aprendizagem, gestão)
//   - fundamental2 / infantil2 → visita de diálogo (gestão/coordenação), PPA e boas práticas
// ════════════════════════════════════════════════════════════════

function analisarVisitaComGemini(dadosVisita) {
  try {
    const unidadeEscolar = dadosVisita['_ESCOLA_'] || 'Unidade escolar não informada';
    const dataVisita =
      dadosVisita['Data da Visita:'] ||
      dadosVisita['Data da visita:'] ||
      dadosVisita['Carimbo de data/hora'] ||
      'Data da visita não informada';
    const segmento = dadosVisita['_SEGMENTO_'] || '';
    const ehVisitaBoasPraticas = /2$/.test(segmento);

    const prompt = ehVisitaBoasPraticas
      ? _promptAnaliseBoasPraticas_(dadosVisita, unidadeEscolar, dataVisita, segmento)
      : _promptAnalisePedagogica_(dadosVisita, unidadeEscolar, dataVisita, segmento);

    const dados = _chamarGemini(prompt, 30000);
    return { ok: true, dados: dados };
  } catch (e) {
    return { ok: false, erro: "Erro ao processar análise individual: " + e.message };
  }
}

// ── Prompt: visita pedagógica (Fundamental/Infantil) ──────────────
function _promptAnalisePedagogica_(dadosVisita, unidadeEscolar, dataVisita, segmento) {
  return `Você é um assessor técnico-pedagógico da Secretaria Municipal da Educação, responsável por analisar registros de visitas escolares e produzir devolutivas objetivas para acompanhamento da unidade.

Analise o registro abaixo como uma visita pedagógica individual, considerando evidências de gestão, acompanhamento pedagógico, organização da rotina escolar, aprendizagem, alfabetização, recuperação da aprendizagem, planejamento docente, uso de dados e encaminhamentos necessários.

METADADOS DA VISITA:
{
  "unidade_escolar": ${JSON.stringify(unidadeEscolar)},
  "data_visita": ${JSON.stringify(dataVisita)},
  "segmento": ${JSON.stringify(segmento)}
}

REGISTRO DA VISITA:
${limitarTexto_(dadosVisita, 30000)}

OBJETIVO DA ANÁLISE:
Produzir uma devolutiva técnica, clara e útil para orientar a próxima ação da Secretaria junto à unidade escolar.

REGRAS IMPORTANTES:
- Use somente informações presentes no registro.
- Preserve exatamente o nome da unidade escolar e a data da visita informados nos metadados.
- Não altere, resuma, corrija ou reinterprete os metadados.
- Não invente fatos, nomes, problemas, ações ou conclusões.
- Quando a informação não estiver explícita, sinalize a limitação.
- Diferencie evidência concreta de interpretação.
- Evite frases genéricas sem explicar o que significam concretamente.
- Priorize aspectos que tenham impacto na aprendizagem dos estudantes.
- Use linguagem institucional, respeitosa, objetiva e técnica.
- Não escreva em tom punitivo. Não faça elogios vazios.
- Não transforme ausência de informação em problema.
- Se houver dados sobre alfabetização, recuperação da aprendizagem, frequência, avaliação, planejamento ou acompanhamento docente, considere esses pontos com prioridade.
- Se houver indícios de risco pedagógico, explicite o risco e o motivo.
- Se houver boas práticas, indique como elas podem ser fortalecidas ou compartilhadas.
- Se o registro for superficial ou incompleto, informe isso nos pontos de atenção.
- Não use aspas duplas dentro dos textos dos itens (use aspas simples se precisar).

FORMATO OBRIGATÓRIO:
Responda exclusivamente em JSON válido, sem markdown, sem comentários e sem qualquer texto fora do JSON.

{
  "unidade_escolar": ${JSON.stringify(unidadeEscolar)},
  "data_visita": ${JSON.stringify(dataVisita)},
  "segmento": ${JSON.stringify(segmento)},
  "pontos_fortes": [
    "Evidência positiva com explicação objetiva do impacto pedagógico.",
    "Evidência positiva com explicação objetiva do impacto pedagógico."
  ],
  "pontos_fracos": [
    "Fragilidade baseada no registro.",
    "Fragilidade baseada no registro."
  ],
  "pontos_atencao": [
    "Situação que exige acompanhamento da Secretaria ou equipe gestora.",
    "Situação que exige acompanhamento da Secretaria ou equipe gestora."
  ],
  "sintese_executiva": "Síntese técnica de até 900 caracteres com quadro geral da visita, principais achados e foco prioritário de acompanhamento.",
  "prioridade": "alta | média | baixa",
  "justificativa_prioridade": "Justificativa objetiva para o nível de prioridade baseada nas evidências.",
  "encaminhamentos_proxima_visita": [
    "Ação objetiva a ser verificada ou retomada na próxima visita.",
    "Ação objetiva a ser verificada ou retomada na próxima visita."
  ],
  "perguntas_para_proxima_visita": [
    "Pergunta técnica que ajude a aprofundar a análise na próxima visita.",
    "Pergunta técnica que ajude a aprofundar a análise na próxima visita."
  ],
  "risco_pedagogico": {
    "nivel": "alto | médio | baixo",
    "descricao": "Descrição objetiva do risco pedagógico identificado, ou indicação de ausência de evidência suficiente para classificar risco elevado."
  },
  "foco_formativo_sugerido": [
    "Tema formativo sugerido para a unidade ou equipe, com base no registro.",
    "Tema formativo sugerido para a unidade ou equipe, com base no registro."
  ]
}

CRITÉRIOS PARA PRIORIDADE:
- alta: evidências de risco relevante para aprendizagem, alfabetização, recuperação, acompanhamento docente, frequência, avaliação ou organização pedagógica.
- média: pontos de atenção importantes, sem evidência de risco imediato ou grave.
- baixa: funcionamento adequado, boas práticas consistentes ou apenas ajustes pontuais.

CRITÉRIOS PARA RISCO PEDAGÓGICO:
- alto: evidências de prejuízo direto ou provável à aprendizagem, alfabetização, recuperação, frequência ou acompanhamento pedagógico.
- médio: fragilidades que podem impactar a aprendizagem se não forem acompanhadas.
- baixo: ausência de indícios relevantes de risco ou presença predominante de boas práticas.`;
}

// ── Prompt: visita de diálogo/PPA/boas práticas (Fundamental2/Infantil2) ──
function _promptAnaliseBoasPraticas_(dadosVisita, unidadeEscolar, dataVisita, segmento) {
  const ehFund2 = segmento === 'fundamental2';

  // O 2º formulário tem estruturas diferentes por segmento:
  //  - Fundamental2: diálogo com gestão E com coordenação pedagógica; organização de
  //    horários do PPA (Projeto Professor Alfabetizador) e seu desenvolvimento no 2º ano;
  //    boas práticas; pontos de atenção nas turmas de 1ºs e 2ºs anos.
  //  - Infantil2: diálogo com a gestão; identificação e descrição de práticas pedagógicas
  //    observadas com intencionalidade educativa (não há PPA nem foco em 1º/2º ano).
  const papel = ehFund2
    ? `Você é um assessor técnico-pedagógico da Secretaria Municipal da Educação, responsável por analisar registros de visitas de acompanhamento ao Ensino Fundamental voltadas ao diálogo com a gestão escolar e com a coordenação pedagógica, à organização e ao desenvolvimento do Projeto Professor Alfabetizador (PPA) e ao mapeamento de boas práticas, com atenção às turmas de alfabetização (1ºs e 2ºs anos).`
    : `Você é um assessor técnico-pedagógico da Secretaria Municipal da Educação, responsável por analisar registros de visitas de acompanhamento à Educação Infantil voltadas ao diálogo com a gestão escolar e à identificação de práticas pedagógicas observadas com intencionalidade educativa (boas práticas docentes).`;

  const foco = ehFund2
    ? `Analise o registro abaixo como uma visita de acompanhamento individual, considerando: o diálogo realizado com os(as) gestores(as) e com o(a) coordenador(a) pedagógico(a); a organização de horários do PPA e como o projeto está sendo desenvolvido no 2º ano; as boas práticas identificadas e sua intencionalidade educativa; os pontos de atenção nas turmas de 1ºs e 2ºs anos; e as devolutivas/encaminhamentos necessários para a próxima visita.`
    : `Analise o registro abaixo como uma visita de acompanhamento individual, considerando: o diálogo realizado com o(a) gestor(a); as práticas pedagógicas observadas com intencionalidade educativa e as boas práticas docentes evidenciadas no contexto observado; os pontos de atenção apontados; e as devolutivas pedagógicas/encaminhamentos necessários para a continuidade do processo formativo na próxima visita.`;

  return `${papel}

${foco}

METADADOS DA VISITA:
{
  "unidade_escolar": ${JSON.stringify(unidadeEscolar)},
  "data_visita": ${JSON.stringify(dataVisita)},
  "segmento": ${JSON.stringify(segmento)}
}

REGISTRO DA VISITA:
${limitarTexto_(dadosVisita, 30000)}

OBJETIVO DA ANÁLISE:
Produzir uma devolutiva técnica, clara e útil para orientar a próxima ação da Secretaria junto à unidade escolar, com foco no fortalecimento do diálogo pedagógico e na disseminação de boas práticas.

REGRAS IMPORTANTES:
- Use somente informações presentes no registro.
- Preserve exatamente o nome da unidade escolar e a data da visita informados nos metadados.
- Não altere, resuma, corrija ou reinterprete os metadados.
- Não invente fatos, nomes, problemas, ações ou conclusões.
- Quando a informação não estiver explícita (ex.: diálogo não realizado, PPA não aplicável ao segmento), sinalize a limitação sem tratá-la automaticamente como problema.
- Diferencie evidência concreta de interpretação.
- Evite frases genéricas sem explicar o que significam concretamente.
- Priorize aspectos com impacto na aprendizagem dos estudantes, especialmente nas turmas de alfabetização (1ºs e 2ºs anos), quando aplicável.
- Use linguagem institucional, respeitosa, objetiva e técnica.
- Não escreva em tom punitivo. Não faça elogios vazios.
- Não transforme ausência de informação em problema.
- Valorize boas práticas relatadas e indique como podem ser fortalecidas ou compartilhadas com outras unidades.
- Se houver pontos de atenção nas turmas observadas, explicite o risco pedagógico e o motivo.
- Se o diálogo com gestão/coordenação não tiver sido possível, registre o motivo relatado como ponto de atenção, sem presumir causas não informadas.
- Se o registro for superficial ou incompleto, informe isso nos pontos de atenção.
- Não use aspas duplas dentro dos textos dos itens (use aspas simples se precisar).

FORMATO OBRIGATÓRIO:
Responda exclusivamente em JSON válido, sem markdown, sem comentários e sem qualquer texto fora do JSON.

{
  "unidade_escolar": ${JSON.stringify(unidadeEscolar)},
  "data_visita": ${JSON.stringify(dataVisita)},
  "segmento": ${JSON.stringify(segmento)},
  "pontos_fortes": [
    "Boa prática ou evidência positiva identificada, com explicação objetiva do impacto pedagógico.",
    "Boa prática ou evidência positiva identificada, com explicação objetiva do impacto pedagógico."
  ],
  "pontos_fracos": [
    "Fragilidade baseada no registro.",
    "Fragilidade baseada no registro."
  ],
  "pontos_atencao": [
    "Situação nas turmas observadas que exige acompanhamento da Secretaria ou equipe gestora.",
    "Situação nas turmas observadas que exige acompanhamento da Secretaria ou equipe gestora."
  ],
  "sintese_executiva": "Síntese técnica de até 900 caracteres com quadro geral da visita, diálogo realizado, boas práticas identificadas e foco prioritário de acompanhamento.",
  "prioridade": "alta | média | baixa",
  "justificativa_prioridade": "Justificativa objetiva para o nível de prioridade baseada nas evidências.",
  "encaminhamentos_proxima_visita": [
    "Ação objetiva a ser verificada ou retomada na próxima visita.",
    "Ação objetiva a ser verificada ou retomada na próxima visita."
  ],
  "perguntas_para_proxima_visita": [
    "Pergunta técnica que ajude a aprofundar o diálogo ou a análise na próxima visita.",
    "Pergunta técnica que ajude a aprofundar o diálogo ou a análise na próxima visita."
  ],
  "risco_pedagogico": {
    "nivel": "alto | médio | baixo",
    "descricao": "Descrição objetiva do risco pedagógico identificado nas turmas observadas, ou indicação de ausência de evidência suficiente para classificar risco elevado."
  },
  "foco_formativo_sugerido": [
    "Tema formativo sugerido para a unidade ou equipe, com base nas boas práticas e pontos de atenção do registro.",
    "Tema formativo sugerido para a unidade ou equipe, com base nas boas práticas e pontos de atenção do registro."
  ]
}

CRITÉRIOS PARA PRIORIDADE:
- alta: ${ehFund2 ? 'diálogo com gestão ou coordenação não realizado sem justificativa clara, fragilidades na organização/desenvolvimento do PPA, ou pontos de atenção relevantes nas turmas de 1ºs e 2ºs anos' : 'diálogo com a gestão não realizado sem justificativa clara, ou pontos de atenção relevantes nas práticas pedagógicas observadas'}.
- média: pontos de atenção pontuais ou diálogo parcial, sem evidência de risco imediato.
- baixa: diálogo realizado normalmente, boas práticas consistentes ou apenas ajustes pontuais.

CRITÉRIOS PARA RISCO PEDAGÓGICO:
- alto: ${ehFund2 ? 'evidências de prejuízo direto ou provável à alfabetização ou ao desenvolvimento das turmas de 1ºs e 2ºs anos' : 'evidências de prejuízo direto ou provável à intencionalidade pedagógica das práticas observadas ou ao desenvolvimento das crianças'}.
- médio: fragilidades que podem impactar a aprendizagem se não forem acompanhadas.
- baixo: ausência de indícios relevantes de risco ou presença predominante de boas práticas.`;
}

// ════════════════════════════════════════════════════════════════
//  ANÁLISE DE REDE / REGIONAL (seleção manual ou por regional)
// ════════════════════════════════════════════════════════════════

function analisarRedeComGemini(payloadRede) {
  try {
    let visitas, metadados;
    if (Array.isArray(payloadRede)) {
      visitas = payloadRede;
      const escolas = [...new Set(visitas.map(v => v['_ESCOLA_'] || '').filter(Boolean))];
      metadados = {
        tipo_analise: "rede",
        quantidade_escolas: escolas.length,
        quantidade_visitas: visitas.length,
        unidades_analisadas: escolas
      };
    } else {
      visitas   = payloadRede.visitas;
      metadados = payloadRede.metadados;
    }

    // Truncamento por visita para proteger o contexto
    const visitasSerializadas = visitas.map(v => limitarTexto_(v, 8000));

    const contextoAnalise = metadados.tipo_analise === "regional"
      ? `Esta é uma análise de uma REGIONAL específica (${metadados.regional}), que agrupa escolas sob mesma coordenação regional. Foque em padrões internos à regional, alertas para a coordenação regional, e aponte disparidades entre escolas da própria regional. Boas práticas identificadas devem ser pensadas como replicáveis dentro da própria regional, pela coordenação regional.`
      : `Esta é uma análise de um conjunto de escolas selecionadas manualmente, não necessariamente da mesma regional.`;

    const prompt = `Você é um assessor técnico da Secretaria Municipal da Educação responsável por analisar relatórios de visitas pedagógicas de várias escolas.

${contextoAnalise}

Você receberá:
1. Metadados objetivos da análise;
2. Relatórios de visitas pedagógicas.

Os metadados já foram calculados pelo sistema. Não altere a quantidade de escolas, a quantidade de visitas, os nomes das unidades nem as datas das visitas.

OBJETIVO:
Produzir um relatório que ajude a Secretaria${metadados.tipo_analise === "regional" ? " e a coordenação regional" : ""} a decidir prioridades de acompanhamento, formação, orientação e gestão.

CRITÉRIOS DE ANÁLISE:
- Não faça apenas resumo escola por escola.
- Identifique padrões que aparecem em mais de uma unidade.
- Diferencie problemas pontuais de problemas recorrentes.
- Aponte riscos para aprendizagem, alfabetização, recuperação da aprendizagem, acompanhamento docente e gestão pedagógica.
- Identifique boas práticas que podem ser compartilhadas entre escolas.
- Indique ações possíveis para a Secretaria${metadados.tipo_analise === "regional" ? " e para a coordenação regional" : ""}.
- Não invente dados. Use apenas informações presentes nos relatórios.
- Quando uma conclusão depender de poucos registros, sinalize a limitação.
- Diferencie quantidade de escolas de quantidade de visitas.
- Não use aspas duplas dentro dos textos dos itens (use aspas simples se precisar).

FORMATO OBRIGATÓRIO:
Responda exclusivamente em JSON válido, sem markdown, sem comentários e sem texto fora do JSON.

{
  "quantidade_escolas": ${metadados.quantidade_escolas},
  "quantidade_visitas": ${metadados.quantidade_visitas},
  "unidades_analisadas": ${JSON.stringify(metadados.unidades_analisadas)},
  "panorama_geral": "Texto técnico de até 1200 caracteres com diagnóstico geral a partir das visitas analisadas.",
  "pontos_fortes_rede": [
    "Boa prática ou evidência positiva recorrente, com explicação pedagógica.",
    "Boa prática ou evidência positiva recorrente, com explicação pedagógica.",
    "Boa prática ou evidência positiva recorrente, com explicação pedagógica."
  ],
  "desafios_comuns": [
    "Desafio recorrente, com impacto pedagógico.",
    "Desafio recorrente, com impacto pedagógico.",
    "Desafio recorrente, com impacto pedagógico."
  ],
  "recomendacoes": [
    "Ação objetiva para executar ou acompanhar.",
    "Ação objetiva para executar ou acompanhar.",
    "Ação objetiva para executar ou acompanhar."
  ],
  "prioridades_da_rede": [
    {
      "prioridade": "Descrição da prioridade",
      "nivel": "alto | médio | baixo",
      "justificativa": "Justificativa técnica baseada nos registros"
    }
  ],
  "boas_praticas_para_socializar": [
    "Boa prática que pode ser compartilhada com outras unidades.",
    "Boa prática que pode ser compartilhada com outras unidades."
  ],
  "acoes_formativas_sugeridas": [
    "Tema de formação sugerido, público-alvo e justificativa.",
    "Tema de formação sugerido, público-alvo e justificativa."
  ],
  "alertas_para_gestao": [
    "Alerta objetivo que exige decisão ou acompanhamento.",
    "Alerta objetivo que exige decisão ou acompanhamento."
  ],
  "sintese_executiva": "Síntese final de até 800 caracteres, indicando o quadro geral, principais riscos e encaminhamento prioritário."
}

METADADOS DA ANÁLISE:
${JSON.stringify(metadados, null, 2)}

RELATÓRIOS DAS VISITAS:
${JSON.stringify(visitasSerializadas, null, 2)}`;

    const dados = _chamarGemini(prompt, 40000);
    return { ok: true, dados: dados };
  } catch (e) {
    return { ok: false, erro: "Erro ao processar análise de rede: " + e.message };
  }
}

// ── Análise de Regional ──────────────────────────────────────────
// payload: { segmento: "fundamental"|"infantil" (base), regional: "Nome da Regional" }
// A análise regional JUNTA os dois formulários do segmento (ex.: fundamental + fundamental2),
// tratando-os como um único conjunto de evidências da regional. Os formulários "2" não
// perguntam a regional no próprio registro; por isso a filtragem usa a regional direta quando
// existe (fundamental/infantil) e cai para o mapa oficial escola→regional (mesmo cadastro
// EMEF/EMEI) quando o registro não a informa (fundamental2/infantil2).
function analisarRegionalComGemini(payload) {
  try {
    const segBase = (payload.segmento || '').replace(/2$/, ''); // aceita 'fundamental' ou 'fundamental2'
    const regional = payload.regional;
    const dadosCompletos = _getDadosVisitasCacheado();
    const mapaReg = _mapaRegionalDoSegmento_(segBase, dadosCompletos);

    // Junta os dois tipos de visita (base + variante "2") do segmento.
    const todasVisitas = [].concat(dadosCompletos[segBase] || [], dadosCompletos[segBase + '2'] || []);
    const visitas = todasVisitas.filter(v => {
      const regDireta = (v[COL_REGIONAL_] || '').toString().trim();
      const regResolvida = regDireta || (mapaReg[v['_ESCOLA_']] || '');
      return regResolvida === regional;
    });

    if (visitas.length === 0) {
      return { ok: false, erro: "Nenhuma visita encontrada para esta regional." };
    }

    const escolasUnicas = [...new Set(visitas.map(v => v['_ESCOLA_']).filter(Boolean))];

    const metadados = {
      tipo_analise: "regional",
      regional: regional,
      segmento: segBase === 'fundamental' ? 'Ensino Fundamental' : 'Educação Infantil',
      quantidade_escolas: escolasUnicas.length,
      quantidade_visitas: visitas.length,
      unidades_analisadas: escolasUnicas
    };

    return analisarRedeComGemini({ visitas: visitas, metadados: metadados });
  } catch (e) {
    return { ok: false, erro: "Erro ao processar análise regional: " + e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  DEVOLUTIVAS — Persistência em abas separadas
// ════════════════════════════════════════════════════════════════

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

// ── Aba de devolutivas de rede (seleção manual) ───────────────────
function _getAbaDevolutivasRede() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName("Devolutivas_Rede");
  if (!aba) {
    aba = planilha.insertSheet("Devolutivas_Rede");
    aba.appendRow([
      "ID","Segmento","Escolas","Quantidade Escolas",
      "Quantidade Visitas","Data Geração","Salvo em",
      "Panorama Geral","Pontos Fortes Rede","Desafios Comuns",
      "Recomendações","Prioridades da Rede JSON",
      "Boas Práticas para Socializar","Ações Formativas Sugeridas",
      "Alertas para Gestão","Síntese Executiva"
    ]);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 16).setFontWeight("bold");
  }
  return aba;
}

// ── Aba de devolutivas regionais (aba própria) ────────────────────
function _getAbaDevolutivasRegional() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName("Devolutivas_Regional");
  if (!aba) {
    aba = planilha.insertSheet("Devolutivas_Regional");
    aba.appendRow([
      "ID","Segmento","Regional","Escolas","Quantidade Escolas",
      "Quantidade Visitas","Data Geração","Salvo em",
      "Panorama Geral","Pontos Fortes Rede","Desafios Comuns",
      "Recomendações","Prioridades da Rede JSON",
      "Boas Práticas para Socializar","Ações Formativas Sugeridas",
      "Alertas para Gestão","Síntese Executiva"
    ]);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 17).setFontWeight("bold");
    aba.getRange(1, 1, 1, 17).setBackground("#4a2080").setFontColor("white");
  }
  return aba;
}

function _gerarId(segmento, escola, dataVisita) {
  const base = (segmento + "|" + escola + "|" + dataVisita).toLowerCase().replace(/\s+/g, "_");
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, base
  ).map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('').substring(0, 12);
}

// ── Salva devolutiva individual — com LockService ─────────────────
function salvarDevolutiva(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { ok: false, erro: "Não foi possível obter lock de escrita: " + e.message };
  }

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
      id,
      payload.segmento,
      payload.escola,
      payload.dataVisita,
      savedAt,
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
  } catch(e) {
    return { ok: false, erro: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ── Helper interno de gravação para abas de rede/regional ────────
function _gravarAbaNaoIndividual(aba, id, linhaValores) {
  const dados = aba.getDataRange().getValues();
  for (let i = dados.length - 1; i >= 1; i--) {
    if (dados[i][0] === id) aba.deleteRow(i + 1);
  }
  aba.appendRow(linhaValores);
}

// ── Salva devolutiva de rede (seleção manual) ─────────────────────
function salvarDevolutivaRede(payload) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { ok: false, erro: "Lock indisponível: " + e.message }; }
  try {
    const aba     = _getAbaDevolutivasRede();
    const id      = _gerarId("rede", payload.escolas.join(","), payload.dataGeracao);
    const savedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    const d       = payload.dados;
    const prioridadesJSON = JSON.stringify(d.prioridades_da_rede || []);
    _gravarAbaNaoIndividual(aba, id, [
      id, payload.segmento,
      payload.escolas.join(", "),
      d.quantidade_escolas  || payload.escolas.length,
      d.quantidade_visitas  || payload.escolas.length,
      payload.dataGeracao, savedAt,
      d.panorama_geral      || "",
      (d.pontos_fortes_rede            || []).join(" | "),
      (d.desafios_comuns               || []).join(" | "),
      (d.recomendacoes                 || []).join(" | "),
      prioridadesJSON,
      (d.boas_praticas_para_socializar || []).join(" | "),
      (d.acoes_formativas_sugeridas    || []).join(" | "),
      (d.alertas_para_gestao           || []).join(" | "),
      d.sintese_executiva   || ""
    ]);
    _cacheClear('relat_devolutivas_v1');
    return { ok: true, id: id };
  } catch(e) { return { ok: false, erro: e.message }; }
  finally    { lock.releaseLock(); }
}

// ── Salva devolutiva regional (aba própria) ───────────────────────
function salvarDevolutivaRegional(payload) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { ok: false, erro: "Lock indisponível: " + e.message }; }
  try {
    const aba     = _getAbaDevolutivasRegional();
    const id      = _gerarId("regional", payload.regional + "|" + payload.segmento, payload.dataGeracao);
    const savedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    const d       = payload.dados;
    const prioridadesJSON = JSON.stringify(d.prioridades_da_rede || []);
    _gravarAbaNaoIndividual(aba, id, [
      id, payload.segmento,
      payload.regional,
      payload.escolas.join(", "),
      d.quantidade_escolas  || payload.escolas.length,
      d.quantidade_visitas  || payload.escolas.length,
      payload.dataGeracao, savedAt,
      d.panorama_geral      || "",
      (d.pontos_fortes_rede            || []).join(" | "),
      (d.desafios_comuns               || []).join(" | "),
      (d.recomendacoes                 || []).join(" | "),
      prioridadesJSON,
      (d.boas_praticas_para_socializar || []).join(" | "),
      (d.acoes_formativas_sugeridas    || []).join(" | "),
      (d.alertas_para_gestao           || []).join(" | "),
      d.sintese_executiva   || ""
    ]);
    _cacheClear('relat_devolutivas_v1');
    return { ok: true, id: id };
  } catch(e) { return { ok: false, erro: e.message }; }
  finally    { lock.releaseLock(); }
}

// ── Lê todas as devolutivas (individual + rede + regional + síntese global), cacheado ──
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

    // ── helper: parse seguro de prioridades JSON ──
    function parsePrioridades(raw) {
      try { return JSON.parse(raw || "[]"); } catch(_) { return []; }
    }

    // ── helper: monta _dados para rede/regional ──
    function montaDadosRede(obj) {
      return {
        panorama_geral:                obj["Panorama Geral"]          || "",
        pontos_fortes_rede:            split(obj["Pontos Fortes Rede"]),
        desafios_comuns:               split(obj["Desafios Comuns"]),
        recomendacoes:                 split(obj["Recomendações"]),
        prioridades_da_rede:           parsePrioridades(obj["Prioridades da Rede JSON"]),
        boas_praticas_para_socializar: split(obj["Boas Práticas para Socializar"]),
        acoes_formativas_sugeridas:    split(obj["Ações Formativas Sugeridas"]),
        alertas_para_gestao:           split(obj["Alertas para Gestão"]),
        sintese_executiva:             obj["Síntese Executiva"]        || "",
        quantidade_escolas:            obj["Quantidade Escolas"]       || "",
        quantidade_visitas:            obj["Quantidade Visitas"]       || ""
      };
    }

    // ── Individuais ──
    const tz = Session.getScriptTimeZone();
    function lerCelula(val) {
      if (val instanceof Date) return Utilities.formatDate(val, tz, "dd/MM/yyyy HH:mm");
      return val ? val.toString() : "";
    }

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
          nivel:    obj["Risco Pedagógico Nível"]    || "",
          descricao: obj["Risco Pedagógico Descrição"] || ""
        },
        foco_formativo_sugerido: split(obj["Foco Formativo Sugerido"])
      };
    }

    const abaInd   = _getAbaDevolutivasIndividual();
    const dadosInd = abaInd.getDataRange().getValues();
    if (dadosInd.length >= 2) {
      const cab = dadosInd[0];
      for (let i = 1; i < dadosInd.length; i++) {
        const linha = dadosInd[i];
        const obj   = {};
        cab.forEach((col, j) => { obj[col] = lerCelula(linha[j]); });
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

    // ── Rede ──
    const abaRede   = _getAbaDevolutivasRede();
    const dadosRede = abaRede.getDataRange().getValues();
    if (dadosRede.length >= 2) {
      const cab = dadosRede[0];
      for (let i = 1; i < dadosRede.length; i++) {
        const linha = dadosRede[i];
        const obj   = {};
        cab.forEach((col, j) => { obj[col] = linha[j] ? linha[j].toString() : ""; });
        registros.push({
          "ID":             obj["ID"]             || "",
          "Escola":         obj["Escolas"]        || "",
          "Data da Visita": obj["Data Geração"]    || "",
          "Segmento":       obj["Segmento"]       || "",
          "Salvo em":       obj["Salvo em"]       || "",
          "Regional":       "",
          "_tipo":          "rede",
          "_dados":         montaDadosRede(obj)
        });
      }
    }

    // ── Regional ──
    const abaReg   = _getAbaDevolutivasRegional();
    const dadosReg = abaReg.getDataRange().getValues();
    if (dadosReg.length >= 2) {
      const cab = dadosReg[0];
      for (let i = 1; i < dadosReg.length; i++) {
        const linha = dadosReg[i];
        const obj   = {};
        cab.forEach((col, j) => { obj[col] = linha[j] ? linha[j].toString() : ""; });
        registros.push({
          "ID":             obj["ID"]             || "",
          "Escola":         obj["Escolas"]        || "",
          "Data da Visita": obj["Data Geração"]    || "",
          "Segmento":       obj["Segmento"]       || "",
          "Salvo em":       obj["Salvo em"]       || "",
          "Regional":       obj["Regional"]       || "",
          "_tipo":          "regional",
          "_dados":         montaDadosRede(obj)
        });
      }
    }

    // ── Síntese Rede Global ──
    try {
      const planilha = SpreadsheetApp.getActiveSpreadsheet();
      const abaSintese = planilha.getSheetByName("Sintese_Rede_Global");
      if (abaSintese) {
        const dadosSintese = abaSintese.getDataRange().getValues();
        if (dadosSintese.length >= 2) {
          const cab = dadosSintese[0];
          for (let i = 1; i < dadosSintese.length; i++) {
            const linha = dadosSintese[i];
            const obj   = {};
            cab.forEach((col, j) => { obj[col] = linha[j] ? linha[j].toString() : ""; });

            function parseJSON(s) {
              try { return s ? JSON.parse(s) : []; } catch(_) { return []; }
            }
            function parseLista(s) {
              return s ? s.split(" | ").filter(Boolean) : [];
            }

            registros.push({
              "ID":             obj["ID"]                 || "",
              "Escola":         (obj["Regionais Analisadas"]||"").split(", ").join(" + "),
              "Data da Visita": obj["Data Geração"]        || "",
              "Segmento":       obj["Segmento"]            || "",
              "Salvo em":       obj["Salvo em"]            || "",
              "Regional":       "SÍNTESE GLOBAL",
              "_tipo":          "sintese_global",
              "_dados": {
                panorama_geral: obj["Panorama Rede"] || "",
                pontos_fortes_rede: parseLista(obj["Pontos Fortes Rede"]),
                desafios_comuns: parseLista(obj["Desafios Sistêmicos"]),
                recomendacoes: parseLista(obj["Recomendações Secretaria"]),
                prioridades_da_rede: parseJSON(obj["Prioridades Rede JSON"]),
                boas_praticas_para_socializar: parseJSON(obj["Boas Práticas Replicar JSON"]),
                acoes_formativas_sugeridas: parseLista(obj["Ações Formativas Prioritárias"]),
                alertas_para_gestao: parseLista(obj["Indicadores Risco Rede"]),
                sintese_executiva: obj["Síntese Executiva"] || "",
                quantidade_escolas: obj["Quantidade Escolas"] || "",
                quantidade_visitas: obj["Quantidade Visitas"] || "",
                quantidade_regionais: obj["Quantidade Regionais"] || ""
              }
            });
          }
        }
      }
    } catch(e) {
      console.log("Aviso: aba Sintese_Rede_Global não encontrada");
    }

    return { ok: true, registros: registros };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

// ── Exclui devolutiva pelo ID — busca nas três abas ───────────────
function excluirDevolutiva(id) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { ok: false, erro: "Lock indisponível: " + e.message }; }
  try {
    const abas = [
      _getAbaDevolutivasIndividual(),
      _getAbaDevolutivasRede(),
      _getAbaDevolutivasRegional()
    ];
    for (const aba of abas) {
      const dados = aba.getDataRange().getValues();
      for (let i = dados.length - 1; i >= 1; i--) {
        if (dados[i][0] === id) {
          aba.deleteRow(i + 1);
          _cacheClear('relat_devolutivas_v1');
          return { ok: true };
        }
      }
    }
    return { ok: false, erro: "ID não encontrado" };
  } catch(e) { return { ok: false, erro: e.message }; }
  finally    { lock.releaseLock(); }
}

// ════════════════════════════════════════════════════════════════
//  ANÁLISE DE REDE — Sintetizada a partir de Análises Regionais
//
//  Este módulo cria uma análise de rede/síntese geral a partir
//  das análises regionais já salvas. Hierarquia:
//  Visitas → Análises Regionais → Análise de Rede Global
// ════════════════════════════════════════════════════════════════

/**
 * Lê todas as análises regionais salvas para um segmento
 * e retorna um array de { regional, dados }
 */
function _lerAnalisesRegionaisSalvas(segmento) {
  try {
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const abaReg   = planilha.getSheetByName("Devolutivas_Regional");
    if (!abaReg) return [];

    const dados = abaReg.getDataRange().getValues();
    if (dados.length < 2) return [];

    const cabecalho = dados[0];
    const colSeg = cabecalho.indexOf("Segmento");
    const colReg = cabecalho.indexOf("Regional");

    if (colSeg < 0 || colReg < 0) return [];

    function parseJSON(s) {
      try { return s ? JSON.parse(s) : null; } catch (_) { return null; }
    }
    function parseLista(s) {
      return s ? s.split(" | ").map(x => x.trim()).filter(Boolean) : [];
    }

    const registros = [];
    for (let i = 1; i < dados.length; i++) {
      const linha = dados[i];
      if ((linha[colSeg] || '').toString().trim() !== segmento) continue;

      const regional = (linha[colReg] || '').toString().trim();
      if (!regional) continue;

      const obj = {};
      cabecalho.forEach((col, j) => { obj[col] = linha[j] || ''; });

      const analiseData = {
        regional: regional,
        panorama_geral: obj["Panorama Geral"] || "",
        pontos_fortes_rede: parseLista(obj["Pontos Fortes Rede"]),
        desafios_comuns: parseLista(obj["Desafios Comuns"]),
        recomendacoes: parseLista(obj["Recomendações"]),
        prioridades_da_rede: parseJSON(obj["Prioridades da Rede JSON"]) || [],
        boas_praticas_para_socializar: parseLista(obj["Boas Práticas para Socializar"]),
        acoes_formativas_sugeridas: parseLista(obj["Ações Formativas Sugeridas"]),
        alertas_para_gestao: parseLista(obj["Alertas para Gestão"]),
        sintese_executiva: obj["Síntese Executiva"] || "",
        quantidade_escolas: obj["Quantidade Escolas"] || "",
        quantidade_visitas: obj["Quantidade Visitas"] || ""
      };

      registros.push({ regional: regional, dados: analiseData });
    }

    return registros;
  } catch (e) {
    console.error("Erro ao ler análises regionais: " + e.message);
    return [];
  }
}

/**
 * Gera análise de rede a partir de análises regionais salvas
 * Payload: { segmento: "fundamental" | "infantil" | "fundamental2" | "infantil2" }
 */
function analisarRedeAPartirDeRegionaisComGemini(payload) {
  try {
    const segmento = payload.segmento;
    const analisesRegionais = _lerAnalisesRegionaisSalvas(segmento);

    if (analisesRegionais.length === 0) {
      return { ok: false, erro: "Nenhuma análise regional salva encontrada para sintetizar." };
    }

    const regionaisPara = analisesRegionais.map(r => ({
      regional: r.regional,
      quantidade_escolas: r.dados.quantidade_escolas,
      quantidade_visitas: r.dados.quantidade_visitas,
      panorama: r.dados.panorama_geral.substring(0, 300) + (r.dados.panorama_geral.length > 300 ? "..." : ""),
      fortes: r.dados.pontos_fortes_rede.slice(0, 2),
      desafios: r.dados.desafios_comuns.slice(0, 2),
      recomendacoes: r.dados.recomendacoes.slice(0, 2),
      alertas: r.dados.alertas_para_gestao.slice(0, 2),
      prioridades: r.dados.prioridades_da_rede.slice(0, 1)
    }));

    const totalEscolas = analisesRegionais.reduce((s, r) => {
      const n = parseInt(r.dados.quantidade_escolas) || 0;
      return s + n;
    }, 0);

    const totalVisitas = analisesRegionais.reduce((s, r) => {
      const n = parseInt(r.dados.quantidade_visitas) || 0;
      return s + n;
    }, 0);

    const rotuloSegmento = segmento === 'fundamental' ? 'Ensino Fundamental'
      : segmento === 'infantil' ? 'Educação Infantil'
      : segmento === 'fundamental2' ? 'Ensino Fundamental — Diálogo/PPA/Boas Práticas'
      : 'Educação Infantil — Diálogo/Boas Práticas';

    const metadadosRede = {
      quantidade_regionais: analisesRegionais.length,
      quantidade_escolas: totalEscolas,
      quantidade_visitas: totalVisitas,
      regionais: analisesRegionais.map(r => r.regional),
      segmento: rotuloSegmento
    };

    const prompt = `Você é um assessor técnico senior da Secretaria Municipal da Educação, responsável por síntese estratégica em nível de rede.

Você receberá análises de múltiplas regionais (diagnósticos já processados e validados) e deve produzir uma síntese de rede que:
1. Identifique padrões TRANSVERSAIS que aparecem em mais de uma regional.
2. Diferencie desafios locais (específicos de uma regional) de desafios sistêmicos (toda a rede).
3. Aponte boas práticas para replicação em larga escala.
4. Recomende ações prioritárias para a Secretaria (não para regionais isoladas).
5. Nunca invente dados — use apenas o que está nos diagnósticos regionais.

METADADOS DA SÍNTESE:
${JSON.stringify(metadadosRede, null, 2)}

ANÁLISES DAS REGIONAIS (resumidas para síntese):
${JSON.stringify(regionaisPara, null, 2)}

ANÁLISES COMPLETAS (para referência detalhada):
${JSON.stringify(analisesRegionais.map(r => ({ regional: r.regional, dados: r.dados })), null, 2)}

FORMATO OBRIGATÓRIO:
Responda exclusivamente em JSON válido, sem markdown, sem comentários e sem texto fora do JSON.

{
  "quantidade_regionais": ${metadadosRede.quantidade_regionais},
  "quantidade_escolas": ${metadadosRede.quantidade_escolas},
  "quantidade_visitas": ${metadadosRede.quantidade_visitas},
  "regionais_analisadas": ${JSON.stringify(metadadosRede.regionais)},

  "panorama_rede": "Síntese executiva de até 1500 caracteres sobre o quadro geral da rede, principais desafios sistêmicos e oportunidades.",

  "desafios_sistemicos": [
    "Desafio recorrente em mais de uma regional, com impacto na rede toda.",
    "Desafio recorrente em mais de uma regional, com impacto na rede toda."
  ],

  "pontos_fortes_rede": [
    "Boa prática identificada em ao menos uma regional, replicável em outras.",
    "Boa prática identificada em ao menos uma regional, replicável em outras."
  ],

  "disparidades_regionais": [
    {
      "regional": "Nome da Regional",
      "desafio_unico": "Desafio específico dessa regional (não recorrente em outras).",
      "oportunidade": "Pista de ação para essa regional específica."
    }
  ],

  "prioridades_rede": [
    {
      "prioridade": "Ação ou foco prioritário para a Secretaria executar/coordenar",
      "nivel": "alto | médio | baixo",
      "justificativa": "Por que é crítico",
      "regionais_impactadas": ["Regional A", "Regional B"]
    }
  ],

  "recomendacoes_secretaria": [
    "Recomendação estratégica para a Secretaria (coordenação, formação, orientação).",
    "Recomendação estratégica para a Secretaria (coordenação, formação, orientação)."
  ],

  "boas_praticas_para_replicar": [
    {
      "pratica": "Nome ou descrição breve da boa prática",
      "regional_origem": "Regional onde foi identificada",
      "como_replicar": "Sugestão concreta de como levar para outras regionais",
      "impacto_esperado": "Benefício pedagógico esperado"
    }
  ],

  "acoes_formativas_prioritarias": [
    "Ação ou tema formativo que afete múltiplas regionais.",
    "Ação ou tema formativo que afete múltiplas regionais."
  ],

  "indicadores_de_risco_rede": [
    "Indicador de risco pedagógico ou gestional que demande atenção da Secretaria.",
    "Indicador de risco pedagógico ou gestional que demanda atenção da Secretaria."
  ],

  "sintese_executiva": "Síntese final de até 1000 caracteres: quadro geral, principais riscos, encaminhamento imediato e visão para os próximos acompanhamentos."
}

CRITÉRIOS:
- Diferencie informação regional de informação de rede (use apenas dados confirmados em múltiplas fontes para síntese de rede).
- Se uma regional tem um desafio isolado, coloque em "disparidades regionais", não em "desafios sistêmicos".
- Se uma boa prática aparece em uma única regional, aponte como "para replicar", não como "forte de rede".
- Não insista que regionais devam fazer X — a análise é para a Secretaria decidir o que coordenar/facilitar.
- Priorize impacto pedagógico: alfabetização, aprendizagem, avaliação, acompanhamento docente.`;

    const dados = _chamarGemini(prompt, 50000);
    return { ok: true, dados: dados };
  } catch (e) {
    return { ok: false, erro: "Erro ao processar síntese de rede regional: " + e.message };
  }
}

/**
 * Salva a síntese de rede em uma aba dedicada
 */
function _getAbaRedeGlobal() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName("Sintese_Rede_Global");
  if (!aba) {
    aba = planilha.insertSheet("Sintese_Rede_Global");
    aba.appendRow([
      "ID","Segmento","Data Geração","Salvo em",
      "Quantidade Regionais","Quantidade Escolas","Quantidade Visitas",
      "Regionais Analisadas",
      "Panorama Rede","Desafios Sistêmicos","Pontos Fortes Rede",
      "Disparidades Regionais JSON","Prioridades Rede JSON",
      "Recomendações Secretaria","Boas Práticas Replicar JSON",
      "Ações Formativas Prioritárias","Indicadores Risco Rede",
      "Síntese Executiva"
    ]);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 18).setFontWeight("bold");
    aba.getRange(1, 1, 1, 18).setBackground("#1a3a5c").setFontColor("white");
  }
  return aba;
}

function salvarSinteseRedeGlobal(payload) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { ok: false, erro: "Lock indisponível: " + e.message }; }
  try {
    const aba     = _getAbaRedeGlobal();
    const id      = _gerarId("rede_global", payload.segmento, payload.dataGeracao);
    const savedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    const d       = payload.dados;

    const dadosAba = aba.getDataRange().getValues();
    for (let i = dadosAba.length - 1; i >= 1; i--) {
      if (dadosAba[i][0] === id) aba.deleteRow(i + 1);
    }

    const split = arr => (arr || []).join(" | ");
    const JSON_sf = j => j ? JSON.stringify(j) : "[]";

    aba.appendRow([
      id,
      payload.segmento,
      payload.dataGeracao,
      savedAt,
      d.quantidade_regionais || "",
      d.quantidade_escolas   || "",
      d.quantidade_visitas   || "",
      (d.regionais_analisadas || []).join(", "),
      d.panorama_rede || "",
      split(d.desafios_sistemicos),
      split(d.pontos_fortes_rede),
      JSON_sf(d.disparidades_regionais),
      JSON_sf(d.prioridades_rede),
      split(d.recomendacoes_secretaria),
      JSON_sf(d.boas_praticas_para_replicar),
      split(d.acoes_formativas_prioritarias),
      split(d.indicadores_de_risco_rede),
      d.sintese_executiva || ""
    ]);

    _cacheClear('relat_devolutivas_v1');
    return { ok: true, id: id };
  } catch(e) {
    return { ok: false, erro: e.message };
  } finally {
    lock.releaseLock();
  }
}
