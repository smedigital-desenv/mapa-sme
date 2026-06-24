-- ============================================================
-- PERFORMANCE MÁXIMA — AVALIAÇÕES INSTANTÂNEAS (MATERIALIZED VIEWS)
-- Rode este script no SQL Editor do Supabase (pode re-rodar à vontade).
--
-- Ideia: parar de reagrupar a tabela `bimestres` (269 mil linhas) a cada
-- acesso. As "materialized views" guardam o resultado JÁ SOMADO; as funções
-- só leem essas views (sub-segundo). A normalização/rotulagem continua no JS,
-- então os números exibidos permanecem IDÊNTICOS.
--
-- Para você NÃO PERDER DADOS: as views se atualizam sozinhas a cada 5 min
-- (pg_cron) e há uma função para forçar atualização na hora após importações.
-- ============================================================

-- ── Índices na tabela base (aceleram a construção das views e os drill-downs) ──
CREATE INDEX IF NOT EXISTS idx_bimestres_bimestre ON bimestres (bimestre);
CREATE INDEX IF NOT EXISTS idx_bimestres_unidade  ON bimestres (nome_unidade);
CREATE INDEX IF NOT EXISTS idx_bimestres_turma    ON bimestres (turma);

-- ════════════════════════════════════════════════════════════
-- MATERIALIZED VIEWS (resultado pré-agregado)
-- ════════════════════════════════════════════════════════════

-- MV 1: contagem por combinação crua (SEM `fqs` — nenhum consumidor usa e
--       isso reduz muito o nº de linhas). Alimenta linhas/Total/eixos.
DROP MATERIALIZED VIEW IF EXISTS mv_bimestres_grupos CASCADE;
CREATE MATERIALIZED VIEW mv_bimestres_grupos AS
  SELECT b.bimestre, b.nome_unidade, b.ano_escolar, b.turma,
         b.fnc_disciplina, b.descricao_fne,
         b.valor_resposta, b.codigo_resposta,
         COUNT(*)::int AS qtd
  FROM bimestres b
  GROUP BY b.bimestre, b.nome_unidade, b.ano_escolar, b.turma,
           b.fnc_disciplina, b.descricao_fne,
           b.valor_resposta, b.codigo_resposta;

-- índice único (integridade do agrupamento) + índice de filtro por bimestre
CREATE UNIQUE INDEX ux_mv_grupos ON mv_bimestres_grupos
  (bimestre, nome_unidade, ano_escolar, turma, fnc_disciplina, descricao_fne,
   valor_resposta, codigo_resposta);
CREATE INDEX ix_mv_grupos_bim ON mv_bimestres_grupos (bimestre);

-- MV 2: alunos DISTINTOS por (bimestre, unidade, ano, turma) — alimenta o `hier`.
DROP MATERIALIZED VIEW IF EXISTS mv_bimestres_hier CASCADE;
CREATE MATERIALIZED VIEW mv_bimestres_hier AS
  SELECT b.bimestre, b.nome_unidade, b.ano_escolar, b.turma,
         COUNT(DISTINCT COALESCE(b.rema_aluno, b.nome_aluno))::int AS qtd_alunos
  FROM bimestres b
  GROUP BY b.bimestre, b.nome_unidade, b.ano_escolar, b.turma;

CREATE UNIQUE INDEX ux_mv_hier ON mv_bimestres_hier
  (bimestre, nome_unidade, ano_escolar, turma);
CREATE INDEX ix_mv_hier_bim ON mv_bimestres_hier (bimestre);

-- MV 3: árvore do Total — alunos únicos por unidade/ano/turma (bimestres ∪ alunos).
DROP MATERIALIZED VIEW IF EXISTS mv_arvore_total CASCADE;
CREATE MATERIALIZED VIEW mv_arvore_total AS
  SELECT s.nome_unidade, s.ano_escolar, s.turma, COUNT(*)::int AS qtd_alunos
  FROM (
    SELECT nome_unidade, ano_escolar, turma, COALESCE(rema_aluno, nome_aluno) AS id
      FROM bimestres
    UNION
    SELECT nome_unidade, ano_escolar, turma, COALESCE(rema_aluno, nome_aluno) AS id
      FROM alunos
  ) s
  GROUP BY s.nome_unidade, s.ano_escolar, s.turma;

CREATE UNIQUE INDEX ux_mv_arvore ON mv_arvore_total
  (nome_unidade, ano_escolar, turma);

-- MV 4: Diagnóstica/Rede — pivô por aluno (1 linha por aluno, com Escrita/Leitura/
--       Produção). Reduz ~39k linhas para ~nº de alunos e leva só as colunas usadas.
--       A rotulagem (respostaLabel) continua no JS, sobre os valores crus.
DROP MATERIALIZED VIEW IF EXISTS mv_alunos_diag CASCADE;
CREATE MATERIALIZED VIEW mv_alunos_diag AS
  SELECT
    nome_unidade, ano_escolar, turma,
    COALESCE(rema_aluno, nome_aluno) AS aluno_id,
    MAX(rema_aluno) AS rema_aluno,
    MAX(nome_aluno) AS nome_aluno,
    MAX(valor_resposta)  FILTER (WHERE descricao_fne ILIKE '%ESCRITA%') AS e_valor,
    MAX(codigo_resposta) FILTER (WHERE descricao_fne ILIKE '%ESCRITA%') AS e_codigo,
    MAX(valor_resposta)  FILTER (WHERE descricao_fne ILIKE '%LEITURA%') AS l_valor,
    MAX(codigo_resposta) FILTER (WHERE descricao_fne ILIKE '%LEITURA%') AS l_codigo,
    MAX(valor_resposta)  FILTER (WHERE descricao_fne ILIKE '%PRODU%')   AS p_valor,
    MAX(codigo_resposta) FILTER (WHERE descricao_fne ILIKE '%PRODU%')   AS p_codigo
  FROM alunos
  GROUP BY nome_unidade, ano_escolar, turma, COALESCE(rema_aluno, nome_aluno);

CREATE UNIQUE INDEX ux_mv_alunos ON mv_alunos_diag
  (nome_unidade, ano_escolar, turma, aluno_id);

-- ════════════════════════════════════════════════════════════
-- FUNÇÕES (apenas LEEM as views — sub-segundo)
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS agrupar_bimestres(INT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS agrupar_bimestres(INT, TEXT, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION agrupar_bimestres(
  p_bimestre     INT     DEFAULT NULL,
  p_ano_like     TEXT    DEFAULT NULL,
  p_unidade      TEXT    DEFAULT NULL,
  p_turma        TEXT    DEFAULT NULL,
  p_incluir_hier BOOLEAN DEFAULT TRUE
) RETURNS json LANGUAGE sql STABLE AS $$
  SELECT json_build_object(
    'grupos', COALESCE((SELECT json_agg(json_build_array(
        bimestre, nome_unidade, ano_escolar, turma, fnc_disciplina, descricao_fne,
        valor_resposta, codigo_resposta, qtd
      )) FROM mv_bimestres_grupos
      WHERE (p_bimestre IS NULL OR bimestre = p_bimestre)
        AND (p_ano_like IS NULL OR ano_escolar ILIKE p_ano_like)
        AND (p_unidade  IS NULL OR nome_unidade = p_unidade)
        AND (p_turma    IS NULL OR turma = p_turma)
    ), '[]'::json),
    'hier', CASE WHEN p_incluir_hier THEN COALESCE((SELECT json_agg(h) FROM (
      SELECT bimestre, nome_unidade, ano_escolar, turma, qtd_alunos
      FROM mv_bimestres_hier
      WHERE (p_bimestre IS NULL OR bimestre = p_bimestre)
        AND (p_ano_like IS NULL OR ano_escolar ILIKE p_ano_like)
        AND (p_unidade  IS NULL OR nome_unidade = p_unidade)
        AND (p_turma    IS NULL OR turma = p_turma)
    ) h), '[]'::json) ELSE '[]'::json END
  );
$$;

CREATE OR REPLACE FUNCTION arvore_total()
RETURNS TABLE(nome_unidade text, ano_escolar text, turma text, qtd_alunos int)
LANGUAGE sql STABLE AS $$
  SELECT nome_unidade, ano_escolar, turma, qtd_alunos FROM mv_arvore_total;
$$;

-- Diagnóstica/Rede: devolve o pivô por aluno em um único json (sem paginação).
CREATE OR REPLACE FUNCTION alunos_diagnostica()
RETURNS json LANGUAGE sql STABLE AS $$
  SELECT COALESCE(json_agg(json_build_array(
    nome_unidade, ano_escolar, turma, rema_aluno, nome_aluno,
    e_valor, e_codigo, l_valor, l_codigo, p_valor, p_codigo
  )), '[]'::json)
  FROM mv_alunos_diag;
$$;

-- Atualiza as 3 views. (REFRESH simples — CONCURRENTLY não é permitido dentro
-- de função/transação. O refresh é rápido e roda a cada 5 min, então o bloqueio
-- momentâneo de leitura é irrelevante.)
-- Chame após importações para refletir os dados na hora: SELECT refresh_avaliacoes_mv();
CREATE OR REPLACE FUNCTION refresh_avaliacoes_mv()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_bimestres_grupos;
  REFRESH MATERIALIZED VIEW mv_bimestres_hier;
  REFRESH MATERIALIZED VIEW mv_arvore_total;
  REFRESH MATERIALIZED VIEW mv_alunos_diag;
END;
$$;

-- ── Permissões para a chave anon (e autenticados) ──
GRANT SELECT ON mv_bimestres_grupos, mv_bimestres_hier, mv_arvore_total, mv_alunos_diag TO anon, authenticated;
GRANT EXECUTE ON FUNCTION agrupar_bimestres(INT, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION arvore_total() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION alunos_diagnostica() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_avaliacoes_mv() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- REFRESH AUTOMÁTICO a cada 5 min (pg_cron) — para nunca ficar desatualizado.
-- Se esta seção der erro de permissão, habilite a extensão em:
--   Supabase > Database > Extensions > pg_cron  (e rode só esta parte de novo).
-- ════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- remove agendamento anterior (se existir) e recria
DO $$
BEGIN
  PERFORM cron.unschedule('refresh_avaliacoes');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('refresh_avaliacoes', '*/5 * * * *', $$SELECT refresh_avaliacoes_mv();$$);

-- ── Testes rápidos (opcional) ──
-- SELECT agrupar_bimestres(1);              -- 1º bimestre (instantâneo)
-- SELECT * FROM arvore_total();
-- SELECT refresh_avaliacoes_mv();           -- força atualização imediata
-- SELECT jobname, schedule FROM cron.job;   -- confere o agendamento
