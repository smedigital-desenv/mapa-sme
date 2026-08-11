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

// Cabeçalho HTTP só aceita ASCII imprimível. Um caractere invisível que entre
// na cópia do código (espaço não separável, hífen suave, quebra fantasma) faz
// o fetch estourar com "not a valid ByteString" — erro que não diz onde está.
// Chave e token são base64url por natureza, então limpar é seguro.
function soAscii(s: string) {
  return String(s || '').replace(/[^\x21-\x7E]/g, '');
}

function json(body: unknown, status = 200) {
  // Toda resposta de erro vai para o log da função. Sem isto, uma falha aparece
  // no navegador como 500 e o painel mostra so "booted"/"shutdown" — nada que
  // ajude a descobrir onde quebrou.
  if (status >= 400) console.error(`[central-bridge] ${status}`, JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'metodo_invalido' }, 405);

  try {
    console.log('[central-bridge] chamada recebida');
    const token = soAscii((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
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
    let r: Response;
    try {
      r = await fetch(`${CENTRAL_URL}/rest/v1/rpc/minhas_permissoes`, {
        method: 'POST',
        headers: {
          apikey: soAscii(CENTRAL_ANON),
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    } catch (e) {
      return json({ erro: 'falha_ao_chamar_central', detalhe: String(e) }, 502);
    }
    if (!r.ok) {
      return json({ erro: 'central_recusou', status: r.status,
                    detalhe: await r.text().catch(() => '') }, 502);
    }

    const perms = await r.json();
    if (!perms?.autorizado) return json({ erro: 'nao_autorizado' }, 403);

    const temMapa = Array.isArray(perms.sistemas)
      && perms.sistemas.some((s: { slug?: string }) => s?.slug === SISTEMA);
    if (!temMapa) return json({ erro: 'sem_acesso_ao_mapa' }, 403);

    // O e-mail do token e o das permissões têm que ser o mesmo. Divergiu,
    // alguma coisa está errada — não emite sessão.
    const emailPerms = String(perms?.perfil?.email || '').trim().toLowerCase();
    if (emailPerms && emailPerms !== email) return json({ erro: 'email_divergente' }, 403);

    // ── 2b) SIMULAÇÃO: super admin abrindo o sistema como outra pessoa ──────
    // Isto é personificação de verdade: a sessão emitida é a do simulado, e o
    // banco passa a enxergá-lo. É o único jeito de conferir o isolamento por
    // escola agora que ele vive no Postgres e não mais no JavaScript.
    // Só super admin do CENTRAL pode, e quem decide isso é o central, não o
    // navegador — a resposta de minhas_permissoes já foi validada acima.
    let alvo = email;
    const corpo = await req.json().catch(() => ({}));
    const simular = String(corpo?.simular || '').trim().toLowerCase();
    if (simular && simular !== email) {
      if (!perms?.perfil?.is_super_admin) return json({ erro: 'simulacao_negada' }, 403);
      console.log(`[central-bridge] SIMULACAO: ${email} abrindo como ${simular}`);
      alvo = simular;
    }

    // ── 3) Emite a sessão AQUI, no projeto do MAPA ─────────────────────────
    const urlMapa = soAscii(Deno.env.get('SUPABASE_URL') || '');
    const chaveMapa = soAscii(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    if (!urlMapa || !chaveMapa) {
      return json({ erro: 'ambiente_incompleto',
                    detalhe: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente' }, 500);
    }

    const admin = createClient(urlMapa, chaveMapa, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let link = await admin.auth.admin.generateLink({ type: 'magiclink', email: alvo });

    // Primeiro acesso de quem existe no central mas ainda não tem usuário aqui:
    // cria com o e-mail já confirmado e tenta de novo.
    if (link.error) {
      const criado = await admin.auth.admin.createUser({ email: alvo, email_confirm: true });
      if (criado.error && !/already/i.test(criado.error.message)) {
        return json({ erro: 'falha_ao_criar_usuario', detalhe: criado.error.message }, 500);
      }
      link = await admin.auth.admin.generateLink({ type: 'magiclink', email: alvo });
    }
    if (link.error) return json({ erro: 'falha_ao_gerar_sessao', detalhe: link.error.message }, 500);

    const hash = link.data?.properties?.hashed_token;
    const otp = link.data?.properties?.email_otp;
    if (!hash && !otp) return json({ erro: 'sem_token_de_sessao' }, 500);

    // Vincula o perfil do MAPA ao usuário de auth, se ainda não estiver.
    // É o que faz `perfis.auth_user_id` continuar casando com `auth.uid()`.
    const uid = link.data?.user?.id;
    if (uid) {
      await admin.from('perfis').update({ auth_user_id: uid })
        .eq('email', alvo).is('auth_user_id', null);
    }

    // ── 4) Abre a sessao SEM depender de OTP ───────────────────────────────
    // O caminho do magic link nao funciona aqui: mesmo gerando e verificando no
    // mesmo processo, em milissegundos, o GoTrue responde "otp_expired". Nao e
    // tempo — e o formato do token, que esse fluxo nao aceita.
    //
    // Entao trocamos por algo deterministico: definimos uma senha aleatoria
    // para o usuario e pegamos a sessao pelo grant de senha. A senha e gerada
    // aqui, nunca sai desta funcao, nunca vai para o navegador e e substituida
    // a cada acesso. Ninguem faz login com senha no MAPA — a autenticacao real
    // acontece no central, e e ela que ja foi validada nos passos 1 e 2.
    const anonMapa = soAscii(Deno.env.get('SUPABASE_ANON_KEY') || '');
    // 36 caracteres, 122 bits de entropia. O GoTrue limita a senha a 72, e dois
    // UUIDs concatenados davam 73 — um a mais. Um so ja e muito mais do que o
    // suficiente para um segredo que nunca sai daqui e e trocado a cada acesso.
    const senha = crypto.randomUUID();

    const upd = await admin.auth.admin.updateUserById(uid!, { password: senha });
    if (upd.error) {
      return json({ erro: 'falha_ao_preparar_sessao', detalhe: upd.error.message }, 500);
    }

    const v = await fetch(`${urlMapa}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonMapa, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: alvo, password: senha }),
    });
    const sessao = await v.json().catch(() => null);
    if (!v.ok || !sessao?.access_token) {
      return json({ erro: 'falha_ao_abrir_sessao', status: v.status,
                    detalhe: JSON.stringify(sessao) }, 500);
    }

    return json({
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
      email: alvo,
      simulando: alvo !== email ? email : null,
    });
  } catch (e) {
    console.error('[central-bridge] excecao', e instanceof Error ? e.stack : String(e));
    return json({ erro: 'falha_inesperada', detalhe: String(e) }, 500);
  }
});
