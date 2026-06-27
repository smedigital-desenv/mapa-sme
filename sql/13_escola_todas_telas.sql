-- ============================================================================
-- Perfil de ESCOLA (não super admin, com unidade vinculada) passa a ter acesso
-- a TODAS as telas — os dados é que ficam isolados por unidade (filtro no front).
-- Reescreve permissoes_json(). Pré-requisito: sql/07,08,10. Idempotente.
-- ============================================================================
create or replace function public.permissoes_json(p_email text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_perfil public.perfis%rowtype;
  v_tem_escola boolean;
  v_result json;
begin
  select * into v_perfil from public.perfis
   where lower(email) = lower(p_email) and ativo = true
   limit 1;

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
                     -- super admin: tudo
                     select true as ver, true as editar, true as exportar where v_perfil.is_super_admin
                     union all
                     -- tem unidade vinculada: vê TODAS as telas (dados isolados no front)
                     select true, false, false where v_tem_escola
                     union all
                     -- liberação direta por perfil
                     select pt.pode_ver, pt.pode_editar, pt.pode_exportar
                     from public.perfil_tela pt where pt.tela_id = t.id and pt.perfil_id = v_perfil.id
                     union all
                     -- compatibilidade: via papel
                     select perm.pode_ver, perm.pode_editar, perm.pode_exportar
                     from public.papel_permissoes perm where perm.tela_id = t.id and perm.papel_id = pp_papel.id
                   ) src on true
                   where t.sistema_id = s.id
                   group by t.slug
                   having bool_or(src.ver)
                 ) tl
                ), '{}'::json)
            ) as s_obj
          from public.sistemas s
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
              or v_tem_escola
              or pp_papel.id is not null
              or exists (
                 select 1 from public.perfil_tela pt
                 join public.telas t on t.id = pt.tela_id
                 where pt.perfil_id = v_perfil.id and t.sistema_id = s.id and pt.pode_ver)
            )
        ) sis
      ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.permissoes_json(text) to authenticated, anon;
