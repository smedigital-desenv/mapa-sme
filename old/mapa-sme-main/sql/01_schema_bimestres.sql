-- ============================================================
-- 01_SCHEMA_BIMESTRES.SQL
-- Cria a tabela de bimestres com índices de performance.
-- Execute no SQL Editor do Supabase.
-- ============================================================

-- 1. Tabela principal
CREATE TABLE IF NOT EXISTS bimestres (
  id BIGSERIAL PRIMARY KEY,
  unidade_id INT REFERENCES unidades(id) ON DELETE CASCADE,
  nome_unidade TEXT NOT NULL,
  avaliacao TEXT,
  ano_escolar TEXT,
  bimestre INT NOT NULL DEFAULT 1,
  turma TEXT,
  rema_aluno TEXT,
  nome_aluno TEXT,
  fnc_disciplina TEXT,
  descricao_fne TEXT,
  fqs TEXT,
  codigo_resposta TEXT,
  texto_resposta TEXT,
  valor_resposta TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_bimestres_unidade_id ON bimestres(unidade_id);
CREATE INDEX IF NOT EXISTS idx_bimestres_bimestre   ON bimestres(bimestre);
CREATE INDEX IF NOT EXISTS idx_bimestres_turma      ON bimestres(turma);
CREATE INDEX IF NOT EXISTS idx_bimestres_aluno      ON bimestres(nome_aluno);
CREATE INDEX IF NOT EXISTS idx_bimestres_disciplina ON bimestres(fnc_disciplina);
CREATE INDEX IF NOT EXISTS idx_bimestres_rema       ON bimestres(rema_aluno);

-- 3. Índice composto (queries mais comuns)
CREATE INDEX IF NOT EXISTS idx_bimestres_uni_bim_aluno
  ON bimestres(unidade_id, bimestre, nome_aluno);

-- 4. Row Level Security
ALTER TABLE bimestres ENABLE ROW LEVEL SECURITY;

-- 5. Policy de leitura pública
--    (DROP antes para evitar erro se já existir)
DROP POLICY IF EXISTS "leitura_publica_bimestres" ON bimestres;
CREATE POLICY "leitura_publica_bimestres"
  ON bimestres FOR SELECT
  USING (true);

-- ============================================================
-- VERIFICAÇÃO (opcional - rode separado)
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'bimestres' ORDER BY ordinal_position;
-- SELECT COUNT(*) FROM bimestres;
