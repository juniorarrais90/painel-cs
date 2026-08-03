/* ============================================================================
   ARRAIS ADVOGADOS — Painel Comercial ⇄ CS
   Módulo complementar: FILTRO POR QUEM CADASTROU + FILTRO DE PERÍODO
   ----------------------------------------------------------------------------
   Instalação: salvar este arquivo como  filtros-avancados.js  na mesma pasta
   do index.html e acrescentar, ANTES de </body> (depois do <script> principal):

       <script src="filtros-avancados.js"></script>

   Não altera nenhuma função existente do painel: apenas as "envelopa".
   Se este arquivo for removido, o painel volta ao comportamento anterior.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- estilo */
  var st = document.createElement('style');
  st.textContent =
    '.rank{display:flex;gap:8px;padding:0 22px 12px;flex-wrap:wrap;align-items:center}' +
    '.rank .rk-tt{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6B7280;font-weight:700;margin-right:2px}' +
    '.rank .rk{background:#fff;border:1px solid #E2E7F0;border-radius:20px;padding:5px 13px;font-size:12.5px;cursor:pointer;user-select:none}' +
    '.rank .rk b{color:#1B2A4A;font-size:14px}' +
    '.rank .rk:hover{box-shadow:0 2px 8px rgba(27,42,74,.14)}' +
    '.rank .rk.sel{background:#1B2A4A;color:#fff;border-color:#1B2A4A}' +
    '.rank .rk.sel b{color:#C9A24B}' +
    '.aviso-per{margin:0 22px 12px;background:#FDF3E3;border:1px solid #EBD9B4;color:#7A4E06;' +
      'border-radius:8px;padding:8px 12px;font-size:12.5px;display:none;gap:10px;align-items:center;flex-wrap:wrap}' +
    '.aviso-per button{border:0;background:#B4690E;color:#fff;border-radius:6px;padding:4px 10px;' +
      'font-size:11.5px;font-weight:600;cursor:pointer}' +
    '.stat.per{border-color:#C9A24B;background:#FFFDF7}' +
    '.stat.per b{color:#8A6A18}' +
    'input.filter[type=date]{display:none}';
  document.head.appendChild(st);

  /* ------------------------------------------------------------- controles */
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  var selCri = el('<select class="filter" id="fCriador" title="Quem cadastrou o cliente no painel">' +
                  '<option value="">Todos os cadastradores</option></select>');
  var selPer = el('<select class="filter" id="fPeriodo" title="Período de referência">' +
                  '<option value="">Todo o período</option>' +
                  '<option value="mes">Mês atual</option>' +
                  '<option value="ant">Mês passado</option>' +
                  '<option value="sem">Esta semana</option>' +
                  '<option value="d7">Últimos 7 dias</option>' +
                  '<option value="d30">Últimos 30 dias</option>' +
                  '<option value="livre">Data livre…</option></select>');
  var inDe  = el('<input type="date" class="filter" id="fDe" title="Data inicial">');
  var inAte = el('<input type="date" class="filter" id="fAte" title="Data final">');
  var btnLp = el('<button class="btn btn-ghost" id="btnLimparF" style="display:none">Limpar filtros</button>');

  var ancora = document.getElementById('fPend') || document.querySelector('.toolbar select.filter');
  if (!ancora) return;                       // painel fora do formato esperado
  [selCri, selPer, inDe, inAte, btnLp].forEach(function (n) {
    ancora.parentNode.insertBefore(n, ancora.nextSibling);
    ancora = n;
  });

  var elAviso = el('<div class="aviso-per" id="avisoPer"></div>');
  var elRank  = el('<div class="rank" id="ranking"></div>');
  var board = document.getElementById('board');
  board.parentNode.insertBefore(elAviso, board);
  board.parentNode.insertBefore(elRank, board);

  /* ------------------------------------------------------- datas / período */
  function ini(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime(); }
  function fim(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime(); }

  function periodo() {
    var p = selPer.value, h = new Date(), i;
    if (p === 'mes')  return { de: new Date(h.getFullYear(), h.getMonth(), 1).getTime(),
                               ate: fim(new Date(h.getFullYear(), h.getMonth() + 1, 0)), label: 'no mês atual' };
    if (p === 'ant')  return { de: new Date(h.getFullYear(), h.getMonth() - 1, 1).getTime(),
                               ate: fim(new Date(h.getFullYear(), h.getMonth(), 0)), label: 'no mês passado' };
    if (p === 'sem')  { i = new Date(h); i.setDate(h.getDate() - h.getDay());
                        return { de: ini(i), ate: fim(h), label: 'nesta semana' }; }
    if (p === 'd7')   { i = new Date(h); i.setDate(h.getDate() - 6);
                        return { de: ini(i), ate: fim(h), label: 'nos últimos 7 dias' }; }
    if (p === 'd30')  { i = new Date(h); i.setDate(h.getDate() - 29);
                        return { de: ini(i), ate: fim(h), label: 'nos últimos 30 dias' }; }
    if (p === 'livre') {
      if (!inDe.value && !inAte.value) return null;
      var br = function (v) { return v.split('-').reverse().join('/'); };
      return { de:  inDe.value  ? new Date(inDe.value  + 'T00:00:00').getTime() : 0,
               ate: inAte.value ? new Date(inAte.value + 'T23:59:59').getTime() : Date.now(),
               label: inDe.value && inAte.value ? ('no período de ' + br(inDe.value) + ' a ' + br(inAte.value))
                    : inDe.value ? ('a partir de ' + br(inDe.value))
                    : ('até ' + br(inAte.value)) };
    }
    return null;
  }

  /* ------------------------------------------- quem cadastrou / conclusão */
  /* Os dois dados são lidos dos campos novos quando existirem e, para os
     clientes antigos, reconstruídos a partir do histórico de comentários do
     sistema — que o painel já grava desde sempre.                            */

  function sys(c) {
    return (c && c.comentarios ? c.comentarios : []).filter(function (m) { return m && m.sys; });
  }

  function criadorDe(c) {
    if (!c) return '';
    if (c.criadoPor) return c.criadoPor;
    var l = sys(c), r, i;
    for (i = 0; i < l.length; i++) {
      r = String(l[i].texto || '').match(/cadastrad[oa]\s+por\s+(.+?)(?:\s*\([^)]*\))?\s*(?:e enviad|\.|$)/i);
      if (r && r[1]) return r[1].trim();
    }
    for (i = 0; i < (c.comentarios || []).length; i++) {
      if (!c.comentarios[i].sys && c.comentarios[i].autor) return c.comentarios[i].autor;
    }
    return c.respCom || '';
  }

  function concluidoEmDe(c) {
    if (!c) return null;
    if (c.concluidoEm) return c.concluidoEm;
    if (c.stage !== 'Concluído') return null;
    var l = sys(c), achado = null;
    for (var i = 0; i < l.length; i++) {
      if (/movid[oa][^.]*Conclu/i.test(String(l[i].texto || ''))) achado = l[i].em;
    }
    return achado || c.movidoEm || c.criadoEm || null;
  }

  /* Data usada pelo filtro de período:
     - cliente concluído  → data em que foi concluído;
     - demais etapas      → data de entrada.                                  */
  function dataRef(c) { return concluidoEmDe(c) || c.criadoEm; }

  window.criadorDe = criadorDe;
  window.concluidoEmDe = concluidoEmDe;

  /* ------------------------------------------------------------- filtragem */
  function passa(c, cri, per) {
    if (cri && criadorDe(c) !== cri) return false;
    if (per) { var d = dataRef(c); if (!d || d < per.de || d > per.ate) return false; }
    return true;
  }

  /* ---------------------------------------------------- render (envelopado) */
  var _render = window.render;
  var reentrante = false;

  window.render = function () {
    if (reentrante || typeof state === 'undefined') return _render.apply(this, arguments);

    var cri = selCri.value, per = periodo();
    var todos = state.clients || [];
    var base = (!cri && !per) ? todos : todos.filter(function (c) { return passa(c, cri, per); });

    reentrante = true;
    state.clients = base;
    try { _render.apply(this, arguments); }
    finally { state.clients = todos; reentrante = false; }

    posRender(base, todos, cri, per);
  };

  var rankNomes = [];

  function posRender(base, todos, cri, per) {
    var esc0 = (typeof esc === 'function') ? esc : function (s) { return String(s == null ? '' : s); };

    /* --- select de cadastradores ------------------------------------- */
    var nomes = {};
    todos.forEach(function (c) { var n = criadorDe(c); if (n) nomes[n] = 1; });
    if (typeof equipe !== 'undefined' && equipe && equipe.length) {
      equipe.forEach(function (p) { if (p && p.nome) nomes[p.nome] = 1; });
    }
    var lista = Object.keys(nomes).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    var html = '<option value="">Todos os cadastradores</option>' +
      lista.map(function (n) {
        return '<option value="' + esc0(n) + '"' + (n === cri ? ' selected' : '') + '>' + esc0(n) + '</option>';
      }).join('');
    if (selCri.innerHTML !== html) { selCri.innerHTML = html; selCri.value = cri; }

    /* --- indicadores do período -------------------------------------- */
    var stats = document.getElementById('stats');
    if ((per || cri) && stats) {
      var okCri = function (c) { return !cri || criadorDe(c) === cri; };
      var okPer = function (t) { return !per || (t && t >= per.de && t <= per.ate); };
      var qConc = todos.filter(function (c) {
        return okCri(c) && c.stage === 'Concluído' && okPer(concluidoEmDe(c)); }).length;
      var qNovo = todos.filter(function (c) { return okCri(c) && okPer(c.criadoEm); }).length;
      var qCtr  = todos.filter(function (c) {
        return okCri(c) && c.contratoAssinadoEm &&
               okPer(new Date(c.contratoAssinadoEm + 'T12:00:00').getTime()); }).length;
      var suf = per ? per.label : '(todo o período)';
      var card = function (n, l) {
        return '<div class="stat per"><b>' + n + '</b><span>' + esc0(l) + '</span></div>'; };
      stats.insertAdjacentHTML('beforeend',
        card(qConc, 'Benefícios fechados ' + suf) +
        card(qNovo, 'Novos clientes ' + suf) +
        card(qCtr,  'Contratos assinados ' + suf));
    }

    /* --- ranking por quem cadastrou ---------------------------------- */
    var conc = base.filter(function (c) { return c.stage === 'Concluído'; });
    var mapa = {};
    conc.forEach(function (c) { var n = criadorDe(c) || '— sem registro —'; mapa[n] = (mapa[n] || 0) + 1; });
    var rk = Object.keys(mapa).map(function (n) { return [n, mapa[n]]; })
      .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'); });
    rankNomes = rk.map(function (x) { return x[0]; });

    elRank.innerHTML = rk.length
      ? '<span class="rk-tt">Benefícios fechados ' + esc0(per ? per.label : '(todo o período)') +
        ' — por quem cadastrou</span>' +
        rk.map(function (x, i) {
          return '<span class="rk' + (cri === x[0] ? ' sel' : '') + '" onclick="__rkSel(' + i + ')">' +
                 '<b>' + x[1] + '</b> · ' + esc0(x[0]) + '</span>';
        }).join('')
      : '';

    /* --- aviso de filtro ativo --------------------------------------- */
    var ativo = !!(per || cri);
    btnLp.style.display = ativo ? '' : 'none';
    elAviso.style.display = ativo ? 'flex' : 'none';
    if (ativo) {
      var partes = [];
      if (cri) partes.push('cadastrados por <b>' + esc0(cri) + '</b>');
      if (per) partes.push('<b>' + esc0(per.label.replace(/^n[oa]s?\s+/, '')) + '</b>');
      elAviso.innerHTML = 'Filtro ativo — ' + partes.join(' · ') +
        '. Concluídos contam pela data de conclusão; as demais etapas, pela data de entrada. ' +
        (todos.length - base.length) + ' cliente(s) fora do filtro. ' +
        '<button onclick="__limparF()">Ver tudo</button>';
    }

    decorarTabela();
  }

  /* ------------------------------------------------- colunas extras na tabela */
  function decorarTabela() {
    var tab = document.querySelector('#tableWrap table');
    if (!tab) return;
    var cab = tab.querySelector('thead tr');
    if (!cab || cab.dataset.ext) return;
    cab.dataset.ext = '1';
    ['Cadastrado por', 'Concluído em'].forEach(function (t) {
      var th = document.createElement('th'); th.textContent = t; cab.appendChild(th);
    });
    Array.prototype.forEach.call(tab.querySelectorAll('tbody tr'), function (tr) {
      var m = (tr.getAttribute('onclick') || '').match(/'([^']+)'/);
      var c = m ? (state.clients || []).find(function (x) { return x.id === m[1]; }) : null;
      var t1 = document.createElement('td');
      t1.textContent = c ? (criadorDe(c) || '—') : '—';
      var t2 = document.createElement('td');
      var d = c ? concluidoEmDe(c) : null;
      t2.textContent = d ? new Date(d).toLocaleDateString('pt-BR') : '—';
      tr.appendChild(t1); tr.appendChild(t2);
    });
  }

  /* --------------------------------- gravação dos campos novos (a partir de agora) */
  if (typeof window.moveTo === 'function') {
    var _moveTo = window.moveTo;
    window.moveTo = function (id, stage) {
      var r = _moveTo.apply(this, arguments);
      var c = (state.clients || []).find(function (x) { return x.id === id; });
      if (c) {
        if (c.stage === 'Concluído' && !c.concluidoEm) {
          c.concluidoEm = c.movidoEm || Date.now();
          if (typeof persist === 'function') persist(c);
        } else if (c.stage !== 'Concluído' && c.concluidoEm) {
          c.concluidoEm = null;
          if (typeof persist === 'function') persist(c);
        }
      }
      return r;
    };
  }

  if (typeof window.addClient === 'function') {
    var _addClient = window.addClient;
    window.addClient = function () {
      var antes = (state.clients || []).map(function (c) { return c.id; });
      var r = _addClient.apply(this, arguments);
      var novo = (state.clients || []).find(function (c) { return antes.indexOf(c.id) < 0; });
      if (novo && !novo.criadoPor) {
        novo.criadoPor = (typeof prefs !== 'undefined' && prefs.nome) ? prefs.nome : '';
        if (typeof persist === 'function') persist(novo);
      }
      return r;
    };
  }

  /* ------------------------------------------------------------- interação */
  function atualiza() { if (typeof window.render === 'function') window.render(); }

  selCri.onchange = atualiza;
  inDe.onchange = atualiza;
  inAte.onchange = atualiza;
  selPer.onchange = function () {
    var livre = selPer.value === 'livre';
    inDe.style.display = livre ? 'inline-block' : 'none';
    inAte.style.display = livre ? 'inline-block' : 'none';
    if (livre && !inDe.value && !inAte.value) { inDe.focus(); return; }
    atualiza();
  };
  btnLp.onclick = function () { window.__limparF(); };

  window.__rkSel = function (i) {
    var n = rankNomes[i];
    if (n == null) return;
    selCri.value = (selCri.value === n) ? '' : n;
    atualiza();
  };

  window.__limparF = function () {
    selCri.value = ''; selPer.value = ''; inDe.value = ''; inAte.value = '';
    inDe.style.display = 'none'; inAte.style.display = 'none';
    atualiza();
  };
})();
