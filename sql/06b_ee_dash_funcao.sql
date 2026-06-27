-- ============================================================
-- ee_dash() — APENAS A FUNÇÃO (cole no SQL Editor do Supabase e rode).
-- Não toca na tabela ee_dash nem nos dados; só substitui a lógica.
-- Correção: % Estudo de Caso / % PEI agora = COBERTURA (alunos com a ficha
-- ÷ alunos AEE), lida da tabela-fonte educacao_especial — igual à aba AEE.
-- ============================================================
CREATE OR REPLACE FUNCTION ee_dash() RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $FN$
  WITH cov AS (
    SELECT unidade,
           count(*)                            AS alunos,
           count(*) FILTER (WHERE ec_quest>0)  AS ec_cov,
           count(*) FILTER (WHERE pei_quest>0) AS pei_cov
    FROM educacao_especial GROUP BY unidade
  )
  SELECT json_build_object(
    'geral',(SELECT json_build_object('unidades',count(*),'turmas_nee',coalesce(sum(d.turmas_nee),0),'alunos_nee',coalesce(sum(d.alunos_nee),0),
       'ec_pct',CASE WHEN sum(c.alunos)>0 THEN round(sum(c.ec_cov)::numeric/sum(c.alunos)*100,1) ELSE 0 END,
       'pei_pct',CASE WHEN sum(c.alunos)>0 THEN round(sum(c.pei_cov)::numeric/sum(c.alunos)*100,1) ELSE 0 END,
       'liminar_turmas',coalesce(sum(d.liminar_turmas),0),'unid_lim_pend',(SELECT count(*) FROM ee_dash WHERE liminar_status='Pendência'))
       FROM ee_dash d LEFT JOIN cov c ON c.unidade=d.unidade),
    'unidades',coalesce((SELECT json_agg(json_build_array(d.unidade,d.turmas_nee,d.alunos_nee,
       CASE WHEN c.ec_cov>0  THEN round(c.ec_cov::numeric /c.alunos*100) ELSE null END,
       CASE WHEN c.pei_cov>0 THEN round(c.pei_cov::numeric/c.alunos*100) ELSE null END,
       d.liminar_turmas,d.liminar_manha,d.liminar_tarde,d.prof_manha,d.prof_tarde,d.liminar_status,d.liminar_escola) ORDER BY d.unidade)
       FROM ee_dash d LEFT JOIN cov c ON c.unidade=d.unidade),'[]'::json));
$FN$;
GRANT EXECUTE ON FUNCTION ee_dash() TO anon, authenticated;
