-- ============================================================================
-- CONTROLE DE ACESSO CENTRAL — SME Ribeirão Preto
-- ============================================================================
-- Identidade via Supabase Auth (Google). Autorização modelada aqui.
--
-- Conceito:
--   - A SECRETARIA pré-cadastra os e-mails autorizados (perfis), vincula-os
--     às escolas e atribui papéis por sistema.
--   - Ao fazer login com Google, o e-mail do usuário é comparado (via JWT)
--     com a tabela `perfis`. Quem não estiver lá entra no Auth mas NÃO recebe
--     nenhuma permissão (RLS nega tudo) -> tela "sem acesso, contate a SME".
--   - O front (auth.js) só MOSTRA o que o usuário pode ver. A segurança real
--     é a RLS nas tabelas de dados (fase 2 — ver NOTA no final).
--
-- Como aplicar: cole este arquivo inteiro no SQL Editor do Supabase e rode.
-- Idempotente o suficiente para rodar de novo em homologação.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) TABELAS
-- ---------------------------------------------------------------------------

-- Escolas da rede
create table if not exists public.escolas (
  id            bigint generated always as identity primary key,
  codigo_inep   text unique,
  nome          text not null,
  email_institucional text,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Perfis = allowlist de usuários. Chave natural = e-mail (Google).
-- A secretaria cadastra o e-mail ANTES de a pessoa logar.
create table if not exists public.perfis (
  id            bigint generated always as identity primary key,
  email         text not null unique,            -- e-mail Google autorizado (lowercase)
  nome          text,
  tipo          text not null default 'escola',  -- 'secretaria' | 'escola' | 'externo'
  auth_user_id  uuid,                            -- preenchido no 1º login (referência a auth.users)
  is_super_admin boolean not null default false, -- acesso total (administra tudo)
  ativo         boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_perfis_email on public.perfis (lower(email));

-- Vínculo N:N usuário <-> escola (os "e-mails vinculados às escolas")
create table if not exists public.perfil_escola (
  perfil_id  bigint not null references public.perfis(id) on delete cascade,
  escola_id  bigint not null references public.escolas(id) on delete cascade,
  vinculo    text,                               -- 'gestor','coordenador','professor'...
  primary key (perfil_id, escola_id)
);

-- Sistemas (mapa, gom, sate, revista...). url = caminho relativo no domínio.
create table if not exists public.sistemas (
  id      bigint generated always as identity primary key,
  slug    text not null unique,                  -- 'mapa','gom','sate'...
  nome    text not null,
  url     text,                                  -- '/mapa-sme/' etc
  icone   text,                                  -- classe bootstrap-icons, ex 'bi-map-fill'
  cor     text,                                  -- cor do card no portal
  ordem   int not null default 0,
  ativo   boolean not null default true
);

-- Telas dentro de cada sistema (avaliacao, atribuicao, educacao_especial...)
create table if not exists public.telas (
  id         bigint generated always as identity primary key,
  sistema_id bigint not null references public.sistemas(id) on delete cascade,
  slug       text not null,                      -- 'avaliacao','atribuicao'...
  nome       text not null,
  ordem      int not null default 0,
  unique (sistema_id, slug)
);

-- Papéis por sistema (admin, editor, leitor)
create table if not exists public.papeis (
  id         bigint generated always as identity primary key,
  sistema_id bigint not null references public.sistemas(id) on delete cascade,
  slug       text not null,                      -- 'admin','editor','leitor'
  nome       text not null,
  unique (sistema_id, slug)
);

-- O que cada papel pode fazer em cada tela (ações)
create table if not exists public.papel_permissoes (
  papel_id   bigint not null references public.papeis(id) on delete cascade,
  tela_id    bigint not null references public.telas(id) on delete cascade,
  pode_ver      boolean not null default true,
  pode_editar   boolean not null default false,
  pode_exportar boolean not null default false,
  primary key (papel_id, tela_id)
);

-- Atribuição: que papel um perfil tem em cada sistema
-- escola_id opcional: NULL = vale para todas as escolas vinculadas ao perfil.
create table if not exists public.perfil_papeis (
  id         bigint generated always as identity primary key,
  perfil_id  bigint not null references public.perfis(id) on delete cascade,
  papel_id   bigint not null references public.papeis(id) on delete cascade,
  escola_id  bigint references public.escolas(id) on delete cascade,
  unique (perfil_id, papel_id, escola_id)
);

-- ---------------------------------------------------------------------------
-- 2) FUNÇÕES AUXILIARES (rodam como SECURITY DEFINER p/ ler perfis sob RLS)
-- ---------------------------------------------------------------------------

-- E-mail do usuário autenticado, a partir do JWT do Supabase Auth.
create or replace function public.jwt_email()
returns text language sql stable as $$
  select lower(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email')
$$;

-- id do perfil ativo correspondente ao e-mail logado (ou NULL).
create or replace function public.current_perfil_id()
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.perfis
  where lower(email) = public.jwt_email() and ativo = true
  limit 1
$$;

-- É super admin?
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_super_admin from public.perfis
       where lower(email) = public.jwt_email() and ativo = true limit 1),
    false)
$$;

-- ---------------------------------------------------------------------------
-- 3) RPC: minhas_permissoes() — o "mapa de acesso" do usuário logado.
--     Usado pelo portal e pelo auth.js para liberar/esconder telas.
-- ---------------------------------------------------------------------------
create or replace function public.minhas_permissoes()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_perfil  public.perfis%rowtype;
  v_result  json;
begin
  select * into v_perfil from public.perfis
   where lower(email) = public.jwt_email() and ativo = true
   limit 1;

  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;

  -- registra o auth_user_id no 1º acesso (liga perfil <-> auth.users)
  if v_perfil.auth_user_id is null then
    update public.perfis
       set auth_user_id = (nullif(current_setting('request.jwt.claims', true),'')::json ->> 'sub')::uuid
     where id = v_perfil.id;
  end if;

  select json_build_object(
    'autorizado', true,
    'perfil', json_build_object(
        'id', v_perfil.id, 'nome', v_perfil.nome, 'email', v_perfil.email,
        'tipo', v_perfil.tipo, 'is_super_admin', v_perfil.is_super_admin),
    'escolas', coalesce((
        select json_agg(json_build_object('id', e.id, 'nome', e.nome, 'vinculo', pe.vinculo) order by e.nome)
        from public.perfil_escola pe join public.escolas e on e.id = pe.escola_id
        where pe.perfil_id = v_perfil.id and e.ativo = true), '[]'::json),
    'sistemas', coalesce((
        select json_agg(s_obj order by ordem) from (
          select s.ordem,
            json_build_object(
              'slug', s.slug, 'nome', s.nome, 'url', s.url, 'icone', s.icone, 'cor', s.cor,
              'papel', (case when v_perfil.is_super_admin then 'admin' else pp_papel.slug end),
              'telas', coalesce((
                 select json_object_agg(t.slug, json_build_object(
                          'nome', t.nome,
                          'ver',      (v_perfil.is_super_admin or coalesce(perm.pode_ver, false)),
                          'editar',   (v_perfil.is_super_admin or coalesce(perm.pode_editar, false)),
                          'exportar', (v_perfil.is_super_admin or coalesce(perm.pode_exportar, false))))
                 from public.telas t
                 left join public.papel_permissoes perm
                        on perm.tela_id = t.id and perm.papel_id = pp_papel.id
                 where t.sistema_id = s.id
                   and (v_perfil.is_super_admin or coalesce(perm.pode_ver,false))
                ), '{}'::json)
            ) as s_obj
          from public.sistemas s
          -- papel do usuário neste sistema (qualquer escola). super admin entra em todos.
          left join lateral (
             select pa.id, pa.slug
             from public.perfil_papeis pp
             join public.papeis pa on pa.id = pp.papel_id and pa.sistema_id = s.id
             where pp.perfil_id = v_perfil.id
             limit 1
          ) pp_papel on true
          where s.ativo = true
            and (v_perfil.is_super_admin or pp_papel.id is not null)
        ) sis
      ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.minhas_permissoes() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4) RLS — habilita em todas as tabelas de acesso
-- ---------------------------------------------------------------------------
alter table public.escolas          enable row level security;
alter table public.perfis           enable row level security;
alter table public.perfil_escola    enable row level security;
alter table public.sistemas         enable row level security;
alter table public.telas            enable row level security;
alter table public.papeis           enable row level security;
alter table public.papel_permissoes enable row level security;
alter table public.perfil_papeis    enable row level security;

-- Catálogo (escolas, sistemas, telas, papéis, permissões): leitura p/ autenticados;
-- escrita só super admin.
do $$
declare t text;
begin
  foreach t in array array['escolas','sistemas','telas','papeis','papel_permissoes']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_adm', t);
    execute format($f$create policy %I on public.%I for select to authenticated using (true)$f$, t||'_sel', t);
    execute format($f$create policy %I on public.%I for all to authenticated
                       using (public.is_super_admin()) with check (public.is_super_admin())$f$, t||'_adm', t);
  end loop;
end $$;

-- Perfis: cada um lê o próprio; super admin lê/escreve todos.
drop policy if exists perfis_self on public.perfis;
drop policy if exists perfis_admin on public.perfis;
create policy perfis_self  on public.perfis for select to authenticated
  using (lower(email) = public.jwt_email() or public.is_super_admin());
create policy perfis_admin on public.perfis for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Vínculos e atribuições: usuário lê os próprios; super admin gerencia tudo.
drop policy if exists perfil_escola_self on public.perfil_escola;
drop policy if exists perfil_escola_admin on public.perfil_escola;
create policy perfil_escola_self  on public.perfil_escola for select to authenticated
  using (perfil_id = public.current_perfil_id() or public.is_super_admin());
create policy perfil_escola_admin on public.perfil_escola for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists perfil_papeis_self on public.perfil_papeis;
drop policy if exists perfil_papeis_admin on public.perfil_papeis;
create policy perfil_papeis_self  on public.perfil_papeis for select to authenticated
  using (perfil_id = public.current_perfil_id() or public.is_super_admin());
create policy perfil_papeis_admin on public.perfil_papeis for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 5) SEED — sistema MAPA + suas telas + papéis + super admin
-- ---------------------------------------------------------------------------

-- Super admin inicial (você). Troque/adicione e-mails da secretaria conforme necessário.
insert into public.perfis (email, nome, tipo, is_super_admin)
values ('desenv.sme@gmail.com', 'Desenvolvimento SME', 'secretaria', true)
on conflict (email) do update set is_super_admin = true, tipo = 'secretaria', ativo = true;

-- Sistema MAPA
insert into public.sistemas (slug, nome, url, icone, cor, ordem)
values ('mapa', 'MAPA', '/mapa-sme/', 'bi-map-fill', '#002b5e', 1)
on conflict (slug) do update set nome=excluded.nome, url=excluded.url, icone=excluded.icone, cor=excluded.cor;

-- Telas do MAPA
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, x.slug, x.nome, x.ordem
from public.sistemas s,
  (values
    ('avaliacao','Avaliações',1),
    ('atribuicao','Atribuição',2),
    ('elefante','Elefante Letrado',3),
    ('fluencia','Fluência Leitora',4),
    ('educacao_especial','Educação Especial',5),
    ('relatorios','Relatórios',6)
  ) as x(slug,nome,ordem)
where s.slug = 'mapa'
on conflict (sistema_id, slug) do update set nome=excluded.nome, ordem=excluded.ordem;

-- Papéis do MAPA: admin (tudo), leitor (só ver)
insert into public.papeis (sistema_id, slug, nome)
select s.id, x.slug, x.nome
from public.sistemas s,
  (values ('admin','Administrador'),('leitor','Leitor')) as x(slug,nome)
where s.slug = 'mapa'
on conflict (sistema_id, slug) do update set nome=excluded.nome;

-- Permissões: admin pode tudo; leitor só vê.
insert into public.papel_permissoes (papel_id, tela_id, pode_ver, pode_editar, pode_exportar)
select pa.id, t.id,
       true,
       (pa.slug = 'admin'),
       (pa.slug = 'admin')
from public.papeis pa
join public.sistemas s on s.id = pa.sistema_id and s.slug = 'mapa'
join public.telas t on t.sistema_id = s.id
on conflict (papel_id, tela_id) do update
  set pode_ver=excluded.pode_ver, pode_editar=excluded.pode_editar, pode_exportar=excluded.pode_exportar;

-- ============================================================================
-- NOTA (FASE 2 — trancar os DADOS por escola):
--   As tabelas de dados (turmas, avaliações, fluencia_estudantes, etc.) hoje
--   são lidas com a anon key SEM RLS. Para impedir vazamento por escola:
--     1) habilitar RLS nessas tabelas;
--     2) criar policy ligando o registro à(s) escola(s) do usuário via
--        public.current_perfil_id() + public.perfil_escola (super admin = tudo);
--     3) fazer as páginas enviarem o token do usuário no header
--        Authorization (auth.js expõe MapaAuth.authFetch para isso).
--   Exemplo de policy para uma tabela `turmas` com coluna `escola_id`:
--
--   alter table public.turmas enable row level security;
--   create policy turmas_por_escola on public.turmas for select to authenticated
--     using (public.is_super_admin() or escola_id in (
--        select escola_id from public.perfil_escola
--        where perfil_id = public.current_perfil_id()));
-- ============================================================================
