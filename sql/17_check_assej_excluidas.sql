-- ============================================================================
-- DIAGNÓSTICO: ASSEJ (ee_apoio.apoios) em escolas EXCLUÍDAS do filtro da tela
-- (a tela considera só CEI / EMEI / EMEF; o resto vira "Outros" e sai dos números).
-- Classifica pelo MESMO criterio do front (_tipoUn): tipo pelo sufixo do nome.
-- Só leitura. Rode no SQL Editor do Supabase.
-- ============================================================================

with cls as (
  select
    escola, prof_manha, prof_tarde, apoios,
    case
      when trim(regexp_replace(upper(escola), '^.*,\s*', '')) ~ '^EMEF\y' then 'EMEF'
      when trim(regexp_replace(upper(escola), '^.*,\s*', '')) ~ '^EMEI\y' then 'EMEI'
      when trim(regexp_replace(upper(escola), '^.*,\s*', '')) ~ '^CEI\y'  then 'CEI'
      when (' '||upper(escola)||' ') ~ '[ ,.]EMEF[ ,.]' then 'EMEF'
      when (' '||upper(escola)||' ') ~ '[ ,.]EMEI[ ,.]' then 'EMEI'
      when (' '||upper(escola)||' ') ~ '[ ,.]CEI[ ,.]'  then 'CEI'
      else 'Outros'
    end as tipo_derivado
  from public.ee_apoio
)
-- (1) Detalhe: escolas excluídas que TÊM ASSEJ
select escola, tipo_derivado, prof_manha, prof_tarde, apoios
from cls
where tipo_derivado = 'Outros' and coalesce(apoios,0) > 0
order by apoios desc, escola;

-- (2) Resumo: total de ASSEJ perdido nas escolas excluídas
--    (rode separadamente)
-- with cls as ( ... mesmo bloco acima ... )
-- select count(*) as escolas_excluidas_com_assej, coalesce(sum(apoios),0) as total_assej
-- from cls where tipo_derivado='Outros' and coalesce(apoios,0) > 0;

-- (3) Conferência geral: quantas escolas por tipo derivado e quanto de ASSEJ em cada
-- with cls as ( ... mesmo bloco acima ... )
-- select tipo_derivado, count(*) escolas, coalesce(sum(apoios),0) total_assej,
--        coalesce(sum(prof_manha+prof_tarde),0) total_prof_apoio
-- from cls group by tipo_derivado order by tipo_derivado;
