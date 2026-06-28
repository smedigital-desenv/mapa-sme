-- ============================================================================
-- VÍNCULO Professor de Apoio (slot M/T)  ×  Turma da escola
-- ----------------------------------------------------------------------------
-- Hoje só temos a QUANTIDADE de professores de apoio por escola/turno (ee_apoio.
-- prof_manha / prof_tarde). Esta tabela permite VINCULAR cada "slot" numerado
-- (Apoio M 1, M 2…, T 1, T 2…) a uma ou mais turmas da escola. Relação N:N
-- (um slot cobre várias salas; uma sala pode ter vários slots). Os apoios ASSEJ
-- (ee_apoio.apoios) NÃO entram aqui.
--
-- Gravação restrita: super admin OU gestor vinculado à escola (perfil_escola).
-- Leitura: qualquer usuário autenticado (a tela filtra por escola).
-- Cole no SQL Editor do Supabase e rode (depois do 07/08 e do 12). Idempotente.
-- ============================================================================

create table if not exists public.ee_apoio_vinculo (
  id           bigint generated always as identity primary key,
  escola       text    not null,                       -- nome da escola (como na aba Apoio)
  periodo      text    not null check (periodo in ('Manhã','Tarde')),
  slot         int     not null check (slot >= 1),      -- número do professor de apoio no turno
  ano_escolar  text,
  letra_turma  text,
  turma_label  text    not null,                        -- rótulo exibível (ex.: "3 ANO A")
  obs          text,
  perfil_id    bigint  references public.perfis(id),    -- quem criou (auditoria)
  created_at   timestamptz not null default now(),
  unique (escola, periodo, slot, turma_label)
);
create index if not exists ix_apoio_vinc_escola on public.ee_apoio_vinculo (escola);

-- Pode editar os vínculos desta escola? super admin OU gestor vinculado (perfil_escola),
-- casando o nome de forma tolerante (igual ao front: nome completo OU base antes da vírgula).
create or replace function public.pode_editar_apoio(p_escola text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1
    from public.perfil_escola pe
    join public.escolas e on e.id = pe.escola_id
    where pe.perfil_id = public.current_perfil_id()
      and (
        public.norm_escola(e.nome) = public.norm_escola(p_escola)
        or public.norm_escola(split_part(e.nome,',',1)) = public.norm_escola(split_part(p_escola,',',1))
      )
  )
$$;

-- Turmas distintas de uma escola (para o seletor do modal). periodo: M/T/N.
create or replace function public.escola_turmas(p_escola text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_array(ano_escolar, letra_turma, periodo)
           order by ano_escolar, letra_turma, periodo), '[]'::json)
  from (
    select distinct ano_escolar, letra_turma, periodo
    from public.turmas
    where public.norm_escola(nome_unidade) = public.norm_escola(p_escola)
       or public.norm_escola(split_part(nome_unidade,',',1)) = public.norm_escola(split_part(p_escola,',',1))
  ) t;
$$;

-- RLS
alter table public.ee_apoio_vinculo enable row level security;
drop policy if exists ee_apoio_vinculo_sel on public.ee_apoio_vinculo;
drop policy if exists ee_apoio_vinculo_ins on public.ee_apoio_vinculo;
drop policy if exists ee_apoio_vinculo_upd on public.ee_apoio_vinculo;
drop policy if exists ee_apoio_vinculo_del on public.ee_apoio_vinculo;
create policy ee_apoio_vinculo_sel on public.ee_apoio_vinculo for select to authenticated using (true);
create policy ee_apoio_vinculo_ins on public.ee_apoio_vinculo for insert to authenticated with check (public.pode_editar_apoio(escola));
create policy ee_apoio_vinculo_upd on public.ee_apoio_vinculo for update to authenticated using (public.pode_editar_apoio(escola)) with check (public.pode_editar_apoio(escola));
create policy ee_apoio_vinculo_del on public.ee_apoio_vinculo for delete to authenticated using (public.pode_editar_apoio(escola));

grant select, insert, update, delete on public.ee_apoio_vinculo to authenticated;
grant execute on function public.pode_editar_apoio(text) to authenticated, anon;
grant execute on function public.escola_turmas(text)      to authenticated, anon;

-- ============================================================================
-- PRONTO. A tela Educação Especial (aba Apoio) lê/escreve em ee_apoio_vinculo
-- via supabase-js autenticado; a RLS garante que cada gestor só altere a própria
-- escola. escola_turmas() alimenta o seletor de salas do modal.
-- ============================================================================
