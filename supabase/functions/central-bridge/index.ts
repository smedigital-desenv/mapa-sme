/* ============================================================================
   central-bridge — troca o token do Controle de Acesso CENTRAL por uma sessão
   real deste projeto (MAPA).

   POR QUE ISSO EXISTE
   -------------------
   O login da rede acontece no projeto CENTRAL. O MAPA é outro projeto Supabase,
   com outra chave, e o painel não oferece "Third-Party Auth" com JWKS
   customizado — só Firebase/Clerk/WorkOS/Auth0/Cognito. Sem uma ponte, as
   consultas do MAPA sairiam como `anon`, que (de propósito) não tem permissão
   nenhuma no banco: foi assim que o vazamento de dados de aluno foi fechado.

   O QUE ELA FAZ
   -------------
   1. Confere a ASSINATURA ES256 do token do central contra o JWKS público dele.
   2. Confere no próprio central que a pessoa tem acesso ao sistema 'mapa'.
   3. Emite um magic link para esse e-mail AQUI e devolve só o token_hash.
   O navegador troca esse hash por uma sessão do MAPA (verifyOtp), e a partir
   daí `auth.uid()` volta a funcionar — as policies e o `perfis.auth_user_id`
   continuam valendo exatamente como antes.

   Uma chamada por sessão, não uma por consulta.

   ⚠️ DEPLOY: precisa ser publicada SEM verificação de JWT embutida, porque o
   token que chega é de OUTRO projeto e o Supabase o rejeitaria antes de nós:
       supabase functions deploy central-bridge --no-verify-jwt
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createRemoteJWKSet, jwtVerify } from 'https://deno.land/x/jose@v5.9.6/index.ts';

const CENTRAL_URL = 'https://pvdhepvtoavkyoschkod.supabase.co';
const CENTRAL_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2ZGhlcHZ0b2F2a3lvc2Noa29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTUzNDQsImV4cCI6MjA5Nzk5MTM0NH0.BY6jPR9iDvh2xRlGtaU8vdKWp0NKyC7Amlzx-tytmrk';
const SISTEMA = 'mapa';

// O JWKS é buscado uma vez e fica em cache pela lib, com rotação automática.
const JWKS = createRemoteJWKSet(new URL(`${CENTRAL_URL}/auth/v1/.well-known/jwks.json`));

// Não é controle de segurança (chamada de servidor para servidor ignora CORS),
// mas fecha o uso a partir de outros sites e não custa nada.
const CORS = {
  'Access-Control-Allow-Origin': 'https://smedigital.com.br',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'metodo_invalido' }, 405);

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ erro: 'sem_token' }, 401);

    // ── 1) A assinatura é mesmo do central? O token ainda vale? ─────────────
    let email = '';
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `${CENTRAL_URL}/auth/v1`,
      });
      email = String(payload.email || '').trim().toLowerCase();
    } catch (_e) {
      return json({ erro: 'token_invalido' }, 401);
    }
    if (!email) return json({ erro: 'token_sem_email' }, 401);

    // ── 2) O central confirma que essa pessoa pode entrar no MAPA ──────────
    // Repetimos a checagem aqui de propósito: o gate do navegador é conforto,
    // não segurança — qualquer um pode chamar esta função direto.
    const r = await fetch(`${CENTRAL_URL}/rest/v1/rpc/minhas_permissoes`, {
      method: 'POST',
      headers: {
        apikey: CENTRAL_ANON,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!r.ok) return json({ erro: 'central_indisponivel' }, 502);

    const perms = await r.json();
    if (!perms?.autorizado) return json({ erro: 'nao_autorizado' }, 403);

    const temMapa = Array.isArray(perms.sistemas)
      && perms.sistemas.some((s: { slug?: string }) => s?.slug === SISTEMA);
    if (!temMapa) return json({ erro: 'sem_acesso_ao_mapa' }, 403);

    // O e-mail do token e o das permissões têm que ser o mesmo. Divergiu,
    // alguma coisa está errada — não emite sessão.
    const emailPerms = String(perms?.perfil?.email || '').trim().toLowerCase();
    if (emailPerms && emailPerms !== email) return json({ erro: 'email_divergente' }, 403);

    // ── 3) Emite a sessão AQUI, no projeto do MAPA ─────────────────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    let link = await admin.auth.admin.generateLink({ type: 'magiclink', email });

    // Primeiro acesso de alguém que existe no central mas ainda não tem
    // usuário aqui: cria e tenta de novo.
    if (link.error) {
      const criado = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (criado.error && !/already/i.test(criado.error.message)) {
        return json({ erro: 'falha_ao_criar_usuario', detalhe: criado.error.message }, 500);
      }
      link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    }
    if (link.error) return json({ erro: 'falha_ao_gerar_sessao', detalhe: link.error.message }, 500);

    const hash = link.data?.properties?.hashed_token;
    if (!hash) return json({ erro: 'sem_hash' }, 500);

    // Vincula o perfil do MAPA ao usuário de auth, se ainda não estiver.
    // É o que faz `perfis.auth_user_id` continuar casando com `auth.uid()`.
    const uid = link.data?.user?.id;
    if (uid) {
      await admin.from('perfis').update({ auth_user_id: uid })
        .eq('email', email).is('auth_user_id', null);
    }

    return json({ token_hash: hash, email });
  } catch (e) {
    return json({ erro: 'falha_inesperada', detalhe: String(e) }, 500);
  }
});
