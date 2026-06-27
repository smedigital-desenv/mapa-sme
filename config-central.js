/* ============================================================================
   config-central.js — Painel de CONFIGURAÇÕES geral (controle de acesso).
   Incluído em TODAS as telas do MAPA. Injeta o overlay + estilos e expõe
   window.abrirConfig(). Aparece só para super admin (botão #btnConfig do nav).
   Depende de: auth.js (window.MAPA_SB autenticado, evento 'mapa-auth-pronto').
   ============================================================================ */
(function () {
  if (window.__configCentralCarregado) return;
  window.__configCentralCarregado = true;

  var cfg = { perfis: [], telas: [], escolas: [], editId: null, escSel: new Set(), _telasSel: new Set() };
  window.__cfg = cfg;

  /* ── estilos ───────────────────────────────────────────────────────────── */
  var css = ''
    + '#cfgOverlay{position:fixed;inset:0;z-index:4000;background:rgba(2,16,38,.55);display:none;padding:18px;overflow:auto;}'
    + '#cfgOverlay.show{display:block;}'
    + '.cfg-modal{background:#fff;border-radius:16px;max-width:980px;margin:0 auto;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;font-family:"Inter",system-ui,sans-serif;}'
    + '.cfg-head{background:#002b5e;color:#fff;padding:1rem 1.3rem;display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid #00e5ff;}'
    + '.cfg-head h5{margin:0;font-weight:900;letter-spacing:.02em;}'
    + '.cfg-x{background:none;border:0;color:#fff;font-size:1.4rem;cursor:pointer;line-height:1;}'
    + '.cfg-body{padding:1.2rem 1.3rem;}'
    + '.cfg-tela-chk{display:flex;align-items:center;gap:.5rem;padding:.35rem .6rem;border:1px solid #e2e8f0;border-radius:9px;font-weight:700;color:#334155;font-size:.86rem;}'
    + '.cfg-tela-chk input{width:18px;height:18px;}'
    + '.cfg-perfil-row{cursor:pointer;}'
    + '.cfg-perfil-row:hover{background:#f1f5f9;}'
    + '.cfg-badge-adm{background:#fde68a;color:#92400e;font-weight:800;font-size:.66rem;padding:2px 7px;border-radius:999px;}'
    + '.cfg-badge-off{background:#fee2e2;color:#b91c1c;font-weight:800;font-size:.66rem;padding:2px 7px;border-radius:999px;}';

  /* ── markup do overlay ─────────────────────────────────────────────────── */
  var html = ''
    + '<div id="cfgOverlay"><div class="cfg-modal">'
    + '  <div class="cfg-head"><h5><i class="bi bi-gear-fill me-2"></i>Configurações de acesso</h5>'
    + '    <button class="cfg-x" onclick="fecharConfig()" title="Fechar">&times;</button></div>'
    + '  <div class="cfg-body">'
    + '    <div id="cfgErro" class="alert alert-danger py-2 px-3" style="display:none"></div>'
    + '    <div id="cfgListaView">'
    + '      <div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">'
    + '        <input id="cfgBusca" class="form-control form-control-sm" style="max-width:280px" placeholder="Buscar e-mail ou nome…" oninput="cfgRenderLista()">'
    + '        <div class="d-flex gap-2">'
    + '          <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="cfgAbrirAnos()"><i class="bi bi-calendar2-x"></i> Anos escolares</button>'
    + '          <button class="btn btn-sm btn-primary fw-bold" onclick="cfgNovo()"><i class="bi bi-plus-lg"></i> Novo perfil</button>'
    + '        </div>'
    + '      </div>'
    + '      <div class="table-responsive"><table class="table table-sm align-middle">'
    + '        <thead><tr class="text-uppercase" style="font-size:.7rem;color:#64748b">'
    + '          <th>E-mail</th><th>Nome</th><th>Tipo</th><th class="text-center">Telas</th>'
    + '          <th class="text-center">Unidades</th><th class="text-center">Status</th><th></th></tr></thead>'
    + '        <tbody id="cfgTbody"><tr><td colspan="7" class="text-muted">Carregando…</td></tr></tbody>'
    + '      </table></div>'
    + '    </div>'
    + '    <div id="cfgEditView" style="display:none">'
    + '      <button class="btn btn-sm btn-link px-0 mb-2" onclick="cfgVoltar()"><i class="bi bi-arrow-left"></i> Voltar à lista</button>'
    + '      <div class="row g-3">'
    + '        <div class="col-12 col-md-6"><label class="form-label fw-bold small">E-mail (Google) *</label>'
    + '          <input id="edEmail" class="form-control form-control-sm" placeholder="nome@educacao.pmrp.sp.gov.br"></div>'
    + '        <div class="col-12 col-md-6"><label class="form-label fw-bold small">Nome</label>'
    + '          <input id="edNome" class="form-control form-control-sm" placeholder="Nome do servidor"></div>'
    + '        <div class="col-6 col-md-4"><label class="form-label fw-bold small">Tipo</label>'
    + '          <select id="edTipo" class="form-select form-select-sm">'
    + '            <option value="escola">Escola</option><option value="secretaria">Secretaria</option><option value="externo">Externo</option></select></div>'
    + '        <div class="col-6 col-md-4 d-flex align-items-end"><div class="form-check">'
    + '          <input id="edAtivo" class="form-check-input" type="checkbox" checked>'
    + '          <label class="form-check-label fw-bold small" for="edAtivo">Ativo</label></div></div>'
    + '        <div class="col-12 col-md-4 d-flex align-items-end"><div class="form-check">'
    + '          <input id="edAdmin" class="form-check-input" type="checkbox" onchange="cfgToggleAdmin()">'
    + '          <label class="form-check-label fw-bold small" for="edAdmin">Super admin (acesso total)</label></div></div>'
    + '        <div class="col-12"><div class="form-check">'
    + '          <input id="edBypass" class="form-check-input" type="checkbox">'
    + '          <label class="form-check-label fw-bold small" for="edBypass">Permitir login fora do domínio @educacao.pmrp.sp.gov.br (ex.: @gmail.com)</label></div></div>'
    + '        <div class="col-12"><label class="form-label fw-bold small">Telas que este perfil pode acessar</label>'
    + '          <div id="edTelas" class="d-flex flex-wrap gap-2"></div>'
    + '          <div class="form-text" id="edTelasHint"></div></div>'
    + '        <div class="col-12"><label class="form-label fw-bold small">Unidades vinculadas</label>'
    + '          <input id="edEscBusca" class="form-control form-control-sm mb-1" placeholder="Filtrar unidades…" oninput="cfgRenderEscolas()">'
    + '          <select id="edEscolas" class="form-select" multiple size="6"></select>'
    + '          <div class="input-group input-group-sm mt-1">'
    + '            <input id="edNovaEsc" class="form-control" placeholder="Cadastrar nova unidade (nome)…">'
    + '            <button class="btn btn-outline-secondary" onclick="cfgAddEscola()">Adicionar unidade</button></div>'
    + '          <div class="form-text">Segure Ctrl (ou Cmd) para selecionar várias. Sem unidade = acesso geral às telas marcadas.</div></div>'
    + '      </div>'
    + '      <div class="d-flex justify-content-between mt-3">'
    + '        <button id="edExcluir" class="btn btn-sm btn-outline-danger" onclick="cfgExcluir()" style="display:none"><i class="bi bi-trash"></i> Excluir perfil</button>'
    + '        <div class="ms-auto"><button class="btn btn-sm btn-secondary" onclick="cfgVoltar()">Cancelar</button>'
    + '          <button class="btn btn-sm btn-primary fw-bold" onclick="cfgSalvar()"><i class="bi bi-check-lg"></i> Salvar</button></div>'
    + '      </div>'
    + '    </div>'
    + '    <div id="cfgAnosView" style="display:none">'
    + '      <button class="btn btn-sm btn-link px-0 mb-2" onclick="cfgVoltar()"><i class="bi bi-arrow-left"></i> Voltar à lista</button>'
    + '      <div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">'
    + '        <div><div class="fw-bold" style="color:#002b5e">Limpeza de anos escolares</div>'
    + '          <div class="form-text m-0">Marque os anos que <b>NÃO</b> devem aparecer no sistema.</div></div>'
    + '        <input id="anoBusca" class="form-control form-control-sm" style="max-width:240px" placeholder="Filtrar anos…" oninput="cfgRenderAnos()">'
    + '      </div>'
    + '      <div class="d-flex gap-2 mb-2"><button class="btn btn-sm btn-outline-secondary py-0" onclick="cfgMarcarAnos(true)">Marcar todos</button>'
    + '        <button class="btn btn-sm btn-outline-secondary py-0" onclick="cfgMarcarAnos(false)">Desmarcar todos</button>'
    + '        <span id="anoResumo" class="small text-muted align-self-center"></span></div>'
    + '      <div id="anosBox" style="max-height:46vh;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;padding:.5rem"></div>'
    + '      <div class="d-flex justify-content-end mt-3">'
    + '        <button class="btn btn-sm btn-primary fw-bold" onclick="cfgSalvarAnos()"><i class="bi bi-check-lg"></i> Salvar exclusões</button></div>'
    + '    </div>'
    + '  </div></div></div>';

  function montar() {
    if (document.getElementById('cfgOverlay')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstChild);
  }

  /* ── mostra o botão da engrenagem só p/ super admin ───────────────────── */
  function mostrarBtn(A) {
    if (A && A.perfil && A.perfil.is_super_admin) {
      var b = document.getElementById('btnConfig');
      if (b) b.style.display = '';
    }
  }
  document.addEventListener('mapa-auth-pronto', function (e) { mostrarBtn(e.detail || window.MapaAuth); });
  // caso o auth já tenha terminado antes deste script
  if (window.MapaAuth) mostrarBtn(window.MapaAuth);

  function sb() { return window.MAPA_SB; }
  function erro(msg) {
    var el = document.getElementById('cfgErro'); if (!el) return;
    if (!msg) { el.style.display = 'none'; return; }
    el.textContent = msg; el.style.display = 'block';
  }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }

  window.abrirConfig = async function () {
    montar();
    document.getElementById('cfgOverlay').classList.add('show');
    cfgVoltar(); erro('');
    if (!sb()) { erro('Sessão não carregada. Recarregue a página.'); return; }
    try { await cfgCarregarCatalogos(); await cfgCarregarPerfis(); }
    catch (ex) { erro('Erro ao carregar: ' + (ex.message || ex)); }
  };
  window.fecharConfig = function () { var o = document.getElementById('cfgOverlay'); if (o) o.classList.remove('show'); };
  window.cfgVoltar = function () {
    var ev = document.getElementById('cfgEditView'), lv = document.getElementById('cfgListaView'),
        av = document.getElementById('cfgAnosView');
    if (ev) ev.style.display = 'none';
    if (av) av.style.display = 'none';
    if (lv) lv.style.display = '';
  };

  // ── Limpeza de anos escolares ───────────────────────────────────────────
  var _anos = [], _anosExcl = new Set();
  window.cfgAbrirAnos = async function () {
    erro('');
    document.getElementById('cfgListaView').style.display = 'none';
    document.getElementById('cfgEditView').style.display = 'none';
    document.getElementById('cfgAnosView').style.display = '';
    document.getElementById('anosBox').innerHTML = '<div class="text-muted p-2">Carregando…</div>';
    try {
      var r = await sb().rpc('anos_escolares');
      if (r.error) throw r.error;
      _anos = r.data || [];
      var e = await sb().from('config_series_excluidas').select('serie,excluido');
      if (e.error) throw e.error;
      _anosExcl = new Set((e.data || []).filter(function (x) { return x.excluido !== false; })
        .map(function (x) { return x.serie; }));
      cfgRenderAnos();
    } catch (ex) { erro('Erro ao carregar anos: ' + (ex.message || ex)); }
  };

  window.cfgRenderAnos = function () {
    var q = (document.getElementById('anoBusca').value || '').toLowerCase();
    var box = document.getElementById('anosBox');
    var lista = _anos.filter(function (a) { return !q || String(a.ano_escolar).toLowerCase().includes(q); });
    box.innerHTML = lista.map(function (a) {
      var s = a.ano_escolar, on = _anosExcl.has(s);
      return '<label class="cfg-tela-chk mb-1" style="width:100%">'
        + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="cfgToggleAno(this,\'' + escHtml(String(s).replace(/'/g, "\\'")) + '\')">'
        + '<span style="flex:1">' + escHtml(s) + '</span>'
        + '<span class="text-muted small">' + (a.qtd || 0) + '</span></label>';
    }).join('') || '<div class="text-muted p-2">Nenhum ano.</div>';
    document.getElementById('anoResumo').textContent = _anosExcl.size + ' marcado(s) para esconder · ' + _anos.length + ' no total';
  };

  window.cfgToggleAno = function (el, serie) {
    if (el.checked) _anosExcl.add(serie); else _anosExcl.delete(serie);
    document.getElementById('anoResumo').textContent = _anosExcl.size + ' marcado(s) para esconder · ' + _anos.length + ' no total';
  };

  window.cfgMarcarAnos = function (todos) {
    var q = (document.getElementById('anoBusca').value || '').toLowerCase();
    _anos.forEach(function (a) {
      if (q && !String(a.ano_escolar).toLowerCase().includes(q)) return; // só os visíveis pelo filtro
      if (todos) _anosExcl.add(a.ano_escolar); else _anosExcl.delete(a.ano_escolar);
    });
    cfgRenderAnos();
  };

  window.cfgSalvarAnos = async function () {
    erro('');
    try {
      var del = await sb().from('config_series_excluidas').delete().neq('serie', '__nao_existe__');
      if (del.error) throw del.error;
      var rows = Array.from(_anosExcl).map(function (s) { return { serie: s, excluido: true }; });
      if (rows.length) {
        var ins = await sb().from('config_series_excluidas').insert(rows);
        if (ins.error) throw ins.error;
      }
      erro('');
      var resumo = document.getElementById('anoResumo');
      resumo.innerHTML = '<span class="text-success fw-bold">Salvo! ' + rows.length + ' ano(s) ocultado(s).</span>';
    } catch (ex) { erro('Erro ao salvar anos: ' + (ex.message || ex)); }
  };

  async function cfgCarregarCatalogos() {
    if (cfg.telas.length && cfg.escolas.length) return;
    var s = await sb().from('sistemas').select('id').eq('slug', 'mapa').single();
    if (s.error) throw s.error;
    var t = await sb().from('telas').select('id,slug,nome,ordem').eq('sistema_id', s.data.id).order('ordem');
    if (t.error) throw t.error;
    cfg.telas = t.data || [];
    var e = await sb().from('escolas').select('id,nome').eq('ativo', true).order('nome');
    if (e.error) throw e.error;
    cfg.escolas = e.data || [];
  }

  async function cfgCarregarPerfis() {
    var r = await sb().from('perfis').select('id,email,nome,tipo,ativo,is_super_admin,bypass_dominio').order('email');
    if (r.error) throw r.error;
    var pt = await sb().from('perfil_tela').select('perfil_id,pode_ver');
    var pe = await sb().from('perfil_escola').select('perfil_id');
    var ct = {}, ce = {};
    (pt.data || []).forEach(function (x) { if (x.pode_ver) ct[x.perfil_id] = (ct[x.perfil_id] || 0) + 1; });
    (pe.data || []).forEach(function (x) { ce[x.perfil_id] = (ce[x.perfil_id] || 0) + 1; });
    cfg.perfis = (r.data || []).map(function (p) {
      p._telas = p.is_super_admin ? cfg.telas.length : (ct[p.id] || 0);
      p._escolas = ce[p.id] || 0; return p;
    });
    cfgRenderLista();
  }

  window.cfgRenderLista = function () {
    var bEl = document.getElementById('cfgBusca'); if (!bEl) return;
    var q = (bEl.value || '').toLowerCase();
    var rows = cfg.perfis.filter(function (p) {
      return !q || (p.email || '').toLowerCase().includes(q) || (p.nome || '').toLowerCase().includes(q);
    });
    var tb = document.getElementById('cfgTbody');
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" class="text-muted">Nenhum perfil.</td></tr>'; return; }
    tb.innerHTML = rows.map(function (p) {
      return '<tr class="cfg-perfil-row" onclick="cfgEditar(' + p.id + ')">'
        + '<td class="fw-bold">' + escHtml(p.email) + (p.is_super_admin ? ' <span class="cfg-badge-adm">SUPER</span>' : '') + '</td>'
        + '<td>' + escHtml(p.nome || '—') + '</td>'
        + '<td><span class="text-capitalize">' + escHtml(p.tipo || '—') + '</span></td>'
        + '<td class="text-center">' + (p.is_super_admin ? 'todas' : p._telas) + '</td>'
        + '<td class="text-center">' + p._escolas + '</td>'
        + '<td class="text-center">' + (p.ativo ? '<span class="text-success fw-bold">ativo</span>' : '<span class="cfg-badge-off">inativo</span>') + '</td>'
        + '<td class="text-end" style="white-space:nowrap">'
        +   '<button class="btn btn-sm btn-outline-secondary py-0 px-1 me-1" title="Simular acesso deste usuário" '
        +     'onclick="event.stopPropagation();cfgSimular(\'' + escHtml(p.email) + '\')"><i class="bi bi-incognito"></i></button>'
        +   '<i class="bi bi-pencil-square text-primary"></i></td></tr>';
    }).join('');
  };

  window.cfgSimular = function (email) {
    if (window.MapaAuth && typeof window.MapaAuth.simular === 'function') {
      window.MapaAuth.simular(email);
    }
  };

  window.cfgNovo = function () { abrirEditor(null); };
  window.cfgEditar = async function (id) {
    erro('');
    var p = cfg.perfis.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var pt = await sb().from('perfil_tela').select('tela_id,pode_ver').eq('perfil_id', id);
    var pe = await sb().from('perfil_escola').select('escola_id').eq('perfil_id', id);
    var telasSel = new Set((pt.data || []).filter(function (x) { return x.pode_ver; }).map(function (x) { return x.tela_id; }));
    cfg.escSel = new Set((pe.data || []).map(function (x) { return x.escola_id; }));
    abrirEditor(p, telasSel);
  };

  function abrirEditor(p, telasSel) {
    cfg.editId = p ? p.id : null;
    document.getElementById('cfgListaView').style.display = 'none';
    document.getElementById('cfgEditView').style.display = '';
    document.getElementById('edEmail').value = p ? (p.email || '') : '';
    document.getElementById('edEmail').readOnly = !!p;
    document.getElementById('edNome').value = p ? (p.nome || '') : '';
    document.getElementById('edTipo').value = p ? (p.tipo || 'escola') : 'escola';
    document.getElementById('edAtivo').checked = p ? !!p.ativo : true;
    document.getElementById('edAdmin').checked = p ? !!p.is_super_admin : false;
    document.getElementById('edBypass').checked = p ? !!p.bypass_dominio : false;
    document.getElementById('edExcluir').style.display = p ? '' : 'none';
    if (!p) { cfg.escSel = new Set(); telasSel = new Set(); }
    cfgRenderTelas(telasSel);
    cfgRenderEscolas();
    cfgToggleAdmin();
  }

  window.cfgRenderTelas = function (telasSel) {
    if (telasSel) cfg._telasSel = telasSel;
    var sel = cfg._telasSel || new Set();
    document.getElementById('edTelas').innerHTML = cfg.telas.map(function (t) {
      return '<label class="cfg-tela-chk"><input type="checkbox" value="' + t.id + '"' + (sel.has(t.id) ? ' checked' : '') + '> ' + escHtml(t.nome) + '</label>';
    }).join('') || '<span class="text-muted small">Rode o sql/07 para cadastrar as telas.</span>';
  };

  window.cfgToggleAdmin = function () {
    var adm = document.getElementById('edAdmin').checked;
    var box = document.getElementById('edTelas');
    box.style.opacity = adm ? .5 : 1; box.style.pointerEvents = adm ? 'none' : 'auto';
    document.getElementById('edTelasHint').textContent = adm
      ? 'Super admin acessa todas as telas automaticamente.'
      : 'Marque as telas liberadas para este perfil.';
  };

  window.cfgRenderEscolas = function () {
    var q = (document.getElementById('edEscBusca').value || '').toLowerCase();
    var selEl = document.getElementById('edEscolas');
    selEl.innerHTML = cfg.escolas
      .filter(function (e) { return !q || (e.nome || '').toLowerCase().includes(q); })
      .map(function (e) { return '<option value="' + e.id + '"' + (cfg.escSel.has(e.id) ? ' selected' : '') + '>' + escHtml(e.nome) + '</option>'; })
      .join('') || '<option disabled>Nenhuma unidade cadastrada</option>';
    selEl.onchange = function () {
      Array.prototype.forEach.call(selEl.options, function (o) {
        if (o.disabled) return;
        var id = +o.value;
        if (o.selected) cfg.escSel.add(id); else cfg.escSel.delete(id);
      });
    };
  };

  window.cfgAddEscola = async function () {
    var nome = (document.getElementById('edNovaEsc').value || '').trim();
    if (!nome) return;
    erro('');
    var r = await sb().from('escolas').insert({ nome: nome }).select('id,nome').single();
    if (r.error) { erro('Erro ao cadastrar unidade: ' + r.error.message); return; }
    cfg.escolas.push(r.data); cfg.escolas.sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });
    cfg.escSel.add(r.data.id);
    document.getElementById('edNovaEsc').value = '';
    cfgRenderEscolas();
  };

  window.cfgSalvar = async function () {
    erro('');
    var email = (document.getElementById('edEmail').value || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { erro('Informe um e-mail válido.'); return; }
    var ehAdmin = document.getElementById('edAdmin').checked;
    var bypass = document.getElementById('edBypass').checked;
    var dominioOk = /@educacao\.pmrp\.sp\.gov\.br$/.test(email);
    // E-mail fora do domínio só pode ser cadastrado se for super admin
    // OU se marcar "permitir login fora do domínio".
    if (!cfg.editId && !ehAdmin && !bypass && !dominioOk) {
      erro('E-mail fora de @educacao.pmrp.sp.gov.br: marque "Permitir login fora do domínio" ou "Super admin".');
      return;
    }
    var dados = {
      email: email,
      nome: (document.getElementById('edNome').value || '').trim() || null,
      tipo: document.getElementById('edTipo').value,
      ativo: document.getElementById('edAtivo').checked,
      is_super_admin: document.getElementById('edAdmin').checked,
      bypass_dominio: bypass
    };
    try {
      var perfilId = cfg.editId;
      if (perfilId) {
        var u = await sb().from('perfis').update(dados).eq('id', perfilId);
        if (u.error) throw u.error;
      } else {
        var ins = await sb().from('perfis').insert(dados).select('id').single();
        if (ins.error) throw ins.error;
        perfilId = ins.data.id;
      }
      await sb().from('perfil_tela').delete().eq('perfil_id', perfilId);
      if (!dados.is_super_admin) {
        var telaIds = Array.prototype.slice.call(document.querySelectorAll('#edTelas input:checked')).map(function (i) { return +i.value; });
        if (telaIds.length) {
          var rowsT = telaIds.map(function (tid) { return { perfil_id: perfilId, tela_id: tid, pode_ver: true }; });
          var it = await sb().from('perfil_tela').insert(rowsT);
          if (it.error) throw it.error;
        }
      }
      await sb().from('perfil_escola').delete().eq('perfil_id', perfilId);
      var escIds = Array.from(cfg.escSel);
      if (escIds.length) {
        var rowsE = escIds.map(function (eid) { return { perfil_id: perfilId, escola_id: eid }; });
        var ie = await sb().from('perfil_escola').insert(rowsE);
        if (ie.error) throw ie.error;
      }
      await cfgCarregarPerfis();
      cfgVoltar();
    } catch (ex) { erro('Erro ao salvar: ' + (ex.message || ex)); }
  };

  window.cfgExcluir = async function () {
    if (!cfg.editId) return;
    if (!confirm('Excluir este perfil? Ele perderá o acesso a todos os sistemas.')) return;
    erro('');
    var r = await sb().from('perfis').delete().eq('id', cfg.editId);
    if (r.error) { erro('Erro ao excluir: ' + r.error.message); return; }
    await cfgCarregarPerfis();
    cfgVoltar();
  };
})();
