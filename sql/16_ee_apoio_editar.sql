-- ============================================================================
-- Permitir EDITAR a quantidade de professores de apoio (prof_manha/prof_tarde)
-- e de apoios ASSEJ (apoios) por unidade, na aba "Apoio Pedagógico".
-- ----------------------------------------------------------------------------
-- Liga RLS na tabela ee_apoio: leitura para autenticados, edição (UPDATE) só
-- para super admin OU gestor vinculado à escola (mesma regra dos vínculos,
-- public.pode_editar_apoio de sql/15). A RPC ee_apoio() é SECURITY DEFINER e
-- continua lendo tudo (não é afetada pela RLS). Cole no SQL Editor e rode.
-- Requer o sql/15 (cria pode_editar_apoio). Idempotente.
-- ============================================================================

alter table public.ee_apoio enable row level security;

drop policy if exists ee_apoio_sel on public.ee_apoio;
drop policy if exists ee_apoio_upd on public.ee_apoio;

create policy ee_apoio_sel on public.ee_apoio for select to authenticated using (true);
create policy ee_apoio_upd on public.ee_apoio for update to authenticated
  using (public.pode_editar_apoio(escola)) with check (public.pode_editar_apoio(escola));

grant select, update on public.ee_apoio to authenticated;

-- ============================================================================
-- PRONTO. A aba Apoio Pedagógico passa a editar prof_manha/prof_tarde/apoios
-- direto (gestor só na própria unidade; super admin em todas). Mudar a contagem
-- de professores ajusta os "slots" disponíveis para vincular às turmas.
-- ============================================================================
