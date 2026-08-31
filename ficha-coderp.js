/* ============================================================================
   ficha-coderp.js — a CAMADA DE TRANSPORTE da ficha do CODERP

   Segunda exceção deliberada ao "cada tela é autocontida" (a primeira é o
   `visao-rede.js`). Ela existe porque duas telas precisam do MESMO dado de
   bimestre, e uma segunda cópia desta camada divergiria da primeira na
   primeira correção feita em uma só.

   ⚠️ O que mora aqui é TRANSPORTE, não contagem: a chamada à Edge Function,
   o cache local, a distinção entre 404 (sem lançamento) e falha de verdade, o
   recorte por `per_cod` e o memo por (bimestre, ano escolar). A regra de
   contar aluno (`alunosPorItens`) NÃO subiu para cá de propósito — ela é
   específica do que cada tela pergunta, e o CLAUDE.md registra três tentativas
   erradas de mexer nela.

   ⚠️ Este arquivo foi LEVANTADO de `avaliacao.html` sem alteração de
   comportamento: os nomes exportados são os mesmos que estavam lá, para que
   os 18 pontos de chamada daquela tela não precisassem mudar. Ao corrigir algo
   aqui, lembre que conserta (ou quebra) as duas telas ao mesmo tempo.

   Uso:
     const F = window.MapaFicha.criar(supabaseUrl);
     const linhas = await F.fichaRedeTurma(bimestre, '1 ANO');

   O memo é POR INSTÂNCIA da fábrica. Como cada tela cria a sua, duas telas
   abertas na mesma aba não compartilham memória — mas compartilham o cache
   local do `auth.js` (IndexedDB), que é onde a economia de rede realmente
   está.
   ========================================================================= */
(function () {
  'use strict';

  function criar(supabaseUrl) {
    const FICHA_FN_URL = supabaseUrl + '/functions/v1/coderp-ficha';
    const FICHA_ANOS_ESCOLARES = ['1 ANO', '2 ANO', '3 ANO', '4 ANO', '5 ANO'];

    // ── O que o `per_cod` do CODERP pode trazer, e o que fica de fora ─────────
    // Medido em 2026-08 (bim 1, rede inteira sem filtro): 18 valores distintos.
    // A tela consultava só os cinco primeiros, então 36% das linhas da ficha
    // nunca chegavam aqui. Definido com a SME o que entra:
    //
    //   1 ANO … 9 ANO   Ensino Fundamental — é o objeto destas telas.
    //
    //   CIC 2/3/4       Educação Infantil, ciclos 2, 3 e 4 ─┐
    //   ETP 1/2         Educação Infantil, Etapas I e II     │ fora da contagem
    //   PECAI           PEC dos Anos Iniciais                │
    //   TAIMS           Termos Anos Iniciais Multi Seriados  │ turmas de
    //   TAFMS           Termos Anos Finais Multi Seriados    │ treinamento
    //   TREIN           Prática Desportiva masc./fem.       ─┘
    //
    // ⚠️ A lista é de EXCLUSÃO, não de inclusão, e isso é de propósito: um
    // per_cod novo que o CODERP passe a devolver entra na contagem e aparece na
    // tela, em vez de sumir em silêncio. Some quem for explicitamente excluído.
    const PER_COD_FORA = new Set([
      'CIC 2', 'CIC 3', 'CIC 4',      // Educação Infantil
      'ETP 1', 'ETP 2',               // Educação Infantil
      'PECAI',                        // PEC Anos Iniciais
      'TAIMS', 'TAFMS', 'TREIN',      // turmas de treinamento
    ]);
    const perCodContavel = p => {
      const v = String(p == null ? '' : p).trim().toUpperCase();
      return !!v && !PER_COD_FORA.has(v);
    };

    function fichaApiAtiva() {
      try {
        if (new URLSearchParams(location.search).get('coderp') === '0') return false;
      } catch (e) { /* URLSearchParams sempre existe nos navegadores atendidos */ }
      return true;
    }

    async function chamarFichaApi(nivel, parms) {
      // Cache local primeiro (IndexedDB do auth.js, aquecido pelas outras
      // telas): resposta fresca sai daqui SEM REDE — é a instantaneidade.
      const corpo = JSON.stringify({ nivel, parms });
      if (window.MapaFichaCache) {
        const pronto = await window.MapaFichaCache.ler(corpo).catch(() => null);
        if (pronto !== null) { try { return JSON.parse(pronto); } catch (e) { /* cai para a rede */ } }
      }

      const tok = window.MapaAuth && window.MapaAuth.token ? await window.MapaAuth.token() : null;
      if (!tok) throw new Error('sessão do MAPA indisponível');
      const r = await fetch(FICHA_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: corpo
      });
      const texto = await r.text();
      let resp = null;
      try { resp = JSON.parse(texto); } catch (e) { /* resposta não-JSON tratada abaixo */ }
      if (!r.ok) {
        // O status DO CODERP vai junto: sem ele, "502 coderp_recusou" não
        // distingue "não existe / sem lançamento" (404) de indisponibilidade.
        const dentro = resp && resp.status ? ' (CODERP ' + resp.status + ')' : '';
        const erro = new Error('coderp-ficha ' + r.status + ' ' + ((resp && resp.erro) || '') + dentro);
        // Exposto para quem chama poder tratar 404 como "vazio", e não como falha.
        erro.coderpStatus = (resp && resp.status) || 0;
        throw erro;
      }
      // Só entra no cache local resposta com dado real, ou vazio SEM Messages
      // (bimestre sem lançamento é legítimo; vazio COM aviso é suspeito e não
      // pode ficar "colado" por 10 min).
      const temDado = !!resp && (
        Object.keys(resp).some(k =>
          k.indexOf('fichasAvaliacoes') === 0 && Array.isArray(resp[k]) && resp[k].length)
        // O nível sintético `detalherede` devolve `linhas`, não `fichasAvaliacoes*`.
        || (Array.isArray(resp.linhas) && resp.linhas.length));
      const msgs = ((resp && resp.Messages) || []).filter(m => m && m.Description);
      // Resposta PARCIAL (leque incompleto) não vai para o cache: guardar uma
      // rede pela metade por 10 min esconderia unidades sem nenhum aviso.
      const parcial = !!(resp && resp.parcial);
      if (window.MapaFichaCache && resp && !parcial && (temDado || !msgs.length)) {
        window.MapaFichaCache.gravar(corpo, texto);
      }
      if (msgs.length) console.warn('[MAPA CODERP] Messages da API:', msgs);
      return resp || {};
    }

    function fichaAnoLetivo() { return new Date().getFullYear(); }

    // Memo por (bimestre, ano escolar): as telas compartilham as respostas
    // em vez de repetir chamadas à API.
    const _fichaTurmaMemo = new Map();

    function fichaRedeTurma(bimestre, anoEsc) {
      const k = bimestre + '|' + anoEsc;
      if (!_fichaTurmaMemo.has(k)) {
        _fichaTurmaMemo.set(k,
          chamarFichaApi('turma', { anoLetivo: fichaAnoLetivo(), bimestre: bimestre, anoescolar: anoEsc })
            .then(r => r.fichasAvaliacoesTurma || [])
            .catch(err => { _fichaTurmaMemo.delete(k); throw err; }));
      }
      return _fichaTurmaMemo.get(k);
    }

    return {
      FICHA_FN_URL: FICHA_FN_URL,
      FICHA_ANOS_ESCOLARES: FICHA_ANOS_ESCOLARES,
      PER_COD_FORA: PER_COD_FORA,
      perCodContavel: perCodContavel,
      fichaApiAtiva: fichaApiAtiva,
      chamarFichaApi: chamarFichaApi,
      fichaAnoLetivo: fichaAnoLetivo,
      fichaRedeTurma: fichaRedeTurma,
    };
  }

  window.MapaFicha = { criar: criar };
})();
