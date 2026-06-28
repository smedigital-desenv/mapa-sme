-- ============================================================================
-- CORREÇÃO DE DADO: "Sebastiao DE Aguiar Azevedo Unidade II, EMEF" é uma escola
-- MUNICIPAL (EMEF) e estava marcada como "Fora da rede municipal" no ee_liminar
-- (1 unidade + 4 turmas). Troca para "Pendência" — assim o app passa a calcular
-- a situação dela pelo critério de vínculo (prof de apoio na turma), em vez de
-- preservar o status "Fora". As 13 demais "Fora da rede municipal" são escolas
-- particulares (corretas) e NÃO são alteradas. Rode no SQL Editor do Supabase.
-- ============================================================================

update public.ee_liminar_unidade
   set status = 'Pendência'
 where escola = 'Sebastiao DE Aguiar Azevedo Unidade II, EMEF'
   and status = 'Fora da rede municipal';

update public.ee_liminar_turma
   set status = 'Pendência'
 where escola = 'Sebastiao DE Aguiar Azevedo Unidade II, EMEF'
   and status = 'Fora da rede municipal';

-- Conferência:
-- select escola, status, count(*) from public.ee_liminar_turma
--  where escola ilike 'Sebastiao%Unidade II%' group by escola, status;
