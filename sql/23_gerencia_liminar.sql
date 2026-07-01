-- ============================================================================
-- GERÊNCIA DE LIMINARES (equipe da Educação Especial)
-- - Torna ee_liminar_aluno editável (incluir/editar/remover com MOTIVO).
-- - Reescreve ee_liminar() para calcular os agregados (turmas/status por unidade)
--   A PARTIR dos alunos ativos + ee_apoio -> edições refletem na hora.
-- - Cria a tela restrita 'gerencia_liminar' e libera só p/ a equipe + super admin.
-- Pré-requisito: sql/05 (tabelas), sql/12 (norm_escola), sql/20. Idempotente.
-- ============================================================================

-- 1) Colunas de gestão + garante escrita autenticada.
alter table public.ee_liminar_aluno add column if not exists ativo boolean not null default true;
alter table public.ee_liminar_aluno add column if not exists motivo_remocao text;
alter table public.ee_liminar_aluno add column if not exists removido_em timestamptz;
alter table public.ee_liminar_aluno add column if not exists atualizado_em timestamptz not null default now();
alter table public.ee_liminar_aluno disable row level security;
grant select, insert, update, delete on public.ee_liminar_aluno to anon, authenticated;
grant usage, select on sequence public.ee_liminar_aluno_id_seq to anon, authenticated;

-- 2) ee_liminar(): agrega a partir dos alunos ATIVOS + apoio.
create or replace function public.ee_liminar()
returns json language sql stable security definer set search_path = public as $$
  with al as (
    select aluno, ra, escola, turma, coalesce(periodo,'') periodo, deficiencia
    from public.ee_liminar_aluno where coalesce(ativo, true)
  ),
  turmas as (
    select escola, turma, periodo, count(*) alunos from al group by escola, turma, periodo
  ),
  uni as (
    select escola,
      count(distinct turma) total_turmas,
      count(distinct turma) filter (where upper(periodo) like 'MANH%' or upper(periodo) like 'INTEG%') turmas_manha,
      count(distinct turma) filter (where upper(periodo) like 'TARD%' or upper(periodo) like 'INTEG%') turmas_tarde
    from al group by escola
  ),
  unis as (
    select u.*, coalesce(a.prof_manha,0) prof_manha, coalesce(a.prof_tarde,0) prof_tarde,
           (a.escola is not null) tem_apoio
    from uni u
    left join lateral (
      select prof_manha, prof_tarde, escola from public.ee_apoio a
      where public.norm_escola(a.escola) = public.norm_escola(u.escola) limit 1
    ) a on true
  ),
  unis2 as (
    select *,
      case when not tem_apoio then 'Fora da rede municipal'
           when prof_manha >= turmas_manha and prof_tarde >= turmas_tarde then 'Atendida'
           else 'Pendência' end status
    from unis
  )
  select json_build_object(
    'geral', json_build_object(
       'alunos',   (select count(*) from al),
       'turmas',   (select coalesce(sum(total_turmas),0) from unis2),
       'unidades', (select count(*) from unis2),
       'atendidas',(select count(*) from unis2 where status='Atendida'),
       'pendentes',(select count(*) from unis2 where status='Pendência'),
       'fora',     (select count(*) from unis2 where status='Fora da rede municipal')),
    'unidades', coalesce((select json_agg(json_build_array(
        escola, '', total_turmas, turmas_manha, turmas_tarde, prof_manha, prof_tarde, status)
        order by status, escola) from unis2), '[]'::json),
    'turmas', coalesce((select json_agg(json_build_array(
        t.escola, t.turma, t.periodo, t.alunos, u.status) order by t.escola, t.turma)
        from turmas t left join unis2 u on u.escola = t.escola), '[]'::json),
    'alunos', coalesce((select json_agg(json_build_array(
        aluno, ra, escola, turma, periodo, deficiencia) order by escola, turma, aluno)
        from al), '[]'::json)
  );
$$;
grant execute on function public.ee_liminar() to anon, authenticated;

-- 3) Tela restrita 'gerencia_liminar' no catálogo.
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, 'gerencia_liminar', 'Gerência de Liminares', 9
from public.sistemas s where s.slug = 'mapa'
on conflict (sistema_id, slug) do update set nome = excluded.nome, ordem = excluded.ordem;

-- 4) permissoes_json(): escola recebe todas as telas EXCETO relatorios/boletim
--    E TAMBÉM 'gerencia_liminar' (restrita à equipe). Redefine a função.
create or replace function public.permissoes_json(p_email text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_perfil public.perfis%rowtype;
  v_tem_escola boolean;
  v_result json;
begin
  select * into v_perfil from public.perfis
   where lower(email) = lower(p_email) and ativo = true limit 1;
  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;
  v_tem_escola := exists (select 1 from public.perfil_escola pe where pe.perfil_id = v_perfil.id);

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
              'papel', (case when v_perfil.is_super_admin then 'admin'
                             when v_tem_escola then 'escola'
                             else coalesce(pp_papel.slug,'perfil') end),
              'telas', coalesce((
                 select json_object_agg(tl.slug, json_build_object(
                          'nome', tl.nome, 'ver', tl.ver, 'editar', tl.editar, 'exportar', tl.exportar))
                 from (
                   select t.slug, max(t.nome) as nome,
                          bool_or(src.ver) as ver, bool_or(src.editar) as editar, bool_or(src.exportar) as exportar
                   from public.telas t
                   join lateral (
                     select true as ver, true as editar, true as exportar where v_perfil.is_super_admin
                     union all
                     select true, false, false
                       where v_tem_escola and t.slug not in ('relatorios','boletim','gerencia_liminar')
                     union all
                     select pt.pode_ver, pt.pode_editar, pt.pode_exportar
                     from public.perfil_tela pt
                     where pt.tela_id = t.id and pt.perfil_id = v_perfil.id and not v_tem_escola
                     union all
                     select perm.pode_ver, perm.pode_editar, perm.pode_exportar
                     from public.papel_permissoes perm
                     where perm.tela_id = t.id and perm.papel_id = pp_papel.id and not v_tem_escola
                   ) src on true
                   where t.sistema_id = s.id
                   group by t.slug
                   having bool_or(src.ver)
                 ) tl
                ), '{}'::json)
            ) as s_obj
          from public.sistemas s
          left join lateral (
             select pa.id, pa.slug from public.perfil_papeis pp
             join public.papeis pa on pa.id = pp.papel_id and pa.sistema_id = s.id
             where pp.perfil_id = v_perfil.id limit 1
          ) pp_papel on true
          where s.ativo = true
            and (v_perfil.is_super_admin or v_tem_escola or pp_papel.id is not null
              or exists (select 1 from public.perfil_tela pt join public.telas t on t.id = pt.tela_id
                         where pt.perfil_id = v_perfil.id and t.sistema_id = s.id and pt.pode_ver))
        ) sis
      ), '[]'::json)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function public.permissoes_json(text) to authenticated, anon;

-- 5) Perfil da equipe de Educação Especial (SEM escola -> vê a rede toda) +
--    libera as telas 'educacao_especial' e 'gerencia_liminar'.
insert into public.perfis (email, nome, tipo, ativo)
values ('g.educespecial@educacao.pmrp.sp.gov.br', 'Equipe Educação Especial', 'secretaria', true)
on conflict (email) do update set ativo = true;

insert into public.perfil_tela (perfil_id, tela_id, pode_ver, pode_editar, pode_exportar)
select p.id, t.id, true, true, true
from public.perfis p
join public.sistemas s on s.slug = 'mapa'
join public.telas t on t.sistema_id = s.id and t.slug in ('educacao_especial','gerencia_liminar')
where p.email = 'g.educespecial@educacao.pmrp.sp.gov.br'
on conflict (perfil_id, tela_id) do update set pode_ver = true, pode_editar = true;

-- Conferência:
-- select public.ee_liminar()->'geral';
