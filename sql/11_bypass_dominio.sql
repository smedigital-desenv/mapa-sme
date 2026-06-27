-- ============================================================================
-- LIBERAR e-mail fora do domínio SEM precisar ser super admin.
-- Pré-requisito: sql/07, sql/08, sql/10. Idempotente.
--
-- Cria a flag perfis.bypass_dominio: quando true, aquele e-mail entra mesmo
-- não sendo @educacao.pmrp.sp.gov.br (ex.: um @gmail.com vinculado a uma escola,
-- como usuário normal). A tela de Configurações tem um checkbox para isso.
-- ============================================================================

-- 1) Coluna nova
alter table public.perfis
  add column if not exists bypass_dominio boolean not null default false;

-- 2) minhas_permissoes(): a regra de domínio passa a aceitar bypass_dominio
create or replace function public.minhas_permissoes()
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_perfil public.perfis%rowtype;
begin
  select * into v_perfil from public.perfis
   where lower(email) = public.jwt_email() and ativo = true limit 1;

  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;

  -- RESTRIÇÃO DE DOMÍNIO: só @educacao.pmrp.sp.gov.br.
  -- Exceções: super admin OU perfil com bypass_dominio = true.
  if not v_perfil.is_super_admin
     and not v_perfil.bypass_dominio
     and lower(v_perfil.email) not like '%@educacao.pmrp.sp.gov.br' then
    return json_build_object('autorizado', false, 'motivo', 'dominio');
  end if;

  -- grava o auth_user_id no 1º acesso
  if v_perfil.auth_user_id is null then
    update public.perfis
       set auth_user_id = (nullif(current_setting('request.jwt.claims', true),'')::json ->> 'sub')::uuid
     where id = v_perfil.id;
  end if;

  return public.permissoes_json(v_perfil.email);
end;
$$;

grant execute on function public.minhas_permissoes() to authenticated, anon;

-- 3) Libera o e-mail pedido (mantém como usuário normal, NÃO mexe em super admin)
update public.perfis
   set bypass_dominio = true, ativo = true
 where lower(email) = 'matheusprospero@gmail.com';
