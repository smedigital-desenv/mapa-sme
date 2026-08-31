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
   AMBIENTE: o padrão é o de TESTES do CODERP. Produção é configuração, não
   código — cadastre o secret:
       CODERP_URL=https://gxeduc.coderp.sp.gov.br/xsapr/ObterFichaAvaliacao
   (e o CODERP_TOKEN correspondente ao ambiente). Atenção: o projeto Supabase
   é um só, então homologação e produção do site consomem o MESMO ambiente
   CODERP — o que estiver nos secrets vale para os dois.
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const URL_BASE_PADRAO = 'https://gxeducdsv.coderp.sp.gov.br/xsads/ObterFichaAvaliacao';

// Cada nível tem seu endpoint e o NOME DO CAMPO que envelopa os parâmetros no
// corpo (parms/parmsrede/parmsescola/parmsturma — assim mesmo, é o contrato
// da API GeneXus do CODERP).
const NIVEIS: Record<string, { endpoint: string; campo: string }> = {
  aluno:  { endpoint: '/IndicadorAluno',  campo: 'parms' },
  rede:   { endpoint: '/IndicadorRede',   campo: 'parmsrede' },
  escola: { endpoint: '/IndicadorEscola', campo: 'parmsescola' },
  turma:  { endpoint: '/IndicadorTurma',  campo: 'parmsturma' },
};

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

async function cacheGrava(chave: string, corpo: string) {
  const gz = await comprimir(corpo);
  if (gz.length > CACHE_MAX_BYTES) return;
  if (_cache.size >= CACHE_MAX_ITENS) {
    const primeira = _cache.keys().next().value;
    if (primeira !== undefined) _cache.delete(primeira);
  }
  _cache.set(chave, { t: Date.now(), gz });
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
    const nivel = NIVEIS[chaveNivel];
    if (!nivel) return json({ erro: 'nivel_invalido', aceitos: Object.keys(NIVEIS) }, 400);

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

    console.log(`[coderp-ficha] ${quem.user.email} -> ${nivel.endpoint}`
      + ` ano=${parms.anoLetivo} bim=${parms.bimestre}`);

    let r: Response;
    try {
      r = await fetch(urlBase + nivel.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth: { token: tokenCoderp }, [nivel.campo]: parms }),
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
