/* ============================================================================
   ARRAIS ADVOGADOS — Painel Comercial ⇄ CS
   Módulo complementar: CONEXÃO RESILIENTE (login, lista da equipe e API)
   ----------------------------------------------------------------------------
   O que muda com este arquivo carregado:

   - A lista "Quem é você?" nunca fica presa em "Carregando equipe…": a busca
     avisa "servidor lento" aos 10 s, tem prazo de 30 s, repete (uma vez em
     prazo esgotado, até 3 em falha de rede) e, se falhar, mostra o motivo e
     um botão "Tentar de novo". A última lista boa (só nome e setor, nunca
     PIN) fica guardada no navegador e aparece na hora nas próximas
     aberturas; a busca ao vivo apenas atualiza as opções quando mudou algo.
   - Toda chamada à API (auth, list, save) tem prazo de 30 s e tratamento
     try/catch/finally. `save` nunca é repetido (evita gravação dupla). A
     lista de clientes não é pedida em duplicidade (botão Atualizar durante a
     atualização automática de 60 s espera a chamada em curso e refaz).
   - Falhas de rede vão para o console com o prefixo [painel-cs]
     (F12 → Console), com ação, tentativa, tempo gasto e tipo do erro.
   - localStorage passa a ser opcional: dentro do painel da Vercel (iframe de
     outro site) o navegador pode negar o acesso; aí as preferências ficam só
     em memória e o login continua funcionando (antes o erro aparecia como
     "PIN incorreto").

   Instalação (index.html):
     1. depois de <script src="filtros-avancados.js"></script>, acrescentar
            <script src="conexao-resiliente.js"></script>
     2. no fim do script principal, a chamada  initLogin();  passa a ser
            document.addEventListener('DOMContentLoaded', function () { initLogin(); });
        (assim este módulo assume o login antes da primeira chamada; se o
        arquivo não carregar, o comportamento antigo continua valendo)

   Não altera nenhuma função existente do painel: apenas as substitui pelo
   nome global (api, initLogin, entrar, carregar, sair, setVista). Remover a
   tag <script> devolve o comportamento anterior.
   ========================================================================== */
(function () {
  'use strict';

  var TAG = '[painel-cs]';
  // Medido em 16/09/2026: "equipe" leva de 2 s a 8 s; o Apps Script varia muito (cold start,
  // planilha maior). Prazo folgado: abortar no navegador NÃO interrompe a execução no Google,
  // então cada repetição por prazo é mais uma leitura da planilha empilhada no servidor.
  var PRAZO_EQUIPE_MS = 30000;               // lista da equipe
  var AVISO_LENTO_EQUIPE_MS = 10000;         // a partir daqui o campo avisa "servidor lento"
  var PRAZO_API_MS = 30000;                  // auth / list / save: relê a planilha
  var TENTATIVAS = 3;                        // falha de rede / HTML no lugar de JSON / HTTP
  var TENTATIVAS_PRAZO = 2;                  // prazo esgotado: só UMA repetição
  var CACHE_EQUIPE = 'arrais-painel-equipe-v1';
  var CACHE_EQUIPE_TTL_MS = 12 * 60 * 60 * 1000;
  var AVISAR_LENTO_MS = 5000;

  if (typeof API_URL === 'undefined' || typeof window.initLogin !== 'function' || typeof equipe === 'undefined') {
    if (window.console) console.warn(TAG + ' script principal não encontrado; conexao-resiliente.js desligado.');
    return;
  }
  window.__csResiliente = true;

  function log(nivel, msg) {
    try { (console[nivel] || console.log).call(console, TAG + ' ' + msg); } catch (e) {}
  }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function erroDe(msg, tipo) { var e = new Error(msg); e.tipo = tipo; return e; }

  /* --------------------------------------------- armazenamento tolerante */
  var memoria = {};
  var avisouStorage = false;
  function lerStorage(chave) {
    try { return window.localStorage.getItem(chave); }
    catch (e) { return Object.prototype.hasOwnProperty.call(memoria, chave) ? memoria[chave] : null; }
  }
  function gravarStorage(chave, valor) {
    memoria[chave] = valor;
    try { window.localStorage.setItem(chave, valor); return true; }
    catch (e) {
      if (!avisouStorage) {
        avisouStorage = true;
        log('warn', 'localStorage indisponível (iframe de outro site com cookies de terceiros bloqueados?) — preferências só em memória nesta aba: ' + e.message);
      }
      return false;
    }
  }
  function salvarPrefs() { gravarStorage(PREFS_KEY, JSON.stringify(prefs)); }

  /* ---------------------------------------------------- chamada com prazo */
  async function chamarApi(corpo, prazoMs) {
    var controle = new AbortController();
    var cronometro = setTimeout(function () { controle.abort(); }, prazoMs);
    try {
      var res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corpo),
        signal: controle.signal
      });
      var texto = await res.text();
      if (!res.ok) throw erroDe('HTTP ' + res.status + ' do servidor', 'http');
      if (!/^\s*[\[{]/.test(texto)) throw erroDe('o Google devolveu uma página em vez de dados (instabilidade momentânea)', 'html');
      try { return JSON.parse(texto); }
      catch (e) { throw erroDe('resposta inválida do servidor', 'html'); }
    } catch (e) {
      if (e && e.name === 'AbortError') throw erroDe('sem resposta em ' + Math.round(prazoMs / 1000) + ' s', 'timeout');
      if (e && e.tipo) throw e;
      throw erroDe(e && e.message ? e.message : 'falha de rede', 'rede');
    } finally {
      clearTimeout(cronometro);
    }
  }

  // Regras de repetição:
  //  - falha de rede / HTML no lugar de JSON / HTTP: até `maxTentativas` (padrão 3);
  //  - prazo esgotado: só uma repetição, e só nas ações de leitura (equipe, auth, list);
  //  - `save`: nunca repete. O POST ao Apps Script executa o doPost e depois redireciona
  //    (302) para outro domínio; se a segunda perna falhar, a gravação pode já ter
  //    acontecido — repetir poderia duplicar o cliente. O toast "tente Atualizar" cobre.
  async function comTentativas(corpo, prazoMs, opcoes) {
    opcoes = opcoes || {};
    var maximo = opcoes.maxTentativas || TENTATIVAS;
    var acao = corpo.action;
    var ultimo;
    for (var i = 1; i <= maximo; i++) {
      var inicio = Date.now();
      try {
        var dados = await chamarApi(corpo, prazoMs);
        var gasto = Date.now() - inicio;
        if (gasto > AVISAR_LENTO_MS || i > 1) log('warn', 'ação "' + acao + '" respondeu em ' + gasto + ' ms' + (i > 1 ? ' (tentativa ' + i + ')' : ''));
        else log('debug', 'ação "' + acao + '" respondeu em ' + gasto + ' ms');
        return dados;
      } catch (e) {
        ultimo = e;
        var limite = e.tipo === 'timeout' ? (opcoes.repetirPrazo ? Math.min(maximo, TENTATIVAS_PRAZO) : 1) : maximo;
        log('error', 'ação "' + acao + '" falhou na tentativa ' + i + '/' + limite + ' após ' + (Date.now() - inicio) + ' ms: ' + e.message + ' [' + e.tipo + '] — ' + API_URL);
        var repetir = i < limite && (e.tipo === 'timeout' || e.tipo === 'rede' || e.tipo === 'html' || e.tipo === 'http');
        if (!repetir) break;
        await esperar(700 * i);
      }
    }
    throw ultimo;
  }

  window.api = async function (action, payload) {
    var corpo = Object.assign({ action: action, nome: prefs.nome, pin: prefs.pin }, payload || {});
    var opcoes = action === 'save' ? { maxTentativas: 1 } : { repetirPrazo: true };
    var dados = await comTentativas(corpo, PRAZO_API_MS, opcoes);
    if (!dados || !dados.ok) throw erroDe((dados && dados.erro) || 'Erro de comunicação', 'api');
    return dados;
  };

  /* ------------------------------------------------------- lista da equipe */
  var buscandoEquipe = false;
  var autoLoginFeito = false;

  function selectEquipe() { return document.getElementById('loginNome'); }

  // Assinatura do que está exibido no select: a lista ao vivo costuma ser igual ao cache,
  // e reescrever as <option> à toa fecharia o dropdown se a pessoa o estiver usando.
  var assinaturaExibida = '';
  function assinaturaDe(lista) { return JSON.stringify(lista.map(function (p) { return [p.nome, p.setor]; })); }
  function mostrarAvisoNoSelect(texto) {
    var sel = selectEquipe();
    if (!sel) return;
    assinaturaExibida = '';
    sel.innerHTML = '<option value="">' + esc(texto) + '</option>';
  }

  function preencherEquipe(lista) {
    var sel = selectEquipe();
    if (!sel) return;
    var assinatura = assinaturaDe(lista);
    if (assinatura === assinaturaExibida) return;               // nada mudou: não mexe no campo
    if (document.activeElement === sel) {                        // campo em uso: aplica quando a pessoa sair dele
      sel.addEventListener('blur', function () { preencherEquipe(lista); }, { once: true });
      return;
    }
    assinaturaExibida = assinatura;
    var atual = sel.value;
    sel.innerHTML = '<option value="">Selecione seu nome</option>' +
      lista.map(function (p) { return '<option value="' + esc(p.nome) + '">' + esc(p.nome) + ' — ' + esc(p.setor) + '</option>'; }).join('');
    if (atual) sel.value = atual;
  }

  function lerCacheEquipe() {
    try {
      var bruto = lerStorage(CACHE_EQUIPE);
      if (!bruto) return null;
      var c = JSON.parse(bruto);
      if (!c || !Array.isArray(c.equipe) || !c.equipe.length) return null;
      if (Date.now() - (c.em || 0) > CACHE_EQUIPE_TTL_MS) return null;
      return c.equipe;
    } catch (e) { return null; }
  }
  function gravarCacheEquipe(lista) {
    var enxuta = lista.map(function (p) { return { nome: p.nome, setor: p.setor }; });
    gravarStorage(CACHE_EQUIPE, JSON.stringify({ em: Date.now(), equipe: enxuta }));
  }

  function limparErroLogin() {
    var el = document.getElementById('loginErro');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }

  function botaoTentar(mostrar) {
    var b = document.getElementById('btnEquipeTentar');
    if (!b) {
      b = document.createElement('button');
      b.id = 'btnEquipeTentar';
      b.type = 'button';
      b.className = 'btn btn-ghost';
      b.style.cssText = 'width:100%;margin-bottom:10px;display:none';
      b.textContent = '↻ Tentar carregar a equipe de novo';
      b.onclick = function () { window.initLogin(); };
      var erro = document.getElementById('loginErro');
      if (erro && erro.parentNode) erro.parentNode.insertBefore(b, erro.nextSibling);
    }
    b.style.display = mostrar ? 'block' : 'none';
  }

  function mostrarFalhaEquipe(e, tinhaCache) {
    if (!tinhaCache) mostrarAvisoNoSelect('Equipe não carregou');
    loginErro(tinhaCache
      ? 'O servidor da Recepção não respondeu (' + e.message + '). A lista acima veio da memória deste navegador; o login pode falhar até o servidor voltar.'
      : 'Não foi possível carregar a equipe: ' + e.message + '. Confira a internet; se persistir, o servidor da Recepção (Apps Script) pode estar fora do ar.');
    botaoTentar(true);
  }

  function tentarLoginAutomatico() {
    if (autoLoginFeito || !prefs.nome || !prefs.pin) return;
    if (!equipe.some(function (p) { return p.nome === prefs.nome; })) return;
    autoLoginFeito = true;
    var sel = selectEquipe();
    if (sel) sel.value = prefs.nome;
    window.entrar(true);
  }

  window.initLogin = async function () {
    if (buscandoEquipe) return;
    buscandoEquipe = true;
    var sel = selectEquipe();
    limparErroLogin();
    botaoTentar(false);
    var doCache = lerCacheEquipe();
    var avisoLento = null;
    if (doCache) {
      equipe = doCache;
      preencherEquipe(equipe);
      log('debug', 'equipe exibida do cache local (' + doCache.length + ' pessoas); atualizando ao vivo');
      tentarLoginAutomatico();
    } else {
      mostrarAvisoNoSelect('Carregando equipe…');
      // Servidor lento não é servidor caído: avisa e continua esperando, sem abortar.
      avisoLento = setTimeout(function () {
        if (sel && sel.options.length === 1 && /^Carregando/.test(sel.options[0].textContent)) {
          mostrarAvisoNoSelect('Carregando equipe… (servidor lento, aguarde)');
          log('warn', 'ação "equipe" já passou de ' + (AVISO_LENTO_EQUIPE_MS / 1000) + ' s; seguindo até ' + (PRAZO_EQUIPE_MS / 1000) + ' s');
        }
      }, AVISO_LENTO_EQUIPE_MS);
    }
    try {
      var dados = await comTentativas({ action: 'equipe' }, PRAZO_EQUIPE_MS, { repetirPrazo: true });
      var lista = dados && Array.isArray(dados.equipe) ? dados.equipe : [];
      if (!lista.length) throw erroDe((dados && dados.erro) || 'o servidor devolveu a equipe vazia', 'api');
      equipe = lista;
      preencherEquipe(equipe);
      gravarCacheEquipe(equipe);
      // Se o login automático pelo cache já abriu o app, os selects de responsável
      // (Novo cliente, filtro) foram montados com a lista antiga: refaz com a lista ao vivo.
      var app = document.getElementById('app');
      if (app && app.style.display === 'block') montarSelects();
      tentarLoginAutomatico();
    } catch (e) {
      log('error', 'lista da equipe indisponível: ' + e.message + ' [' + e.tipo + ']');
      mostrarFalhaEquipe(e, !!doCache);
    } finally {
      clearTimeout(avisoLento);
      buscandoEquipe = false;
      // rede de segurança: o campo nunca fica preso em "Carregando equipe…"
      if (sel && sel.options.length === 1 && /^Carregando/.test(sel.options[0].textContent)) {
        mostrarAvisoNoSelect('Equipe não carregou');
        botaoTentar(true);
      }
    }
  };

  /* ----------------------------------------------------------------- login */
  var intervaloAtualizacao = null;
  var entrando = false;

  window.entrar = async function (auto) {
    // Uma autenticação por vez: o Enter no campo do PIN não passa pelo botão desabilitado,
    // e uma 2ª chamada em voo trocaria prefs.nome/pin por baixo da 1ª.
    if (entrando) return;
    var sel = selectEquipe();
    var nome = sel ? sel.value : '';
    var campoPin = document.getElementById('loginPin');
    var pin = auto ? prefs.pin : (campoPin ? campoPin.value.trim() : '');
    if (!nome || !pin) { if (!auto) loginErro('Selecione o nome e digite o PIN.'); return; }
    entrando = true;
    var botao = document.querySelector('#loginOv .btn-primary');
    if (botao) { botao.disabled = true; botao.textContent = auto ? 'Entrando…' : 'Conferindo PIN…'; }
    if (sel) sel.disabled = true;
    if (campoPin) campoPin.disabled = true;
    limparErroLogin();
    prefs.nome = nome; prefs.pin = pin;
    try {
      await window.api('auth');
      salvarPrefs();
      document.getElementById('loginOv').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      if (!prefs.vista) {
        var s = userSetor();
        prefs.vista = s === 'Comercial' ? 'Comercial' : s === 'CS' ? 'CS' : 'Completa';
        salvarPrefs();
      }
      montarSelects();
      document.getElementById('whoAmI').innerHTML = '<b>' + esc(nome) + '</b> · ' + esc(userSetor());
      await window.carregar(true);
      if (!intervaloAtualizacao) {
        intervaloAtualizacao = setInterval(function () {
          if (!document.querySelector('.overlay.open') && pendentes === 0) window.carregar(false);
        }, 60000);
      }
    } catch (e) {
      prefs.pin = '';
      var msg = e && e.message ? e.message : 'falha de rede';
      if (e && e.tipo === 'api') {
        if (!auto) loginErro(/pin/i.test(msg) ? 'PIN incorreto para ' + nome + '.' : 'Acesso negado para ' + nome + ': ' + msg);
      } else {
        loginErro('O servidor da Recepção não respondeu (' + msg + '). Tente de novo em instantes.');
      }
      log('error', 'login de "' + nome + '" falhou: ' + msg + ' [' + (e && e.tipo) + ']');
      document.getElementById('loginOv').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
    } finally {
      entrando = false;
      if (botao) { botao.disabled = false; botao.textContent = 'Entrar'; }
      if (sel) sel.disabled = false;
      if (campoPin) campoPin.disabled = false;
    }
  };

  window.sair = function () { prefs.pin = ''; salvarPrefs(); location.reload(); };
  window.setVista = function (v) { prefs.vista = v; salvarPrefs(); render(); };

  /* ---------------------------------------------------- lista de clientes */
  var carregando = false;
  var refazerDepois = false;
  window.carregar = async function (mostrar) {
    if (carregando) {
      // A atualização automática (60 s) já está buscando: em vez de uma 2ª chamada em
      // paralelo, o clique em "Atualizar" mostra o indicador e refaz assim que ela terminar.
      if (mostrar) { refazerDepois = true; sync('Carregando…'); }
      return;
    }
    if (pendentes > 0) {
      // Há gravação em andamento: a lista do servidor ainda não tem a edição e a
      // substituiria na tela; a atualização automática refaz quando não houver pendência.
      if (mostrar) toast('Aguarde a gravação terminar antes de atualizar.');
      return;
    }
    carregando = true;
    var dados = null;
    try {
      if (mostrar) sync('Carregando…');
      dados = await window.api('list');
    } catch (e) {
      sync('Sem conexão');
      toast('Falha ao carregar: ' + e.message);
      log('error', 'lista de clientes indisponível: ' + e.message + ' [' + e.tipo + ']');
    } finally {
      carregando = false;
    }
    if (dados) {
      try {
        state.clients = dados.clients || [];
        montarFiltrosDeDados();
        render();
        sync('Atualizado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        // A lista chegou; o problema é na tela (p.ex. linha da planilha sem `kit`/`ob`).
        sync('Erro');
        toast('Falha ao exibir a lista: ' + e.message);
        log('error', 'erro ao renderizar a lista de clientes: ' + e.message);
        try { console.error(e); } catch (x) {}
      }
    }
    if (refazerDepois) { refazerDepois = false; window.carregar(true); }
  };

  /* --------------------------------------------------------------- vigia */
  // Se, por qualquer motivo, a lista continuar em "Carregando equipe…" depois do
  // tempo máximo das tentativas (p.ex. index.html sem a chamada adiada), oferece
  // a nova tentativa em vez de deixar a tela presa.
  setTimeout(function () {
    var sel = selectEquipe();
    if (sel && !buscandoEquipe && sel.options.length === 1 && /^Carregando/.test(sel.options[0].textContent)) {
      log('error', 'vigia: a equipe não carregou e nenhuma busca está em andamento; oferecendo nova tentativa');
      mostrarAvisoNoSelect('Equipe não carregou');
      loginErro('A lista da equipe não chegou. Clique em "Tentar carregar a equipe de novo".');
      botaoTentar(true);
    }
  }, PRAZO_EQUIPE_MS * TENTATIVAS_PRAZO + 10000);

  log('debug', 'conexao-resiliente.js ativo (prazo equipe ' + PRAZO_EQUIPE_MS + ' ms, API ' + PRAZO_API_MS + ' ms; ' + TENTATIVAS + ' tentativas em falha de rede, ' + TENTATIVAS_PRAZO + ' em prazo esgotado)');
})();
