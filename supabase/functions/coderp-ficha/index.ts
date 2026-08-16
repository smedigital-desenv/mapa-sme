/* ============================================================================
   coderp-ficha — proxy autenticado para a API "ObterFichaAvaliacao" do CODERP
   (Ficha de Acompanhamento e Avaliação Bimestral de Aluno).

   POR QUE ISSO EXISTE
   -------------------
   A API do CODERP exige um token de sistema no corpo da requisição. Esse token
   é credencial: não pode ir para o navegador nem para este repositório (que é
   público). Ele fica guardado como SECRET desta função (CODERP_TOKEN) e nunca
   sai daqui.

   A intenção da API é CONSUMO AO VIVO: nada do que ela devolve é gravado no
   banco do MAPA. A função só repassa a consulta e a resposta.

   O QUE ELA FAZ
   -------------
   1. Exige uma sessão válida DESTE projeto (o token do MAPA, o mesmo que o
      banco valida). Sem sessão, 401.
   2. Confere no banco, com a identidade de quem chamou, o recorte por unidade:
      quem enxerga a rede toda (`vejo_a_rede_toda()`) consulta qualquer nível.
      Perfil de escola só consulta os níveis escola/turma/aluno COM o código
      da própria unidade: o código vira nome pela `escolas_catalogo` e o nome
      passa por `posso_ver_unidade()` — que nega por padrão. Casar a grafia do
      CODERP com o catálogo é papel da `escola_alias` (curadoria humana);
      enquanto o apelido não existe, o perfil de escola recebe 403, que é o
      lado seguro do erro.
   3. Injeta o CODERP_TOKEN no corpo e chama o endpoint correspondente ao nível
      pedido, devolvendo a resposta como veio (Messages + fichas).

   CONTRATO COM O NAVEGADOR
   ------------------------
   POST { nivel: 'aluno' | 'turma' | 'escola' | 'rede', parms: { ... } }
   com Authorization: Bearer <token do MAPA> (MapaAuth.token()).
   `parms` usa os nomes da documentação do CODERP: anoLetivo e bimestre são
   obrigatórios; escola, anoEscolar/anoescolar, turma e rema conforme o nível.

   ⚠️ DEPLOY: ao contrário da central-bridge, esta função recebe o token DESTE
   projeto, então publica-se com a verificação de JWT LIGADA (o padrão):
       supabase functions deploy coderp-ficha
   E o secret precisa existir antes do primeiro uso:
       supabase secrets set CODERP_TOKEN=...
   Opcional: CODERP_URL para trocar a URL base (padrão: ambiente dsv).
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const URL_BASE_PADRAO = 'https://gxeducdsv.coderp.sp.gov.br/xsaapids/ObterFichaAvaliacao';

// Cada nível tem seu endpoint e o NOME DO CAMPO que envelopa os parâmetros no
// corpo (parms/parmsrede/parmsescola/parmsturma — assim mesmo, é o contrato
// da API GeneXus do CODERP).
const NIVEIS: Record<string, { endpoint: string; campo: string }> = {
  aluno:  { endpoint: '/IndicadorAluno',  campo: 'parms' },
  rede:   { endpoint: '/IndicadorRede',   campo: 'parmsrede' },
  escola: { endpoint: '/IndicadorEscola', campo: 'parmsescola' },
  turma:  { endpoint: '/IndicadorTurma',  campo: 'parmsturma' },
};

// Nível SINTÉTICO — não existe na API do CODERP. Ver `detalheRede()`.
const NIVEL_DETALHE_REDE = 'detalherede';

const CORS = {
  'Access-Control-Allow-Origin': 'https://smedigital.com.br',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Cache em memória das respostas do CODERP ────────────────────────────────
// A mesma consulta de rede é repetida por todo usuário que abre a tela; o
// CODERP leva segundos para responder e o dado bimestral não muda minuto a
// minuto. Respostas pequenas (níveis agregados) ficam 10 minutos em memória:
// o primeiro acesso aquece para todos e os demais respondem na hora, sem
// tocar o CODERP. A PERMISSÃO É CHECADA ANTES do cache, por requisição — o
// cache guarda só a resposta do CODERP, nunca decide quem pode ver.
// Respostas grandes (nível aluno) ficam de fora para não estourar a memória
// do isolate. O cache morre com o isolate — é otimização, não fonte.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_BYTES = 400_000;      // limite APÓS compressão (~4 MB de JSON)
// O agregado da rede (`detalherede`) é maior por natureza — ~600 kB
// comprimido — e é exatamente o que faz a tela abrir com todas as turmas.
// Cabe folgadamente na memória do isolate: são 4 itens, um por bimestre.
const CACHE_MAX_BYTES_DETALHE = 3_000_000;
const CACHE_MAX_ITENS = 120;
const _cache = new Map<string, { t: number; gz: Uint8Array }>();

// Gzip: o JSON do nível aluno (~1,2 MB por escola) comprime ~10x, então até
// ele cabe no cache sem estourar a memória do isolate.
async function comprimir(texto: string): Promise<Uint8Array> {
  const s = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function descomprimir(gz: Uint8Array): Promise<string> {
  const s = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(s).text();
}

async function cacheLe(chave: string): Promise<string | null> {
  const hit = _cache.get(chave);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) { _cache.delete(chave); return null; }
  return await descomprimir(hit.gz);
}

async function cacheGrava(chave: string, corpo: string, tetoBytes = CACHE_MAX_BYTES) {
  const gz = await comprimir(corpo);
  if (gz.length > tetoBytes) return;
  if (_cache.size >= CACHE_MAX_ITENS) {
    const primeira = _cache.keys().next().value;
    if (primeira !== undefined) _cache.delete(primeira);
  }
  _cache.set(chave, { t: Date.now(), gz });
}

/* ── Nível sintético `detalherede` ──────────────────────────────────────────
   POR QUE EXISTE
   --------------
   A turma só aparece no nível ALUNO: os níveis agregados devolvem per_cod e
   tur_cod vazios (não há endpoint que liste turmas). Para a tela mostrar TODAS
   as turmas da rede sem clique, alguém precisa buscar as ~112 fichas por
   escola — cerca de 300 MB de JSON por bimestre.

   Fazer isso NO NAVEGADOR foi tentado e é inviável: baixar e desserializar
   ~3 MB por unidade na thread da interface travava a tela por minutos, e o
   custo se repetia para cada pessoa que abrisse o sistema.

   Aqui o mesmo trabalho é feito UMA vez, perto do CODERP, e o que trafega é só
   o resultado reduzido (~9 MB de JSON, ~600 kB comprimido) — servido do cache
   de 10 minutos para todo mundo. É a diferença entre 300 MB por usuário e
   600 kB compartilhados.

   O QUE VOLTA (campos CRUS do CODERP, de propósito)
   -------------------------------------------------
   A função NÃO normaliza nome de unidade, disciplina nem rótulo de resposta:
   essas regras vivem no front (cleanUnit/normalizarDisciplina/
   labelRespostaPainel) e duplicá-las aqui criaria duas verdades que divergem
   em silêncio. O servidor só AGREGA; quem nomeia é a tela.

     linhas: [uni_cod, per_cod, tur_cod, fnc_des, fne_des, fqr_vl, fqr_txt, qtd]
     hier:   [uni_cod, per_cod, tur_cod, qtd]

   `qtd` conta ALUNOS DISTINTOS (REMA), nunca linhas: um item pode ter mais de
   uma pergunta por aluno, e contar linhas infla o total.                     */

// Separador das chaves de agregação: caractere de controle, que não ocorre
// em texto vindo da API. Um '|' partiria uma descrição que o contenha.
const SEP = '\u0001';
const DR_CONCORRENCIA = 8;         // fichas de escola buscadas ao mesmo tempo
const DR_ORCAMENTO_MS = 100_000;   // teto de tempo: devolve parcial em vez de estourar

// Deduplicação de leques SIMULTÂNEOS. Sem isto, dez pessoas abrindo a tela no
// mesmo minuto (com o cache frio) disparariam dez leques de ~112 consultas ao
// CODERP. O primeiro pedido faz o trabalho; os demais aguardam a MESMA
// promessa e recebem a mesma resposta. Vale dentro de um isolate — é
// mitigação de rajada, não coordenação global.
const _emVoo = new Map<string, Promise<string>>();

async function chamarCoderp(
  urlBase: string, endpoint: string, campo: string, token: string, parms: unknown,
): Promise<any> {
  const r = await fetch(urlBase + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth: { token }, [campo]: parms }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`${endpoint} HTTP ${r.status}`);
  return await r.json();
}

async function detalheRede(
  urlBase: string, token: string, anoLetivo: number, bimestre: number, escolaUnica?: number,
) {
  // 1) Quais unidades têm lançamento neste bimestre.
  let codigos: number[];
  if (Number.isInteger(escolaUnica)) {
    codigos = [escolaUnica as number];
  } else {
    const d = await chamarCoderp(urlBase, '/IndicadorEscola', 'parmsescola', token,
      { anoLetivo, bimestre });
    const vistos = new Set<number>();
    for (const e of (d?.fichasAvaliacoesEscola || [])) {
      const c = Number(e?.uni_cod);
      if (Number.isFinite(c)) vistos.add(c);
    }
    codigos = Array.from(vistos);
  }

  const linhas: unknown[][] = [];
  const hier: unknown[][] = [];
  const faltando: number[] = [];
  const inicio = Date.now();
  let i = 0;

  async function trabalhador() {
    while (i < codigos.length) {
      const cod = codigos[i++];
      // Orçamento estourado: marca o resto como faltante em vez de derrubar a
      // resposta inteira. Parcial é útil — o front mescla o que chegou sobre o
      // pacote agregado, que já tem os totais certos.
      if (Date.now() - inicio > DR_ORCAMENTO_MS) { faltando.push(cod); continue; }
      try {
        const d = await chamarCoderp(urlBase, '/IndicadorAluno', 'parms', token,
          { anoLetivo, bimestre, escola: cod });

        // Agregação LOCAL à escola: os Sets de REMA morrem ao fim de cada
        // unidade. Mantê-los todos vivos até o final estouraria a memória do
        // isolate (centenas de milhares de Sets).
        const ag = new Map<string, Set<string>>();
        const porAT = new Map<string, Set<string>>();
        for (const r of (d?.fichasAvaliacoesAluno || [])) {
          const rema = String(r?.alu_rema ?? '');
          if (!rema) continue;
          const per = String(r?.per_cod ?? '').trim();
          const tur = String(r?.tur_cod ?? '').trim();
          const k = [per, tur, String(r?.fnc_des ?? ''), String(r?.fne_des ?? ''),
                     String(r?.fqr_vl ?? ''), String(r?.fqr_txt_resp ?? '')].join(SEP);
          let s = ag.get(k); if (!s) { s = new Set(); ag.set(k, s); } s.add(rema);
          const kh = per + SEP + tur;
          let sh = porAT.get(kh); if (!sh) { sh = new Set(); porAT.set(kh, sh); } sh.add(rema);
        }
        for (const [k, s] of ag) {
          const p = k.split(SEP);
          linhas.push([cod, p[0], p[1], p[2], p[3], p[4], p[5], s.size]);
        }
        for (const [kh, s] of porAT) {
          const p = kh.split(SEP);
          hier.push([cod, p[0], p[1], s.size]);
        }
      } catch (e) {
        console.warn(`[coderp-ficha] detalherede: escola ${cod} falhou: ${String(e)}`);
        faltando.push(cod);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DR_CONCORRENCIA, codigos.length) }, trabalhador),
  );

  return {
    ok: true,
    anoLetivo, bimestre,
    escolas: codigos.length,
    parcial: faltando.length > 0,
    faltando,
    linhas, hier,
    geradoEm: new Date().toISOString(),
  };
}

function json(body: unknown, status = 200) {
  if (status >= 400) console.error(`[coderp-ficha] ${status}`, JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'metodo_invalido' }, 405);

  try {
    // ── 1) Sessão válida DESTE projeto ─────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ erro: 'sem_token' }, 401);

    const urlMapa = Deno.env.get('SUPABASE_URL') || '';
    const anonMapa = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const sb = createClient(urlMapa, anonMapa, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: quem, error: eUser } = await sb.auth.getUser();
    if (eUser || !quem?.user) return json({ erro: 'token_invalido' }, 401);

    // ── 2) Valida o pedido ─────────────────────────────────────────────────
    const corpo = await req.json().catch(() => null);
    const chaveNivel = String(corpo?.nivel || '').toLowerCase();
    const ehDetalheRede = chaveNivel === NIVEL_DETALHE_REDE;
    const nivel = NIVEIS[chaveNivel];
    if (!nivel && !ehDetalheRede) {
      return json({ erro: 'nivel_invalido',
                    aceitos: Object.keys(NIVEIS).concat(NIVEL_DETALHE_REDE) }, 400);
    }

    const parms = corpo?.parms;
    if (!parms || typeof parms !== 'object') return json({ erro: 'parms_ausente' }, 400);
    if (!Number.isInteger(parms.anoLetivo) || !Number.isInteger(parms.bimestre)) {
      return json({ erro: 'parms_incompleto', detalhe: 'anoLetivo e bimestre são obrigatórios (inteiros)' }, 400);
    }
    if (parms.bimestre < 1 || parms.bimestre > 4) {
      return json({ erro: 'bimestre_invalido', detalhe: 'bimestre aceita 1 a 4' }, 400);
    }

    // ── 3) Permissão: recorte por unidade, decidido NO BANCO ───────────────
    // A checagem roda com a identidade de quem chamou — o gate do navegador é
    // conforto, não segurança. `vejo_a_rede_toda()` e `posso_ver_unidade()`
    // negam por padrão: quem o banco não reconhece não passa.
    const { data: redeToda, error: ePerm } = await sb.rpc('vejo_a_rede_toda');
    if (ePerm) return json({ erro: 'falha_ao_verificar_permissao', detalhe: ePerm.message }, 500);

    if (!redeToda) {
      // Perfil de escola: nível de rede não; os demais só com o código da
      // PRÓPRIA unidade informado. Sem código, a API devolveria a rede toda —
      // inclusive aluno a aluno — e é exatamente isso que não pode.
      if (chaveNivel === 'rede') return json({ erro: 'sem_permissao' }, 403);
      if (!Number.isInteger(parms.escola)) {
        return json({ erro: 'escola_obrigatoria',
                      detalhe: 'seu perfil exige informar o código da unidade' }, 403);
      }
      // Código CODERP -> grafia oficial do catálogo de referência.
      const { data: cat, error: eCat } = await sb
        .from('escolas_catalogo').select('nome').eq('codigo', parms.escola).maybeSingle();
      if (eCat) return json({ erro: 'falha_ao_verificar_permissao', detalhe: eCat.message }, 500);
      if (!cat?.nome) return json({ erro: 'sem_permissao' }, 403);

      // A grafia do CODERP casa com a unidade da pessoa? Quem responde é o
      // banco (escola_alias + mapa_norm), e a resposta padrão é NÃO.
      const { data: podeVer, error: eVer } = await sb.rpc('posso_ver_unidade', { nome: cat.nome });
      if (eVer) return json({ erro: 'falha_ao_verificar_permissao', detalhe: eVer.message }, 500);
      if (!podeVer) return json({ erro: 'sem_permissao' }, 403);
    }

    // ── 4) Monta e repassa a consulta ao CODERP ────────────────────────────
    const tokenCoderp = Deno.env.get('CODERP_TOKEN') || '';
    if (!tokenCoderp) {
      return json({ erro: 'ambiente_incompleto', detalhe: 'secret CODERP_TOKEN ausente' }, 500);
    }
    const urlBase = (Deno.env.get('CODERP_URL') || URL_BASE_PADRAO).replace(/\/+$/, '');

    // Cache: a chave é a consulta inteira (nível + parâmetros), nunca o
    // usuário — a permissão já foi decidida acima, por requisição.
    const chaveCache = chaveNivel + '|' + JSON.stringify(parms);
    const emCache = await cacheLe(chaveCache);
    if (emCache !== null) {
      return new Response(emCache, {
        headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'hit' },
      });
    }

    // Nível sintético: em vez de repassar UMA consulta, faz o leque de fichas
    // por escola e devolve só o agregado. Cache maior porque a resposta é
    // maior — e é justamente ela que faz a tela abrir pronta.
    if (ehDetalheRede) {
      console.log(`[coderp-ficha] ${quem.user.email} -> detalherede`
        + ` ano=${parms.anoLetivo} bim=${parms.bimestre}`
        + (Number.isInteger(parms.escola) ? ` escola=${parms.escola}` : ' (rede)'));
      // Um leque igual já em andamento? Aguarda o mesmo, não dispara outro.
      let promessa = _emVoo.get(chaveCache);
      const juntou = !!promessa;
      if (!promessa) {
        const t0 = Date.now();
        promessa = (async () => {
          const resultado = await detalheRede(
            urlBase, tokenCoderp, parms.anoLetivo, parms.bimestre,
            Number.isInteger(parms.escola) ? parms.escola : undefined,
          );
          const texto = JSON.stringify(resultado);
          console.log(`[coderp-ficha] detalherede pronto em ${Date.now() - t0}ms:`
            + ` ${resultado.escolas} escolas, ${resultado.linhas.length} linhas`
            + (resultado.parcial ? `, PARCIAL (${resultado.faltando.length} faltando)` : ''));
          // Resposta parcial não entra no cache: congelar uma rede incompleta
          // por 10 min esconderia unidades de quem tem direito a elas.
          if (!resultado.parcial) await cacheGrava(chaveCache, texto, CACHE_MAX_BYTES_DETALHE);
          return texto;
        })();
        _emVoo.set(chaveCache, promessa);
        // Libera a vaga SEMPRE — inclusive em erro, senão a falha ficaria
        // grudada e todo pedido seguinte herdaria a mesma exceção.
        promessa.finally(() => { if (_emVoo.get(chaveCache) === promessa) _emVoo.delete(chaveCache); });
      }
      const texto = await promessa;
      return new Response(texto, {
        headers: { ...CORS, 'Content-Type': 'application/json',
                   'X-Cache': juntou ? 'coalesced' : 'miss' },
      });
    }

    console.log(`[coderp-ficha] ${quem.user.email} -> ${nivel!.endpoint}`
      + ` ano=${parms.anoLetivo} bim=${parms.bimestre}`);

    let r: Response;
    try {
      r = await fetch(urlBase + nivel!.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth: { token: tokenCoderp }, [nivel!.campo]: parms }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      const timeout = e instanceof DOMException && e.name === 'TimeoutError';
      return json({ erro: timeout ? 'coderp_timeout' : 'falha_ao_chamar_coderp',
                    detalhe: String(e) }, 504);
    }

    const texto = await r.text();
    let resposta: unknown;
    try { resposta = JSON.parse(texto); }
    catch {
      // Resposta não-JSON (página de erro do gateway, por exemplo): repassa o
      // status e um recorte do texto para diagnóstico, nunca o token.
      return json({ erro: 'coderp_resposta_invalida', status: r.status,
                    detalhe: texto.slice(0, 500) }, 502);
    }
    if (!r.ok) return json({ erro: 'coderp_recusou', status: r.status, resposta }, 502);

    await cacheGrava(chaveCache, texto);
    return json(resposta);
  } catch (e) {
    console.error('[coderp-ficha] excecao', e instanceof Error ? e.stack : String(e));
    return json({ erro: 'falha_inesperada', detalhe: String(e) }, 500);
  }
});
