/**
 * ARRAIS ADVOGADOS — Painel Comercial ⇄ CS
 * Recebedor Google Apps Script (banco de dados = esta planilha)
 *
 * Projeto: "Painel Comercial-CS" (conta do escritório, arraisadvmg@gmail.com)
 * https://script.google.com/u/2/home/projects/1sWOrVcF9FFcISRABVryqLTDCkrJCgnq1CUhTyp_lwhpRWI9iSdpFC8b3/edit
 *
 * INSTALAÇÃO (resumo — detalhes no INSTALACAO.md):
 *   1. Crie uma planilha no Google Sheets e abra Extensões → Apps Script.
 *   2. Cole este arquivo inteiro no editor (substituindo o conteúdo).
 *   3. Execute a função `configurar` uma vez (menu Executar) e autorize.
 *   4. Na aba "Equipe" da planilha, defina o PIN de cada pessoa.
 *   5. Implantar → Nova implantação → App da Web:
 *        - Executar como: EU (sua conta)
 *        - Quem pode acessar: QUALQUER PESSOA
 *      Copie a URL gerada e cole no index.html (constante API_URL).
 *
 * CONSULTA DE CPF (23/09/2026):
 *   - Ação `consultarCpf`: confere o CPF na aba Clientes (duplicidade interna) e
 *     na ADVBOX (GET /customers?identification=), devolvendo o nome para o
 *     auto-preenchimento. A ADVBOX só é consultada se a Propriedade do script
 *     ADVBOX_API_TOKEN estiver definida (Configurações do projeto → Propriedades
 *     do script). Sem ela, a conferência fica só na planilha.
 *   - Ação `save`: cadastro NOVO com CPF que já existe na planilha só é aceito
 *     com `client.novoProcesso === true` (confirmação do modal na tela).
 */

const ABA_CLIENTES  = 'Clientes';
const ABA_EQUIPE    = 'Equipe';
const ABA_HISTORICO = 'Historico';
const ADVBOX_URL    = 'https://app.advbox.com.br/api/v1';

/* ============ CONFIGURAÇÃO INICIAL (executar 1x) ============ */
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let cl = ss.getSheetByName(ABA_CLIENTES);
  if (!cl) {
    cl = ss.insertSheet(ABA_CLIENTES);
    cl.appendRow(['id','nome','etapa','contratoAssinadoEm','respCom','respCS','tipo','via','origem','atualizadoEm','atualizadoPor','json']);
    cl.setFrozenRows(1);
    cl.getRange('1:1').setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
  }

  let eq = ss.getSheetByName(ABA_EQUIPE);
  if (!eq) {
    eq = ss.insertSheet(ABA_EQUIPE);
    eq.appendRow(['nome','setor','pin']);
    eq.setFrozenRows(1);
    eq.getRange('1:1').setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
    [
      ['Isabela','Comercial','TROCAR'],
      ['Ana Paula','Comercial','TROCAR'],
      ['Geovana','CS','TROCAR'],
      ['Julya','CS','TROCAR'],
      ['Cleverson','Financeiro','TROCAR'],
      ['Júnior','Gestão','TROCAR']
    ].forEach(r => eq.appendRow(r));
  }

  let hi = ss.getSheetByName(ABA_HISTORICO);
  if (!hi) {
    hi = ss.insertSheet(ABA_HISTORICO);
    hi.appendRow(['quando','quem','setor','acao','cliente','detalhe']);
    hi.setFrozenRows(1);
    hi.getRange('1:1').setFontWeight('bold').setBackground('#1B2A4A').setFontColor('#FFFFFF');
  }

  // Remove a aba padrão vazia, se existir
  const padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 3) ss.deleteSheet(padrao);

  SpreadsheetApp.getUi
    ? SpreadsheetApp.getActiveSpreadsheet().toast('Abas criadas. Defina os PINs na aba Equipe.', 'Configuração concluída')
    : Logger.log('Configuração concluída. Defina os PINs na aba Equipe.');
}

/* ============ ROTEADOR ============ */
function doGet() {
  return resposta({ ok: true, servico: 'Painel Comercial-CS Arrais Advogados', hora: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return resposta({ ok:false, erro:'Requisição inválida.' }); }

  try {
    switch (req.action) {
      case 'equipe': {
        // Lista pública de nomes/setores (sem PINs) para a tela de login
        const eqp = getEquipe().map(function(p){ return { nome: p.nome, setor: p.setor }; });
        return resposta({ ok:true, equipe: eqp });
      }
      case 'auth': {
        const u = autenticar(req.nome, req.pin);
        return resposta({ ok:true, setor: u.setor });
      }
      case 'list': {
        autenticar(req.nome, req.pin);
        return resposta({ ok:true, clients: listarClientes() });
      }
      case 'consultarCpf': {
        // Controller da conferência de CPF: planilha + ADVBOX (auto-preenchimento do nome)
        autenticar(req.nome, req.pin);
        return resposta(Object.assign({ ok:true }, consultarCpf(req.cpf)));
      }
      case 'save': {
        const u = autenticar(req.nome, req.pin);
        salvarCliente(req.client, u);
        return resposta({ ok:true });
      }
      case 'delete': {
        const u = autenticar(req.nome, req.pin);
        excluirCliente(req.id, u);
        return resposta({ ok:true });
      }
      default:
        return resposta({ ok:false, erro:'Ação desconhecida.' });
    }
  } catch (err) {
    return resposta({ ok:false, erro: String(err.message || err) });
  }
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ EQUIPE / AUTENTICAÇÃO ============ */
function getEquipe() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_EQUIPE);
  if (!sh) throw new Error('Aba Equipe não encontrada — execute configurar().');
  const vals = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0]) out.push({ nome: String(vals[i][0]).trim(), setor: String(vals[i][1]).trim(), pin: String(vals[i][2]).trim() });
  }
  return out;
}

function autenticar(nome, pin) {
  if (!nome || !pin) throw new Error('Identificação incompleta.');
  const u = getEquipe().find(function(p){ return p.nome === String(nome).trim(); });
  if (!u || u.pin === '' || u.pin === 'TROCAR' || u.pin !== String(pin).trim()) {
    throw new Error('Nome ou PIN incorretos.');
  }
  return u;
}

/* ============ CPF ============ */
function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }

function formatarCpf(v) {
  const d = soDigitos(v);
  if (d.length !== 11) return String(v || '');
  return d.slice(0,3) + '.' + d.slice(3,6) + '.' + d.slice(6,9) + '-' + d.slice(9);
}

/** Validação pelos dois dígitos verificadores (mesma regra da Receita). */
function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  function dv(fatia, peso) {
    let soma = 0;
    for (let i = 0; i < fatia.length; i++) soma += Number(fatia[i]) * (peso - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  }
  return dv(d.slice(0,9), 10) === Number(d[9]) && dv(d.slice(0,10), 11) === Number(d[10]);
}

/** Fichas da planilha com esse CPF (a mais recente primeiro). */
function fichasComCpf(cpf, ignorarId) {
  const d = soDigitos(cpf);
  if (d.length !== 11) return [];
  return listarClientes()
    .filter(function(c){ return soDigitos(c.cpf) === d && String(c.id) !== String(ignorarId || ''); })
    .sort(function(a, b){ return (b.criadoEm || 0) - (a.criadoEm || 0); })
    .map(function(c){
      return { id: c.id, nome: c.nome, stage: c.stage || '', tipo: c.tipo || '', criadoEm: c.criadoEm || null, respCS: c.respCS || '' };
    });
}

/**
 * Consulta a ADVBOX por CPF (GET /customers?identification= aceita com ou sem
 * pontuação). Devolve o contato com os processos, null se não existe, ou
 * { indisponivel: motivo } se não deu para consultar (sem token, falha de rede,
 * 429). Nunca lança: a conferência na planilha tem que continuar funcionando.
 */
function advboxPorCpf(cpf) {
  const token = PropertiesService.getScriptProperties().getProperty('ADVBOX_API_TOKEN');
  if (!token) return { indisponivel: 'ADVBOX_API_TOKEN não configurado nas Propriedades do script.' };
  try {
    const r = UrlFetchApp.fetch(ADVBOX_URL + '/customers?identification=' + soDigitos(cpf) + '&limit=5', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    const status = r.getResponseCode();
    if (status === 429) return { indisponivel: 'ADVBOX com limite de requisições (429). Tente de novo em 1 minuto.' };
    if (status !== 200) return { indisponivel: 'ADVBOX respondeu ' + status + '.' };
    const j = JSON.parse(r.getContentText());
    const achado = (j.data || []).filter(function(c){ return soDigitos(c.identification) === soDigitos(cpf); })[0];
    if (!achado) return null;
    return {
      id: achado.id,
      nome: achado.name || '',
      email: achado.email || '',
      celular: achado.cellphone || '',
      cidade: achado.city || '',
      uf: achado.state || '',
      processos: (achado.lawsuits || []).map(function(p){
        return { id: p.lawsuit_id, numero: p.process_number || p.protocol_number || ('Processo ' + p.lawsuit_id) };
      })
    };
  } catch (e) {
    return { indisponivel: 'Falha ao consultar a ADVBOX: ' + String(e.message || e) };
  }
}

/**
 * Resultado da conferência:
 *   { cpf, valido, existente, nome, planilha: [fichas], advbox: contato|null, aviso }
 * `existente` = já está na planilha OU já é contato da ADVBOX.
 * `nome` = nome para auto-preenchimento (ADVBOX tem prioridade; senão, a ficha).
 */
function consultarCpf(cpf) {
  const d = soDigitos(cpf);
  const out = { cpf: d, valido: cpfValido(d), existente: false, nome: '', planilha: [], advbox: null, aviso: '' };
  if (!out.valido) return out;

  out.planilha = fichasComCpf(d);
  const adv = advboxPorCpf(d);
  if (adv && adv.indisponivel) {
    out.aviso = adv.indisponivel;
  } else {
    out.advbox = adv;
  }
  out.existente = out.planilha.length > 0 || Boolean(out.advbox);
  out.nome = (out.advbox && out.advbox.nome) || (out.planilha[0] && out.planilha[0].nome) || '';
  return out;
}

/* ============ CLIENTES ============ */
function abaClientes() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_CLIENTES);
  if (!sh) throw new Error('Aba Clientes não encontrada — execute configurar().');
  return sh;
}

function listarClientes() {
  const sh = abaClientes();
  const vals = sh.getDataRange().getValues();
  const out = [];
  const colJson = 11; // coluna L (índice 11, base 0)
  for (let i = 1; i < vals.length; i++) {
    const raw = vals[i][colJson];
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch (e) { /* linha corrompida: ignora */ }
  }
  return out;
}

function linhaDoCliente(sh, id) {
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function salvarCliente(c, u) {
  if (!c || !c.id || !c.nome) throw new Error('Dados do cliente incompletos.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = abaClientes();
    const r = linhaDoCliente(sh, c.id);

    // Trava de duplicidade: ficha NOVA com CPF que já existe só entra confirmada
    // como novo processo. A tela reconsulta e mostra o modal; aqui é a barreira
    // final, caso a confirmação não tenha vindo (tela antiga, envio manual etc.).
    if (r === -1 && soDigitos(c.cpf).length === 11) {
      const repetidas = fichasComCpf(c.cpf, c.id);
      if (repetidas.length > 0 && c.novoProcesso !== true) {
        throw new Error('Cliente já cadastrado (' + repetidas[0].nome + ', ' + (repetidas[0].stage || 'sem etapa') +
          '). Confirme que se trata de novo processo para continuar.');
      }
      if (c.cpf) c.cpf = formatarCpf(c.cpf);
    }

    const linha = [
      c.id, c.nome, c.stage || '', c.contratoAssinadoEm || '',
      c.respCom || '', c.respCS || '', c.tipo || '', c.via || '', c.origem || '',
      new Date(), u.nome, JSON.stringify(c)
    ];
    if (r === -1) {
      sh.appendRow(linha);
      registrar(u, 'cadastro', c.nome, 'Etapa: ' + (c.stage || '') +
        (c.novoProcesso === true ? ' · CPF já cadastrado — confirmado como NOVO PROCESSO' : ''));
    } else {
      sh.getRange(r, 1, 1, linha.length).setValues([linha]);
      registrar(u, 'atualização', c.nome, 'Etapa: ' + (c.stage || '') + (c.contratoAssinadoEm ? ' · Contrato: ' + c.contratoAssinadoEm : ''));
    }
  } finally {
    lock.releaseLock();
  }
}

function excluirCliente(id, u) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = abaClientes();
    const r = linhaDoCliente(sh, id);
    if (r === -1) throw new Error('Cliente não encontrado.');
    const nome = sh.getRange(r, 2).getValue();
    sh.deleteRow(r);
    registrar(u, 'exclusão', nome, 'id ' + id);
  } finally {
    lock.releaseLock();
  }
}

/* ============ HISTÓRICO (auditoria) ============ */
function registrar(u, acao, cliente, detalhe) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_HISTORICO);
    if (sh) sh.appendRow([new Date(), u.nome, u.setor, acao, cliente, detalhe || '']);
  } catch (e) { /* histórico nunca deve derrubar a operação principal */ }
}

/* ============ TESTE MANUAL (menu Executar) ============ */
function testarConsultaCpf() {
  // Troque pelo CPF de um cliente real para ver o retorno no registro de execução.
  Logger.log(JSON.stringify(consultarCpf('000.000.000-00'), null, 2));
}
