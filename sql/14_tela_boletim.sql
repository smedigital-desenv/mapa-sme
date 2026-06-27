-- ============================================================================
-- NOVA TELA: "Boletim da Escola" (boletim.html) — painel consolidado do gestor.
-- Registra a tela no catálogo do sistema MAPA e libera aos papéis existentes,
-- para que gestores (perfil 'escola') consigam abri-la (o front bloqueia telas
-- cujo slug não está liberado). Super admin já vê tudo. Idempotente.
-- Cole no SQL Editor do Supabase e rode (depois do sql/07 e sql/08).
-- ============================================================================

-- 1) Catálogo: tela 'boletim' no sistema MAPA
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, 'boletim', 'Boletim da Escola', 7
from public.sistemas s
where s.slug = 'mapa'
on conflict (sistema_id, slug) do update set nome = excluded.nome, ordem = excluded.ordem;

-- 2) Permissão por papel: admin e leitor podem VER (somente leitura).
insert into public.papel_permissoes (papel_id, tela_id, pode_ver, pode_editar, pode_exportar)
select pa.id, t.id, true, false, false
from public.papeis pa
join public.sistemas s on s.id = pa.sistema_id and s.slug = 'mapa'
join public.telas t on t.sistema_id = s.id and t.slug = 'boletim'
on conflict (papel_id, tela_id) do update
  set pode_ver = excluded.pode_ver, pode_editar = excluded.pode_editar, pode_exportar = excluded.pode_exportar;

-- 3) (Opcional) Liberar 'boletim' diretamente para TODOS os perfis que já têm
--    pelo menos uma tela do MAPA liberada por perfil (perfil_tela) — assim quem
--    já era gestor de unidade ganha o boletim sem reconfiguração manual.
insert into public.perfil_tela (perfil_id, tela_id, pode_ver, pode_editar, pode_exportar)
select distinct pt.perfil_id, t.id, true, false, false
from public.perfil_tela pt
join public.telas t  on t.slug = 'boletim'
join public.telas t2 on t2.id = pt.tela_id
join public.sistemas s on s.id = t2.sistema_id and s.slug = 'mapa'
on conflict (perfil_id, tela_id) do nothing;

-- ============================================================================
-- PRONTO. A tela aparece no portal (index.html) conforme as permissões e fica
-- acessível em boletim.html. Para liberar/remover por perfil específico, use a
-- tela de Configurações (super admin).
-- ============================================================================
