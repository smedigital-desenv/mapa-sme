function testarTotalHotfix() {
  var r = getTotalAvaliacoesRapido({__pacote:true, ano:'TODOS'});
  Logger.log('OK pacote: ' + r.ok);
  Logger.log('Linhas pacote: ' + ((r.linhas || []).length));

  var normal = getTotalAvaliacoesRapido({
    unidade:'TODAS',
    ano:'TODOS',
    turma:'TODAS'
  });
  Logger.log('OK normal: ' + normal.ok);
  Logger.log('Linhas normal: ' + ((normal.linhas || []).length));
}