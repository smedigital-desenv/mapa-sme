-- ============================================================
-- PERFORMANCE — AGREGAÇÃO SERVER-SIDE DAS AVALIAÇÕES
-- Rode este script UMA VEZ no SQL Editor do Supabase.
--
-- Objetivo: parar de baixar a tabela `bimestres` inteira (269 mil linhas)
-- para o navegador. Em vez disso, o Postgres já devolve os dados SOMADOS
-- por combinação crua de colunas (poucos KB). A normalização/rotulagem
-- continua igual no JS, rodando sobre esse conjunto pequeno — então os
-- números exibidos permanecem idênticos.
-- ============================================================

-- ── Índices: aceleram os filtros por bimestre / unidade / turma ──
CREATE INDEX IF NOT EXISTS idx_bimestres_bimestre ON bimestres (bimestre);
CREATE INDEX IF NOT EXISTS idx_bimestres_unidade  ON bimestres (nome_unidade);
CREATE INDEX IF NOT EXISTS idx_bimestres_turma    ON bimestres (turma);

-- ── FUNÇÃO 1: agrupa `bimestres` por colunas cruas ──
-- Retorna { grupos: [...], hier: [...] }:
--   grupos = contagem por (bimestre, unidade, ano, turma, disciplina, eixo,
--            valor/codigo/texto da resposta)  → alimenta linhas/Total/eixos
--   hier   = nº de alunos DISTINTOS por (bimestre, unidade, ano, turma)
--            (só calculado quando p_incluir_hier = true — o Total não precisa)
-- Obs.: NÃO agrupamos por `fqs` (texto da pergunta) — nenhum consumidor usa e
-- isso reduz muito o nº de linhas agrupadas (json menor, resposta mais rápida).
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
    'grupos', COALESCE((SELECT json_agg(g) FROM (
      SELECT b.bimestre, b.nome_unidade, b.ano_escolar, b.turma,
             b.fnc_disciplina, b.descricao_fne,
             b.valor_resposta, b.codigo_resposta, b.texto_resposta,
             COUNT(*)::int AS qtd
      FROM bimestres b
      WHERE (p_bimestre IS NULL OR b.bimestre = p_bimestre)
        AND (p_ano_like IS NULL OR b.ano_escolar ILIKE p_ano_like)
        AND (p_unidade  IS NULL OR b.nome_unidade = p_unidade)
        AND (p_turma    IS NULL OR b.turma = p_turma)
      GROUP BY b.bimestre, b.nome_unidade, b.ano_escolar, b.turma,
               b.fnc_disciplina, b.descricao_fne,
               b.valor_resposta, b.codigo_resposta, b.texto_resposta
    ) g), '[]'::json),
    'hier', CASE WHEN p_incluir_hier THEN COALESCE((SELECT json_agg(h) FROM (
      SELECT b.bimestre, b.nome_unidade, b.ano_escolar, b.turma,
             COUNT(DISTINCT COALESCE(b.rema_aluno, b.nome_aluno))::int AS qtd_alunos
      FROM bimestres b
      WHERE (p_bimestre IS NULL OR b.bimestre = p_bimestre)
        AND (p_ano_like IS NULL OR b.ano_escolar ILIKE p_ano_like)
        AND (p_unidade  IS NULL OR b.nome_unidade = p_unidade)
        AND (p_turma    IS NULL OR b.turma = p_turma)
      GROUP BY b.bimestre, b.nome_unidade, b.ano_escolar, b.turma
    ) h), '[]'::json) ELSE '[]'::json END
  );
$$;

-- ── FUNÇÃO 2: árvore do Total — alunos distintos por unidade/ano/turma ──
-- Une `bimestres` e `alunos` (UNION remove duplicados) e conta alunos únicos.
CREATE OR REPLACE FUNCTION arvore_total()
RETURNS TABLE(nome_unidade text, ano_escolar text, turma text, qtd_alunos int)
LANGUAGE sql STABLE AS $$
  SELECT s.nome_unidade, s.ano_escolar, s.turma, COUNT(*)::int AS qtd_alunos
  FROM (
    SELECT nome_unidade, ano_escolar, turma, COALESCE(rema_aluno, nome_aluno) AS id
      FROM bimestres
    UNION
    SELECT nome_unidade, ano_escolar, turma, COALESCE(rema_aluno, nome_aluno) AS id
      FROM alunos
  ) s
  GROUP BY s.nome_unidade, s.ano_escolar, s.turma;
$$;

-- ── Permissões para a chave anon (e usuários autenticados) ──
GRANT EXECUTE ON FUNCTION agrupar_bimestres(INT, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION arvore_total() TO anon, authenticated;

-- ── Testes rápidos (opcional) ──
-- SELECT agrupar_bimestres(1, NULL, NULL, NULL);   -- 1º bimestre
-- SELECT * FROM arvore_total();
