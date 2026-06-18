-- ============================================================
-- FASE 1.5: SUPABASE FUNCTIONS - BIMESTRES
-- ============================================================

-- ─────────────────────────────────────────────────────────
-- FUNCTION 1: Obter registros de bimestre por filtros
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION obter_bimestre_registros(
  p_unidade_id INT DEFAULT NULL,
  p_bimestre INT DEFAULT NULL,
  p_turma TEXT DEFAULT NULL,
  p_disciplina TEXT DEFAULT NULL,
  p_nome_aluno TEXT DEFAULT NULL,
  p_limit INT DEFAULT 1000,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  unidade_id INT,
  nome_unidade TEXT,
  avaliacao TEXT,
  ano_escolar TEXT,
  bimestre INT,
  turma TEXT,
  rema_aluno TEXT,
  nome_aluno TEXT,
  fnc_disciplina TEXT,
  descricao_fne TEXT,
  fqs TEXT,
  codigo_resposta TEXT,
  texto_resposta TEXT,
  valor_resposta TEXT,
  total_registros BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.unidade_id,
    b.nome_unidade,
    b.avaliacao,
    b.ano_escolar,
    b.bimestre,
    b.turma,
    b.rema_aluno,
    b.nome_aluno,
    b.fnc_disciplina,
    b.descricao_fne,
    b.fqs,
    b.codigo_resposta,
    b.texto_resposta,
    b.valor_resposta,
    COUNT(*) OVER() as total_registros
  FROM bimestres b
  WHERE 
    (p_unidade_id IS NULL OR b.unidade_id = p_unidade_id)
    AND (p_bimestre IS NULL OR b.bimestre = p_bimestre)
    AND (p_turma IS NULL OR b.turma ILIKE p_turma)
    AND (p_disciplina IS NULL OR b.fnc_disciplina ILIKE p_disciplina)
    AND (p_nome_aluno IS NULL OR b.nome_aluno ILIKE '%' || p_nome_aluno || '%')
  ORDER BY b.nome_aluno, b.fnc_disciplina
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────
-- FUNCTION 2: Resumo de disciplinas por bimestre
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resumo_disciplinas_bimestre(
  p_unidade_id INT DEFAULT NULL,
  p_bimestre INT DEFAULT NULL
)
RETURNS TABLE (
  fnc_disciplina TEXT,
  total_alunos INT,
  alunos_sim INT,
  alunos_nao INT,
  percentual_sucesso DECIMAL,
  descricao_count INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.fnc_disciplina,
    COUNT(DISTINCT b.rema_aluno)::INT as total_alunos,
    COUNT(DISTINCT CASE WHEN b.valor_resposta = 'S' THEN b.rema_aluno END)::INT as alunos_sim,
    COUNT(DISTINCT CASE WHEN b.valor_resposta = 'N' THEN b.rema_aluno END)::INT as alunos_nao,
    CASE 
      WHEN COUNT(DISTINCT b.rema_aluno) > 0
      THEN ROUND(
        (COUNT(DISTINCT CASE WHEN b.valor_resposta = 'S' THEN b.rema_aluno END)::NUMERIC / 
         COUNT(DISTINCT b.rema_aluno) * 100), 2
      )::DECIMAL
      ELSE 0::DECIMAL
    END as percentual_sucesso,
    COUNT(*)::INT as descricao_count
  FROM bimestres b
  WHERE 
    (p_unidade_id IS NULL OR b.unidade_id = p_unidade_id)
    AND (p_bimestre IS NULL OR b.bimestre = p_bimestre)
  GROUP BY b.fnc_disciplina
  ORDER BY fnc_disciplina;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────
-- FUNCTION 3: Detalhes de um aluno em todas as disciplinas
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION detalhe_aluno_bimestre(
  p_rema_aluno TEXT,
  p_bimestre INT DEFAULT NULL
)
RETURNS TABLE (
  nome_aluno TEXT,
  nome_unidade TEXT,
  turma TEXT,
  fnc_disciplina TEXT,
  descricao_fne TEXT,
  valor_resposta TEXT,
  texto_resposta TEXT,
  bimestre INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.nome_aluno,
    b.nome_unidade,
    b.turma,
    b.fnc_disciplina,
    b.descricao_fne,
    b.valor_resposta,
    b.texto_resposta,
    b.bimestre
  FROM bimestres b
  WHERE 
    b.rema_aluno = p_rema_aluno
    AND (p_bimestre IS NULL OR b.bimestre = p_bimestre)
  ORDER BY b.fnc_disciplina, b.bimestre;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────
-- FUNCTION 4: Estatísticas gerais de um bimestre
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION estatisticas_bimestre(
  p_unidade_id INT DEFAULT NULL,
  p_bimestre INT DEFAULT NULL
)
RETURNS TABLE (
  total_alunos BIGINT,
  total_descricoes BIGINT,
  total_sim BIGINT,
  total_nao BIGINT,
  percentual_sucesso DECIMAL,
  total_disciplinas INT,
  total_turmas INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT b.rema_aluno) as total_alunos,
    COUNT(*)::BIGINT as total_descricoes,
    COUNT(CASE WHEN b.valor_resposta = 'S' THEN 1 END)::BIGINT as total_sim,
    COUNT(CASE WHEN b.valor_resposta = 'N' THEN 1 END)::BIGINT as total_nao,
    CASE 
      WHEN COUNT(*) > 0
      THEN ROUND(
        (COUNT(CASE WHEN b.valor_resposta = 'S' THEN 1 END)::NUMERIC / COUNT(*) * 100), 2
      )::DECIMAL
      ELSE 0::DECIMAL
    END as percentual_sucesso,
    COUNT(DISTINCT b.fnc_disciplina)::INT as total_disciplinas,
    COUNT(DISTINCT b.turma)::INT as total_turmas
  FROM bimestres b
  WHERE 
    (p_unidade_id IS NULL OR b.unidade_id = p_unidade_id)
    AND (p_bimestre IS NULL OR b.bimestre = p_bimestre);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TESTES DAS FUNCTIONS
-- ============================================================

-- Testar Function 1 (com LIMIT para não retornar 269k linhas)
-- SELECT * FROM obter_bimestre_registros(NULL, 1, NULL, NULL, NULL, 10, 0);

-- Testar Function 2
-- SELECT * FROM resumo_disciplinas_bimestre(NULL, 1);

-- Testar Function 3
-- SELECT * FROM detalhe_aluno_bimestre('238402', 1);

-- Testar Function 4
-- SELECT * FROM estatisticas_bimestre(NULL, 1);
