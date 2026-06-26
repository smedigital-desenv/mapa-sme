-- ============================================================================
-- CONTROLE DE ACESSO — Permissão de tela POR PERFIL  (complemento do sql/07)
-- ============================================================================
-- O sql/07 já criou o modelo (perfis/escolas/sistemas/telas/papeis) e a RPC
-- minhas_permissoes(). Este arquivo adiciona o que a tela de Configurações
-- central precisa:
--
--   • perfil_tela  -> liberar telas DIRETAMENTE por perfil (sem depender de papel),
--                     que é como a secretaria quer administrar (1 checkbox por tela).
--   • minhas_permissoes() reescrita para UNIR três fontes de acesso a tela:
--        1) super admin  -> vê tudo;
--        2) perfil_tela   -> liberações por perfil (o jeito novo);
--        3) papel/papel_permissoes -> compatibilidade com o que já existia.
--
-- Como aplicar: rode o sql/07 ANTES (se ainda não rodou) e depois cole este
-- arquivo inteiro no SQL Editor do Supabase e Run. Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) TABELA: liberação de tela por perfil
-- ---------------------------------------------------------------------------
create table if not exists public.perfil_tela (
  perfil_id     bigint not null references public.perfis(id) on delete cascade,
  tela_id       bigint not null references public.telas(id)  on delete cascade,
  pode_ver      boolean not null default true,
  pode_editar   boolean not null default false,
  pode_exportar boolean not null default false,
  primary key (perfil_id, tela_id)
);

-- ---------------------------------------------------------------------------
-- 2) RPC minhas_permissoes() — agora considera perfil_tela
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
              'papel', (case when v_perfil.is_super_admin then 'admin' else coalesce(pp_papel.slug,'perfil') end),
              -- telas que o usuário pode VER neste sistema (união das 3 fontes)
              'telas', coalesce((
                 select json_object_agg(tl.slug, json_build_object(
                          'nome', tl.nome,
                          'ver', tl.ver, 'editar', tl.editar, 'exportar', tl.exportar))
                 from (
                   select t.slug, max(t.nome) as nome,
                          bool_or(src.ver) as ver,
                          bool_or(src.editar) as editar,
                          bool_or(src.exportar) as exportar
                   from public.telas t
                   join lateral (
                     -- super admin: tudo
                     select true as ver, true as editar, true as exportar
                     where v_perfil.is_super_admin
                     union all
                     -- liberação direta por perfil
                     select pt.pode_ver, pt.pode_editar, pt.pode_exportar
                     from public.perfil_tela pt
                     where pt.tela_id = t.id and pt.perfil_id = v_perfil.id
                     union all
                     -- compatibilidade: via papel
                     select perm.pode_ver, perm.pode_editar, perm.pode_exportar
                     from public.papel_permissoes perm
                     where perm.tela_id = t.id and perm.papel_id = pp_papel.id
                   ) src on true
                   where t.sistema_id = s.id
                   group by t.slug
                   having bool_or(src.ver)
                 ) tl
                ), '{}'::json)
            ) as s_obj
          from public.sistemas s
          -- papel do usuário neste sistema (se houver). super admin entra em todos.
          left join lateral (
             select pa.id, pa.slug
             from public.perfil_papeis pp
             join public.papeis pa on pa.id = pp.papel_id and pa.sistema_id = s.id
             where pp.perfil_id = v_perfil.id
             limit 1
          ) pp_papel on true
          where s.ativo = true
            and (
              v_perfil.is_super_admin
              or pp_papel.id is not null
              or exists (
                 select 1 from public.perfil_tela pt
                 join public.telas t on t.id = pt.tela_id
                 where pt.perfil_id = v_perfil.id and t.sistema_id = s.id and pt.pode_ver
              )
            )
        ) sis
      ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.minhas_permissoes() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3) RLS na perfil_tela: cada um lê o próprio; super admin gerencia tudo.
-- ---------------------------------------------------------------------------
alter table public.perfil_tela enable row level security;

drop policy if exists perfil_tela_self  on public.perfil_tela;
drop policy if exists perfil_tela_admin on public.perfil_tela;
create policy perfil_tela_self  on public.perfil_tela for select to authenticated
  using (perfil_id = public.current_perfil_id() or public.is_super_admin());
create policy perfil_tela_admin on public.perfil_tela for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4) A tela de Configurações precisa ESCREVER em perfis/escolas. O super admin
--    já tem policy "for all" no sql/07. Garantimos também INSERT em escolas
--    (já coberto pela policy *_adm). Nada a fazer aqui além do que o 07 fez.
-- ---------------------------------------------------------------------------

-- ============================================================================
-- PRONTO. A tela "Configurações" (index.html, visível só para super admin)
-- usa estas tabelas via supabase-js autenticado:
--   perfis            (cadastro de e-mails autorizados)
--   perfil_tela       (quais telas cada perfil acessa)
--   perfil_escola     (vínculo do perfil com a unidade)
--   escolas / telas   (catálogos para os seletores)
-- ============================================================================
