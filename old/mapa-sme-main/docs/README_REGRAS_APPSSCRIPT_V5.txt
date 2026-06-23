PATCH MAPA Supabase v5 — Réplica mais fiel das regras do Apps Script

Regras auditadas e alinhadas:

1. TURMAS / PPA / PRA
- Período M/T/N convertido para Manhã/Tarde/Noite como no Apps Script.
- Atribuído usa somente Identificação da Atribuição: status 2, status 4 ou TROCA.
- Substituto usa somente status 4.
- PPA: Magistério II entra na meta apenas quando o Ano Escolar é 2º Ano, igual ao Apps Script.
- Magistério II segue limitado às turmas regulares definidas no ajuste anterior.
- Base_MAPA: soma carga somente quando a letra da turma criada for posterior à última letra existente em Turmas.
- PRA mantém a regra por PROJ. RECUP. APREND. ANOS INIC.

2. AVALIAÇÕES / BIMESTRES
- Rótulos de resposta replicam labelRespostaPainel_ do Apps Script.
- Escrita, Leitura, Produção Textual e AEE usam os mesmos mapas de rótulos.
- Normalização de disciplina segue a regra do Apps Script para evitar duplicidades, como Educação Física repetida.
- Detalhe por eixo e modal de alunos filtram por disciplina/eixo usando normalização, não igualdade literal quebrada por acentos/variações.

3. TOTAL
- Diagnóstica volta a entrar como campo diag a partir da tabela alunos.
- Diagnóstica no Total é consolidada como Língua Portuguesa, igual ao Apps Script.
- Bimestres alimentam b1, b2, b3 e b4.
- Valor numérico usa a regra do Apps Script: Não Avaliado e Não produz não entram como média numérica.
- Eixos do Total são normalizados como LEITURA, ESCRITA, PRODUÇÃO TEXTUAL, ORALIDADE, COMPLEMENTAR.

4. CACHE
- Chaves de cache foram alteradas para v5, evitando reaproveitar resultados incorretos dos patches anteriores.

Aplicação:
- Substituir index.html no projeto GitHub Pages.
- Fazer commit/push.
- Abrir o site com Ctrl+F5.
- Se necessário, executar sessionStorage.clear(); location.reload(); no console.
