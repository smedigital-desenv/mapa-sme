# Controle de Acesso Central — Guia de Configuração

Login único com **Google** + autorização por **perfis / escolas / sistemas / telas**,
compartilhado entre todos os sistemas servidos no mesmo domínio
(`smedigital.com.br/<sistema>`). Piloto: **MAPA**.

## Arquitetura em 1 parágrafo

A identidade vem do **Supabase Auth (Google)**. A autorização é modelada no banco
(`sql/07_controle_acesso.sql`): a secretaria pré-cadastra os **e-mails autorizados**
(`perfis`), vincula-os às **escolas** e atribui **papéis por sistema**. Como todos os
sistemas ficam no mesmo domínio, a sessão do Supabase no `localStorage` é compartilhada
— **login uma vez, vale para todos**. No front, `auth-guard.js` faz o gate rápido de
sessão e `auth.js` valida permissões e esconde o que o usuário não pode ver. A RLS no
banco é a segurança real.

---

## Passo 1 — Credenciais OAuth no Google Cloud

1. [console.cloud.google.com](https://console.cloud.google.com) → crie/selecione um projeto (ex.: "SME Sistemas").
2. **APIs e serviços → Tela de consentimento OAuth**
   - Tipo: **Externo** (ou Interno, se todos os e-mails forem do mesmo Workspace).
   - Preencha nome do app, e-mail de suporte e domínios.
3. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**
   - Tipo: **Aplicativo da Web**.
   - **URIs de redirecionamento autorizados** → adicione exatamente:
     ```
     https://gmwotfulohkmuqrezeef.supabase.co/auth/v1/callback
     ```
   - Salve o **Client ID** e o **Client Secret**.

> A URL de callback é sempre `https://<seu-ref>.supabase.co/auth/v1/callback`.
> Aqui o ref é `gmwotfulohkmuqrezeef`.

## Passo 2 — Ativar o Google no Supabase

1. Painel Supabase → **Authentication → Providers → Google** → **Enable**.
2. Cole o **Client ID** e o **Client Secret** do Passo 1. Salve.
3. **Authentication → URL Configuration**:
   - **Site URL**: `https://smedigital.com.br`
   - **Redirect URLs** (adicione todas que usar, uma por linha):
     ```
     https://smedigital.com.br/**
     http://localhost:*/**          (opcional, para testar local)
     ```

## Passo 3 — Criar o modelo de acesso no banco

1. Painel Supabase → **SQL Editor**.
2. Cole o conteúdo de [`sql/07_controle_acesso.sql`](sql/07_controle_acesso.sql) e **Run**.
   - Cria tabelas, funções, RLS e já popula: o sistema **MAPA** + suas telas + papéis
     (`admin`, `leitor`) e o super admin `desenv.sme@gmail.com`.

## Passo 3b — Permissão de tela por perfil (obrigatório p/ a tela de Configurações)

Rode também [`sql/08_perfil_telas.sql`](sql/08_perfil_telas.sql). Ele cria a tabela
`perfil_tela` (liberar telas **direto por perfil**, 1 checkbox por tela) e reescreve
`minhas_permissoes()` para unir três fontes de acesso: super admin (tudo), `perfil_tela`
(o jeito novo, usado pela tela de Configurações) e o papel/`papel_permissoes` (legado).
Essa função também aplica a **restrição de domínio**: só e-mails
`@educacao.pmrp.sp.gov.br` entram (super admin é exceção).

## Passo 3d — Simular acesso + liberar e-mail fora do domínio

Rode [`sql/10_simular_acesso.sql`](sql/10_simular_acesso.sql). Ele:
- refatora `minhas_permissoes()` numa função única (`permissoes_json`) e cria
  `permissoes_de(email)` — usada para o **super admin simular** o acesso de
  qualquer perfil (faixa "Encerrar simulação" no topo);
- **libera `matheusprospero@gmail.com`** (fora do domínio) como super admin.

No painel de Configurações, o botão <i>incógnito</i> ao lado de cada perfil entra
no modo simulação. Ordem completa: `sql/07` → `sql/08` → `sql/09` → `sql/10` → `sql/11`.

[`sql/11_bypass_dominio.sql`](sql/11_bypass_dominio.sql) adiciona a flag
`perfis.bypass_dominio`: libera um e-mail **fora do domínio** (ex.: `@gmail.com`) a
logar como usuário normal, sem ser super admin. Na tela de Configurações há o
checkbox "Permitir login fora do domínio".

## Passo 3c — Migrar os usuários/unidades antigos (opcional, recomendado)

Se você já tinha o controle antigo dentro de avaliações (tabelas `usuarios` e
`unidades`), rode [`sql/09_migrar_usuarios_unidades.sql`](sql/09_migrar_usuarios_unidades.sql).
Ele traz as **escolas** e os **usuários** já cadastrados para o modelo novo (sem
sobrescrever nada e sem promover ninguém a super admin). Depois disso a tela única
de Configurações já mostra tudo, e você ajusta telas/ADM por lá.

## Passo 4 — Cadastrar escolas, perfis e acessos

> Agora isso é feito pela **tela de Configurações** (engrenagem no menu do `index.html`,
> visível só para **super admin**): cadastrar e-mail, marcar as telas que o perfil acessa
> e vincular a uma ou mais unidades. O super admin inicial (`desenv.sme@gmail.com`) vem do
> seed do `sql/07`. Os exemplos por SQL abaixo seguem válidos como alternativa:

```sql
-- 1) Escolas
insert into public.escolas (codigo_inep, nome, email_institucional) values
  ('35000001', 'EMEF João da Silva', 'emef.joao@educacao.pmrp.sp.gov.br'),
  ('35000002', 'EMEI Maria Souza',  'emei.maria@educacao.pmrp.sp.gov.br');

-- 2) Perfis (e-mails autorizados). tipo: 'secretaria' | 'escola' | 'externo'
insert into public.perfis (email, nome, tipo) values
  ('gestor.joao@educacao.pmrp.sp.gov.br', 'Gestor da EMEF João', 'escola'),
  ('tecnico.sme@educacao.pmrp.sp.gov.br', 'Técnico SME',         'secretaria');

-- 3) Vincular perfil à escola (e-mails vinculados às escolas)
insert into public.perfil_escola (perfil_id, escola_id, vinculo)
select p.id, e.id, 'gestor'
from public.perfis p, public.escolas e
where p.email = 'gestor.joao@educacao.pmrp.sp.gov.br'
  and e.codigo_inep = '35000001';

-- 4) Dar acesso a um sistema com um papel
--    Ex.: gestor da escola entra no MAPA como 'leitor'; técnico SME como 'admin'.
insert into public.perfil_papeis (perfil_id, papel_id)
select p.id, pa.id
from public.perfis p
join public.papeis pa on pa.slug = 'leitor'
join public.sistemas s on s.id = pa.sistema_id and s.slug = 'mapa'
where p.email = 'gestor.joao@educacao.pmrp.sp.gov.br';

insert into public.perfil_papeis (perfil_id, papel_id)
select p.id, pa.id
from public.perfis p
join public.papeis pa on pa.slug = 'admin'
join public.sistemas s on s.id = pa.sistema_id and s.slug = 'mapa'
where p.email = 'tecnico.sme@educacao.pmrp.sp.gov.br';
```

> **Super admin** (secretaria com acesso total): `update public.perfis set is_super_admin = true where email = '...';`

## Passo 5 — Testar

1. Acesse `https://smedigital.com.br/mapa-sme/` (ou abra `index.html` no domínio).
2. Sem sessão → cai em `login.html` → **Entrar com Google**.
3. E-mail cadastrado e com papel no MAPA → entra; vê só os módulos permitidos.
4. E-mail logado mas **não cadastrado** → mensagem "conta não autorizada".

---

## Como ligar OUTRO sistema (gom, sate, revista…)

1. No banco, cadastre o sistema, suas telas e papéis:
   ```sql
   insert into public.sistemas (slug, nome, url, icone, cor, ordem)
   values ('gom', 'GOM', '/gom-sme/', 'bi-tools', '#7c3aed', 2);
   -- depois: insert nas tabelas telas / papeis / papel_permissoes (ver o seed do MAPA)
   ```
2. **Copie** `auth-guard.js`, `auth.js` e `login.html` para o repositório do outro sistema.
3. Em cada página protegida, no `<head>` (antes de tudo):
   ```html
   <script src="auth-guard.js"></script>
   <script>window.MAPA_SISTEMA = 'gom';</script>   <!-- slug do sistema -->
   <script src="auth.js" defer></script>
   ```
4. Marque links/botões opcionais com `data-tela="slug"` (some se não puder ver) ou
   `data-perm="tela:editar"` (some se não puder editar).

No JS da página, use a API quando precisar:
```js
document.addEventListener('mapa-auth-pronto', (e) => {
  const A = e.detail;                 // = window.MapaAuth
  if (A.can('avaliacao', 'exportar')) { /* mostra botão exportar */ }
  console.log(A.perfil.nome, A.escolas);
});
```

---

## FASE 2 — Trancar os DADOS por escola (importante)

Hoje as tabelas de dados (turmas, avaliações, fluência…) são lidas com a **anon key
sem RLS** — qualquer um com a chave lê tudo. O login resolve "quem entra"; ele **ainda
não** resolve "quem vê quais dados". Para fechar o vazamento de fato:

1. Habilite RLS na tabela e crie policy por escola (exemplo no fim do `07_controle_acesso.sql`).
2. Faça as consultas enviarem o **token do usuário** em vez da anon key, usando
   `MapaAuth.authFetch(url, opts)` (já injeta `Authorization: Bearer <token>`).
3. Garanta que cada tabela de dados tenha como ligar o registro à escola
   (coluna `escola_id` ou `codigo_inep`).

Isso é uma migração cuidadosa (toca todas as consultas) — recomendo fazer depois que
o login do piloto estiver validado.

---

## Arquivos deste piloto

| Arquivo | Papel |
|---|---|
| `sql/07_controle_acesso.sql` | Esquema, RLS, funções, RPC `minhas_permissoes()` e seed do MAPA |
| `login.html` | Tela de login (Entrar com Google) |
| `auth-guard.js` | Gate rápido de sessão (1º script de cada página) |
| `auth.js` | Validação de permissões, bloqueio de telas, `window.MapaAuth` |
| `index.html`, `avaliacao.html` | Integrados como exemplo (demais páginas: repetir as 3 linhas do `<head>`) |
