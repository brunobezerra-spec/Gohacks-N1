// Goworker do Financeiro - motor de triagem de solicitacoes de pagamento
// JS puro, sem dependencias. Roda em Node e em Cloudflare Workers.

// ---------------------------------------------------------------- normalizacao

const ACENTOS = { 'á':'a','à':'a','â':'a','ã':'a','ä':'a','é':'e','è':'e','ê':'e','ë':'e',
  'í':'i','ì':'i','î':'i','ï':'i','ó':'o','ò':'o','ô':'o','õ':'o','ö':'o',
  'ú':'u','ù':'u','û':'u','ü':'u','ç':'c','ñ':'n' };

export function deaccent(s) {
  return String(s || '').toLowerCase().replace(/[áàâãäéèêëíìîïóòôõöúùûüçñ]/g, c => ACENTOS[c] || c);
}

// Sufixos societarios e ruido que nao distinguem fornecedor.
const STOPWORDS = new Set(['ltda','me','epp','sa','s','a','eireli','mei','cia','e','de','da','do',
  'das','dos','em','industria','comercio','servicos','servico','s/a','ltda.','-']);

export function normalizeSupplier(name) {
  const base = deaccent(name).replace(/&#\d+;/g, ' ').replace(/[^a-z0-9 ]/g, ' ');
  const toks = base.split(/\s+/).filter(t => t && !STOPWORDS.has(t));
  return toks.join(' ').trim();
}

// ---------------------------------------------------------------- CNPJ / CPF

export function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

export function isValidCNPJ(raw) {
  const c = onlyDigits(raw);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    let sum = 0, pos = len - 7;
    for (let i = 0; i < len; i++) { sum += Number(c[i]) * pos--; if (pos < 2) pos = 9; }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export function isValidCPF(raw) {
  const c = onlyDigits(raw);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(c[i]) * ((t + 1) - i);
    let d = (sum * 10) % 11; if (d === 10) d = 0;
    if (d !== Number(c[t])) return false;
  }
  return true;
}

// formatos aceitos: 00.000.000/0000-00 | 00000000000000
const RE_CNPJ = /\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/;
const RE_CPF  = /\b(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})\b/;

// ---------------------------------------------------------------- parse titulo

const PATTERNS = [
  { kind: 'juros',          re: /^Solicita[cç][aã]o de pagamento Juros R\$:\s*(.*)$/i,        money: true },
  { kind: 'mkt_influencia', re: /^Solicita[cç][aã]o de pagamento Marketing de Influ[eê]ncia(?: em lote)?:?\s*(.*)$/i, money: true },
  { kind: 'pagamento',      re: /^Solicita[cç][aã]o de pagamento\s*:\s*(.*)$/i,               money: true },
  { kind: 'adiantamento',   re: /^Solicita[cç][aã]o de adiantamento a credor\s*(.*)$/i,       money: true },
  { kind: 'internacional',  re: /^Pagamento Internacional\s*-\s*Processo:\s*(.*)$/i,          money: true },
  { kind: 'reembolso',      re: /^Solicita[cç][aã]o de Reembolso\s*-\s*(?:Pessoa F[ií]sica\s*)?(.*)$/i, money: true },
  { kind: 'recarga',        re: /^Solicita[cç][aã]o de recarga\s*-?\s*(.*)$/i,                money: true },
  { kind: 'compra',         re: /^Solicita[cç][aã]o de compra de\s*(.*)$/i,                   money: true },
  { kind: 'estorno',        re: /^(?:\S*\s*)?Estorno\s+(.*)$/i,                               money: true },
  { kind: 'alteracao_titulo', re: /^Altera[cç][aã]o de T[ií]tulo\s*(.*)$/i,                   money: false },
  { kind: 'desconto',       re: /^Aplica[cç][aã]o de desconto\s*(.*)$/i,                      money: false },
  { kind: 'contrato',       re: /^Contratos?\s+/i,                                            money: false },
  { kind: 'novo_servico',   re: /^Solicita[cç][aã]o de Novo Servi[cç]o:?\s*(.*)$/i,           money: false },
];

export function parseTitle(rawTitle) {
  const title = String(rawTitle || '').replace(/&#62;/g, '>').replace(/\s+/g, ' ').trim();
  if (!title) return { kind: 'desconhecido', supplier: null, supplierNorm: '', cnpj: null, cnpjRoot: null, cpf: null, money: true, title: '' };

  let kind = 'outros', rest = title, money = true;
  for (const p of PATTERNS) {
    const m = title.match(p.re);
    if (m) { kind = p.kind; rest = (m[1] || '').trim(); money = p.money; break; }
  }

  const mCnpj = rest.match(RE_CNPJ) || title.match(RE_CNPJ);
  const cnpj = mCnpj ? onlyDigits(mCnpj[1]) : null;
  let leftover = rest;
  if (mCnpj) leftover = leftover.replace(mCnpj[0], ' ');

  const mCpf = leftover.match(RE_CPF);
  const cpf = mCpf ? onlyDigits(mCpf[1]) : null;
  if (mCpf) leftover = leftover.replace(mCpf[0], ' ');

  const supplier = leftover.replace(/\s+/g, ' ').trim() || null;
  return {
    kind, title, money,
    supplier,
    supplierNorm: normalizeSupplier(supplier),
    cnpj,
    cnpjRoot: cnpj ? cnpj.slice(0, 8) : null,
    cpf,
  };
}

// ---------------------------------------------------------------- datas

export function parseDate(s) {
  if (!s) return null;
  // "2026-09-18 10:38:11" -> trata como horario local do GLPI (America/Sao_Paulo, UTC-3)
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +m[6]);
}

export const HOUR = 3600e3, DAY = 24 * HOUR;

// ---------------------------------------------------------------- identidade

// chave de identidade do beneficiario, na melhor granularidade disponivel
export function partyKey(p) {
  if (p.cnpj) return 'cnpj:' + p.cnpj;
  if (p.cpf) return 'cpf:' + p.cpf;
  if (p.supplierNorm) return 'nome:' + p.supplierNorm;
  return 'kind:' + p.kind;
}

// chave de duplicidade: mesmo beneficiario + mesmo tipo + mesmo texto normalizado
export function dupKey(p) {
  return partyKey(p) + '|' + p.kind + '|' + normalizeSupplier(p.title).slice(0, 120);
}

// ---------------------------------------------------------------- enriquecimento

export function enrich(records) {
  return records.map(r => {
    const p = parseTitle(r.paymentRequestTitle);
    const sub = parseDate(r.submissionDate);
    const val = parseDate(r.validationDate);
    return {
      id: r.validationId,
      status: r.statusLabel,
      approver: (r.approver || '').trim().toLowerCase() || null,
      requester: (r.requester || '').trim().toLowerCase() || null,
      title: p.title,
      kind: p.kind,
      money: p.money,
      supplier: p.supplier,
      supplierNorm: p.supplierNorm,
      cnpj: p.cnpj,
      cnpjRoot: p.cnpjRoot,
      cpf: p.cpf,
      partyKey: partyKey(p),
      dupKey: dupKey(p),
      submittedAt: sub,
      decidedAt: val,
      decisionHours: (sub && val && val >= sub) ? (val - sub) / HOUR : null,
      commentSubmission: r.commentSubmission || null,
      commentValidation: r.commentValidation || null,
    };
  });
}

// ---------------------------------------------------------------- baselines

export function buildBaselines(all) {
  const decided = all.filter(r => r.status !== 'Aguardando' && r.decisionHours !== null);

  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const pct = (arr, q) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };

  const byApprover = new Map();
  for (const r of decided) {
    if (!r.approver) continue;
    if (!byApprover.has(r.approver)) byApprover.set(r.approver, []);
    byApprover.get(r.approver).push(r.decisionHours);
  }
  const approverSla = new Map();
  for (const [a, hrs] of byApprover) {
    approverSla.set(a, { n: hrs.length, medianH: median(hrs), p90H: pct(hrs, 0.9) });
  }

  // fornecedores ja vistos em decisoes passadas (qualquer status decidido)
  const knownParties = new Map(); // partyKey -> {n, approved, rejected, firstSeen, lastSeen, name}
  for (const r of all) {
    if (r.status === 'Aguardando') continue;
    const k = r.partyKey;
    if (!knownParties.has(k)) knownParties.set(k, { n: 0, approved: 0, rejected: 0, firstSeen: Infinity, lastSeen: -Infinity, name: r.supplier });
    const e = knownParties.get(k);
    e.n++;
    if (r.status === 'Aprovado') e.approved++;
    if (r.status === 'Recusado') e.rejected++;
    if (r.submittedAt) { e.firstSeen = Math.min(e.firstSeen, r.submittedAt); e.lastSeen = Math.max(e.lastSeen, r.submittedAt); }
    if (!e.name && r.supplier) e.name = r.supplier;
  }

  const allHrs = decided.map(r => r.decisionHours);
  return {
    approverSla,
    knownParties,
    globalMedianH: median(allHrs),
    globalP90H: pct(allHrs, 0.9),
    decidedCount: decided.length,
  };
}

// ---------------------------------------------------------------- regras

export const ZOMBIE_DAYS = 45;
export const APPROVER_IDLE_DAYS = 90;

// LIMITES DE DADOS VERIFICADOS EM 18/09/2026 (nao contornar, nao fingir que nao existem):
//  (a) get_payment_request devolve valor/vencimento/NF/centro de custo = null para
//      praticamente todo ticket sob o perfil de servico. NENHUMA regra pode falar de dinheiro.
//  (b) o titulo NAO identifica o pagamento: um fornecedor recorrente submete centenas de
//      pedidos com titulo byte-a-byte identico (TOTUS TUUS MARIAE: 579 em 188 dias).
//      Portanto "titulo igual" NAO e evidencia de duplicata.
//  (c) grupos submetidos no MESMO SEGUNDO sao quase sempre LOTE legitimo de varias notas:
//      dos 112 grupos historicos ja decididos, 108 tiveram TODOS os irmaos aprovados (96%).
//      Por isso LOTE_AMBIGUO e informativo, nunca bloqueio.

const median = (a) => { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const pctl = (a,q) => { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y); return s[Math.min(s.length-1, Math.floor(q*s.length))]; };
// parseDate guarda UTC verdadeiro; para o dia-calendario de Sao Paulo, volta 3h.
const dayKey = (ts) => new Date(ts - 3 * HOUR).toISOString().slice(0,10);

// Cuidado: "automacao" sozinho pega fornecedor real (PCTEC SOLUCOES EM TI E
// AUTOMACAO COMERCIAL). So conta como teste na frase de teste de automacao.
export const RE_TESTE = /\btestes?\b|teste de automa[cç][aã]o|n[aã]o [eé] um chamado real|\bhomolog\w*\b|\bdummy\b|\bfake\b/i;

export function buildKeyProfiles(all) {
  const g = new Map();
  for (const r of all) {
    if (!r.money || !r.submittedAt) continue;
    if (!g.has(r.dupKey)) g.set(r.dupKey, []);
    g.get(r.dupKey).push(r);
  }
  const prof = new Map();
  for (const [k, arr] of g) {
    const perDay = new Map();
    for (const r of arr) perDay.set(dayKey(r.submittedAt), (perDay.get(dayKey(r.submittedAt))||0)+1);
    const counts = [...perDay.values()];
    prof.set(k, { total: arr.length, distinctDays: perDay.size,
      perDayP95: pctl(counts, 0.95) ?? 1, perDayMedian: median(counts) ?? 1,
      recurring: arr.length >= 5 && perDay.size >= 3, perDay });
  }
  return prof;
}

// Que nomes ja apareceram sob cada CNPJ, e com que taxa de recusa cada
// beneficiario foi decidido. Base para as regras de identidade.
export function buildPartyIndex(all) {
  const porCnpj = new Map();          // cnpj -> Set de nomes normalizados vistos em decididos
  const decididosPorCnpj = new Map(); // cnpj -> quantas decisoes ja houve
  const recusa = new Map();           // partyKey -> {aprovados, recusados, nome}
  for (const r of all) {
    if (r.status === 'Aguardando') continue;
    if (r.cnpj) decididosPorCnpj.set(r.cnpj, (decididosPorCnpj.get(r.cnpj) ?? 0) + 1);
    if (r.cnpj && r.supplierNorm) {
      if (!porCnpj.has(r.cnpj)) porCnpj.set(r.cnpj, new Set());
      porCnpj.get(r.cnpj).add(r.supplierNorm);
    }
    if (r.partyKey) {
      if (!recusa.has(r.partyKey)) recusa.set(r.partyKey, { aprovados: 0, recusados: 0, nome: r.supplier });
      const e = recusa.get(r.partyKey);
      if (r.status === 'Aprovado') e.aprovados++;
      if (r.status === 'Recusado') e.recusados++;
      if (!e.nome && r.supplier) e.nome = r.supplier;
    }
  }
  return { porCnpj, decididosPorCnpj, recusa };
}

// Dois nomes "batem" se forem plausivelmente a mesma entidade. Precisa aguentar
// as tres sujeiras reais do cadastro do GLPI, sem as quais a regra vira ruido:
//   (a) grafia colada:   "JOSECAMILODOSREIS"  vs "jose camilo reis"
//   (b) abreviacao:      "Unixlog"            vs "unix logistica transportes"
//   (c) digitos no nome: "62.238.058 JONAS B" vs "jonas barboza viana"
// So devolve false quando os nomes nao tem NENHUMA relacao plausivel.
export function nomesCompativeis(a, b) {
  const limpa = (x) => String(x || '').replace(/\d/g, ' ').replace(/\s+/g, ' ').trim();
  const A = limpa(a), B = limpa(b);
  if (!A || !B) return true;                       // sem nome util: nao acusa

  const ca = A.replace(/ /g, ''), cb = B.replace(/ /g, '');
  if (!ca || !cb) return true;

  // (a) e (b): um e prefixo ou subcadeia do outro, com massa suficiente
  const curto = ca.length <= cb.length ? ca : cb;
  const longo = ca.length <= cb.length ? cb : ca;
  if (curto.length >= 4 && longo.includes(curto)) return true;
  if (curto.length >= 6 && longo.startsWith(curto.slice(0, 6))) return true;

  // token forte em comum
  const ta = new Set(A.split(' ').filter(t => t.length >= 4));
  const tb = new Set(B.split(' ').filter(t => t.length >= 4));
  if (!ta.size || !tb.size) return true;
  for (const t of ta) if (tb.has(t)) return true;

  // prefixo de 5 letras em comum entre tokens fortes (VERDEX / VERDASCA nao passa,
  // mas TRANSPORTES / TRANSPORTE sim)
  for (const t of ta) for (const u of tb) if (t.slice(0, 5) === u.slice(0, 5)) return true;

  return false;
}

export function buildApproverActivity(all, now) {
  const act = new Map();
  for (const r of all) {
    if (!r.approver) continue;
    if (!act.has(r.approver)) act.set(r.approver, { decided: 0, pending: 0, lastDecisionAt: null, oldestPendingAt: null, hours: [] });
    const e = act.get(r.approver);
    if (r.status === 'Aguardando') {
      e.pending++;
      if (r.submittedAt && (!e.oldestPendingAt || r.submittedAt < e.oldestPendingAt)) e.oldestPendingAt = r.submittedAt;
    }
    else {
      e.decided++;
      if (r.decidedAt && (!e.lastDecisionAt || r.decidedAt > e.lastDecisionAt)) e.lastDecisionAt = r.decidedAt;
      if (r.decisionHours !== null) e.hours.push(r.decisionHours);
    }
  }
  for (const e of act.values()) {
    e.medianH = median(e.hours); e.p90H = pctl(e.hours, 0.9);
    e.idleDays = e.lastDecisionAt ? (now - e.lastDecisionAt) / DAY : null;
    // Quem nunca decidiu nada nao tem lastDecisionAt. Se segura fila, e orfa igual:
    // usa a idade do pedido mais antigo como proxy de ha quanto tempo nada acontece.
    e.nuncaDecidiu = e.decided === 0;
    if (e.nuncaDecidiu && e.oldestPendingAt) e.idleDays = (now - e.oldestPendingAt) / DAY;
    delete e.hours;
  }
  return act;
}

export function analyze(all, opts = {}) {
  const now = opts.now ?? Date.now();
  const base = opts.baselines || buildBaselines(all);
  const prof = buildKeyProfiles(all);
  const activity = buildApproverActivity(all, now);
  const parties = buildPartyIndex(all);
  const kindRisk = opts.kindRisk || buildKindRisk(all);

  const bySecond = new Map();
  for (const r of all) {
    if (!r.money || !r.submittedAt) continue;
    const k = r.dupKey + '@' + r.submittedAt;
    if (!bySecond.has(k)) bySecond.set(k, []);
    bySecond.get(k).push(r);
  }

  const pending = all.filter(r => r.status === 'Aguardando');
  const results = [];

  for (const r of pending) {
    const findings = [];
    const ageDays = r.submittedAt ? (now - r.submittedAt) / DAY : null;
    const isTest = RE_TESTE.test(r.title || '');

    // R1 registro de teste vivo na fila de producao
    if (isTest) findings.push({ code: 'REGISTRO_DE_TESTE', severity: 2,
      msg: 'Titulo identifica registro de teste. Nao e pedido real: polui a fila e as metricas.', evidence: [] });

    // R10 o CNPJ tem historico, mas SEMPRE sob outro nome. CNPJ conhecido nao torna
    // o pedido seguro se quem recebe mudou. Este era o buraco que liberava
    // ONFLY TECNOLOGIA num CNPJ cujo historico inteiro era de outra pessoa fisica.
    const nomeEhLixo = !/[a-z]{3}/.test(r.supplierNorm || '');
    if (r.money && !isTest && r.cnpj && r.supplierNorm && !nomeEhLixo) {
      const nomes = parties.porCnpj.get(r.cnpj);
      // exige historico com pelo menos 2 decisoes: uma unica ocorrencia antiga
      // nao e evidencia suficiente para bloquear um pagamento.
      const forte = nomes && nomes.size && (parties.decididosPorCnpj.get(r.cnpj) ?? 0) >= 2;
      if (forte && ![...nomes].some(n => nomesCompativeis(r.supplierNorm, n))) {
        findings.push({ code: 'NOME_DIVERGE_DO_CNPJ', severity: 3,
          msg: `O CNPJ ${r.cnpj} ja foi usado ${nomes.size === 1 ? 'sempre' : 'so'} sob outro nome (${[...nomes].slice(0,2).join(' / ')}). Aqui aparece como "${r.supplier}".`,
          evidence: [{ cnpj: r.cnpj, nomesHistoricos: [...nomes].slice(0, 5), nomeAtual: r.supplier }] });
      }
    }

    // R11 autoaprovacao: a mesma pessoa pede e aprova. Quebra de segregacao de
    // funcao, detectavel sem nenhum campo financeiro.
    if (r.requester && r.approver && r.requester === r.approver) {
      findings.push({ code: 'AUTOAPROVACAO', severity: 3,
        msg: `${r.approver} e solicitante E aprovador do mesmo pedido. Quebra de segregacao de funcao.`,
        evidence: [{ pessoa: r.approver }] });
    }

    // R12 beneficiario com taxa de recusa muito acima da base da empresa (0,9%)
    if (r.money && !isTest && r.partyKey) {
      const e = parties.recusa.get(r.partyKey);
      if (e && e.recusados >= 1 && (e.aprovados + e.recusados) >= 2) {
        const taxa = e.recusados / (e.aprovados + e.recusados);
        if (taxa >= 0.15) findings.push({ code: 'BENEFICIARIO_ALTA_RECUSA', severity: 2,
          msg: `Beneficiario ja teve ${e.recusados} recusa(s) em ${e.aprovados + e.recusados} decisoes (${Math.round(taxa*100)}%). A media da empresa e 0,9%.`,
          evidence: [{ aprovados: e.aprovados, recusados: e.recusados, taxaPct: Math.round(taxa*100) }] });
      }
    }

    // R13 valor vazou para o texto livre do titulo, no lugar do nome do fornecedor.
    if (r.money && /^\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^\d{4,}[.,]\d{2}$/.test((r.supplier || '').trim())) {
      findings.push({ code: 'VALOR_NO_TITULO', severity: 2,
        msg: `O titulo traz um numero com cara de valor (${r.supplier}) onde deveria estar o nome do fornecedor. Cadastro mal preenchido.`,
        evidence: [{ possivelValor: r.supplier }] });
    }

    // R2 documento com digito verificador quebrado (fora de registros de teste)
    if (!isTest && r.cnpj && !isValidCNPJ(r.cnpj)) findings.push({ code: 'CNPJ_INVALIDO', severity: 3,
      msg: `CNPJ ${r.cnpj} reprova no digito verificador. Cadastro errado: o dinheiro pode ir para o lugar errado.`,
      evidence: [{ cnpj: r.cnpj }] });
    if (!isTest && r.cpf && !isValidCPF(r.cpf)) findings.push({ code: 'CPF_INVALIDO', severity: 3,
      msg: `CPF ${r.cpf} reprova no digito verificador.`, evidence: [{ cpf: r.cpf }] });

    // R3 fila orfa: aprovador parou de decidir e continua dono da fila
    const act = r.approver ? activity.get(r.approver) : null;
    if (act && act.idleDays !== null && act.idleDays > APPROVER_IDLE_DAYS && act.pending > 0) {
      findings.push({ code: 'APROVADOR_INATIVO', severity: 3,
        msg: `${r.approver} nao decide nada ha ${Math.round(act.idleDays)} dias e ainda segura ${act.pending} pedido(s). Fila orfa.`,
        evidence: [{ approver: r.approver, idleDays: Math.round(act.idleDays), pending: act.pending, decided: act.decided }] });
    }

    // R4 fila zumbi
    if (ageDays !== null && ageDays > ZOMBIE_DAYS) findings.push({ code: 'FILA_ZUMBI', severity: 2,
      msg: `Parada ha ${Math.round(ageDays)} dias sem decisao.`, evidence: [{ ageDays: Math.round(ageDays) }] });

    // R5 estourou o p90 do proprio aprovador
    const usaProprio = act && act.decided >= 20 && act.p90H;
    const refH = usaProprio ? act.p90H : base.globalP90H;
    if (ageDays !== null && refH && (ageDays * 24) > refH && ageDays <= ZOMBIE_DAYS) {
      findings.push({ code: 'SLA_ESTOURADO', severity: 1,
        msg: `Parada ha ${Math.round(ageDays*24)}h. O p90 de ${usaProprio ? r.approver : 'referencia global'} e ${Math.round(refH)}h.`,
        evidence: [{ ageHours: Math.round(ageDays*24), p90H: Math.round(refH) }] });
    }

    // R6 beneficiario sem historico decidido
    if (r.money && !isTest && (r.cnpj || r.cpf)) {
      const known = base.knownParties.get(r.partyKey);
      if (!known) findings.push({ code: 'BENEFICIARIO_NOVO', severity: 2,
        msg: 'Beneficiario sem nenhum pedido decidido no historico. Conferir cadastro antes de liberar.',
        evidence: [{ partyKey: r.partyKey }] });
      else if (known.rejected > 0 && known.approved === 0) findings.push({ code: 'BENEFICIARIO_SO_RECUSADO', severity: 3,
        msg: `Beneficiario tem ${known.rejected} recusa(s) e nenhuma aprovacao no historico.`,
        evidence: [{ rejected: known.rejected }] });
    }

    // R7 pedido de dinheiro que nao diz quem recebe
    if (r.money && !isTest && !r.cnpj && !r.cpf && !r.supplierNorm) findings.push({ code: 'SEM_BENEFICIARIO', severity: 2,
      msg: 'Pedido financeiro cujo registro de aprovacao nao identifica o beneficiario. Nao ha o que auditar.',
      evidence: [] });

    // R8 lote no mesmo segundo: INFORMATIVO. 96% dos casos historicos eram lote legitimo.
    if (r.money && r.submittedAt) {
      const twins = (bySecond.get(r.dupKey + '@' + r.submittedAt) || []).filter(o => o.id !== r.id);
      if (twins.length) findings.push({ code: 'LOTE_AMBIGUO', severity: 1,
        msg: `${twins.length+1} pedidos identicos no mesmo segundo. Sem o valor e o numero da nota o registro nao permite separar lote de notas de duplicata. Historicamente 96% desses grupos eram lote legitimo.`,
        evidence: twins.slice(0,8).map(o => ({ id: o.id, status: o.status })) });
    }

    // R14 tipo de pedido historicamente mais recusado. NAO muda a acao (nao e
    // pendencia de cadastro), muda a ORDEM: sem valor em reais, a classe do pedido
    // e o unico proxy de materialidade que sobrevive a correcao de Bonferroni.
    const kr = kindRisk.porKind.get(r.kind);
    if (kr && kr.significativo) {
      findings.push({ code: 'TIPO_DE_ALTO_RISCO', severity: 1,
        msg: `Pedidos do tipo "${r.kind}" sao recusados ${kr.lift.toFixed(1)}x mais que a media (${kr.recusados} de ${kr.n}, p ajustado ${kr.pAjustado.toExponential(1)}).`,
        evidence: [{ kind: r.kind, lift: Number(kr.lift.toFixed(2)), n: kr.n, recusados: kr.recusados }] });
    }

    // R9 volume do dia acima do p95 do proprio fornecedor
    const p = prof.get(r.dupKey);
    if (r.money && r.submittedAt && p) {
      const sameDay = p.perDay.get(dayKey(r.submittedAt)) || 1;
      if (sameDay > Math.max(2, p.perDayP95)) findings.push({ code: 'VOLUME_ACIMA_DO_PADRAO', severity: 1,
        msg: `${sameDay} pedidos deste beneficiario em ${dayKey(r.submittedAt)}; o p95 historico dele e ${p.perDayP95}/dia.`,
        evidence: [{ sameDay, p95: p.perDayP95, total: p.total, distinctDays: p.distinctDays }] });
    }

    const d = decide(findings);
    // Prioridade separa "o que fazer" de "em que ordem". Idade sozinha era o unico
    // criterio antes, e idade nao tem nada a ver com materialidade.
    const liftTipo = kr && kr.significativo ? kr.liftEncolhido : 1;
    // 0-100. Gravidade do achado, ponderada pelo risco historico da classe, mais um
    // componente menor de idade. Idade sozinha nunca ordena a fila.
    const prioridade = Math.round(Math.min(100, (d.risk * liftTipo) / 3 + Math.min(25, (ageDays ?? 0) / 14)));
    results.push({ ...r, ageDays, isTest, findings, ...d, liftTipo, prioridade });
  }

  return { pending: results, baselines: base, profiles: prof, activity, kindRisk, now };
}

// ---------------------------------------------------------------- recomendacao

const BLOQUEIO   = new Set(['CNPJ_INVALIDO', 'CPF_INVALIDO', 'BENEFICIARIO_SO_RECUSADO', 'NOME_DIVERGE_DO_CNPJ', 'AUTOAPROVACAO']);
const ARQUIVO    = new Set(['REGISTRO_DE_TESTE']);
const REDIRECIONA= new Set(['APROVADOR_INATIVO']);
// Severidade 2 que fala de CADASTRO (nao de idade): resolve-se corrigindo dado.
const CADASTRO   = new Set(['BENEFICIARIO_NOVO', 'BENEFICIARIO_ALTA_RECUSA', 'SEM_BENEFICIARIO', 'VALOR_NO_TITULO']);

export const ACOES = {
  BLOQUEAR:     { label: 'Bloquear e corrigir cadastro', ordem: 1 },
  REDIRECIONAR: { label: 'Trocar o aprovador',           ordem: 2 },
  ARQUIVAR:     { label: 'Arquivar (nao e pedido real)', ordem: 3 },
  CONFIRMAR:    { label: 'Reconfirmar ou encerrar',      ordem: 4 },
  REVISAR:      { label: 'Revisar antes de decidir',     ordem: 5 },
  LIBERAR:      { label: 'Pronto para decisao humana',   ordem: 6 },
};

export function decide(findings) {
  const codes = new Set(findings.map(f => f.code));
  const maxSev = findings.reduce((m, f) => Math.max(m, f.severity), 0);
  const risk = Math.min(100, findings.reduce((s, f) => s + f.severity * f.severity * 8, 0));
  const hit = (set) => [...codes].some(c => set.has(c));

  let action, why;
  if (hit(BLOQUEIO))          { action='BLOQUEAR';     why='Cadastro do beneficiario esta invalido. Corrigir antes de qualquer decisao.'; }
  else if (hit(ARQUIVO))      { action='ARQUIVAR';     why='Registro de teste ocupando a fila de producao.'; }
  else if (hit(REDIRECIONA))  { action='REDIRECIONAR'; why='O dono da fila parou de decidir. Sem trocar o aprovador isso nunca anda.'; }
  // Cadastro vem ANTES de idade: um pedido velho E com pendencia de cadastro
  // precisa do cadastro resolvido primeiro, senao reconfirmar nao adianta.
  // FILA_ZUMBI tambem e severidade 2, mas e pendencia de IDADE, nao de cadastro.
  else if (hit(CADASTRO))     { action='REVISAR';      why='Pendencia de cadastro ou beneficiario com historico ruim. Resolver isso antes de decidir.'; }
  else if (codes.has('FILA_ZUMBI')) { action='CONFIRMAR'; why='Velha demais para decidir sem reconfirmar que ainda vale.'; }
  else                        { action='LIBERAR';      why='Beneficiario recorrente, dentro do padrao, sem pendencia de cadastro.'; }

  return { action, actionLabel: ACOES[action].label, why, risk, maxSeverity: maxSev };
}

// ---------------------------------------------------------------- agregados

export function summarize(analysis) {
  const p = analysis.pending;
  const by = (f) => p.reduce((m, r) => { const k=f(r); m[k]=(m[k]||0)+1; return m; }, {});
  const codeCount = {};
  for (const r of p) for (const f of r.findings) codeCount[f.code] = (codeCount[f.code]||0)+1;
  const ages = p.map(r => r.ageDays).filter(x => x !== null).sort((a,b)=>a-b);

  const orfas = [];
  for (const [a, e] of analysis.activity) if (e.pending > 0 && e.idleDays !== null && e.idleDays > APPROVER_IDLE_DAYS)
    orfas.push({ approver: a, pending: e.pending, decided: e.decided, idleDays: Math.round(e.idleDays) });
  orfas.sort((a,b)=>b.pending-a.pending);

  const gargalos = [];
  for (const [a, e] of analysis.activity) if (e.pending >= 10)
    gargalos.push({ approver: a, pending: e.pending, decided: e.decided,
      medianH: e.medianH===null?null:Math.round(e.medianH), idleDays: e.idleDays===null?null:Math.round(e.idleDays) });
  gargalos.sort((a,b)=>b.pending-a.pending);

  return {
    totalPending: p.length,
    byAction: by(r => r.action),
    byKind: by(r => r.kind),
    byCode: codeCount,
    needsWork: p.filter(r => r.action !== 'LIBERAR').length,
    testesNaFila: p.filter(r => r.isTest).length,
    orphanApprovers: orfas.length,
    orphanPending: orfas.reduce((s,o)=>s+o.pending,0),
    orfas, gargalos,
    oldestDays: ages.length ? Math.round(ages[ages.length-1]) : null,
    medianAgeDays: ages.length ? Math.round(ages[Math.floor(ages.length/2)]) : null,
    tiposDeAltoRisco: [...analysis.kindRisk.porKind.values()].filter(k => k.significativo)
      .sort((a, b) => b.lift - a.lift)
      .map(k => ({ kind: k.kind, n: k.n, recusados: k.recusados, lift: Number(k.lift.toFixed(1)),
        liftEncolhido: Number(k.liftEncolhido.toFixed(1)), pAjustado: k.pAjustado })),
    taxaBaseRecusa: analysis.kindRisk.base,
    globalMedianDecisionH: analysis.baselines.globalMedianH,
    globalP90DecisionH: analysis.baselines.globalP90H,
    decidedSample: analysis.baselines.decidedCount,
  };
}

// ---------------------------------------------------------------- auditoria retroativa

// A triagem olha para a frente (a fila parada). Esta funcao olha para tras: o que
// JA FOI APROVADO com cadastro que reprova no digito verificador. Nao e hipotese,
// e dinheiro que ja saiu contra um documento que nao passa na conferencia basica.
export function auditRetroativo(all) {
  const invalido = (r) => (r.cnpj && !isValidCNPJ(r.cnpj)) || (r.cpf && !isValidCPF(r.cpf));
  const docDe = (r) => r.cnpj ? { doc: r.cnpj, tipo: 'CNPJ' } : { doc: r.cpf, tipo: 'CPF' };

  const aprovados = all.filter(r => r.status === 'Aprovado' && !RE_TESTE.test(r.title || '') && invalido(r));

  const porDoc = new Map();
  for (const r of aprovados) {
    const { doc, tipo } = docDe(r);
    if (!porDoc.has(doc)) porDoc.set(doc, { doc, tipo, n: 0, nome: r.supplier, primeiro: null, ultimo: null });
    const e = porDoc.get(doc);
    e.n++;
    if (!e.nome && r.supplier) e.nome = r.supplier;
    if (r.submittedAt) {
      const d = new Date(r.submittedAt).toISOString().slice(0, 10);
      if (!e.primeiro || d < e.primeiro) e.primeiro = d;
      if (!e.ultimo || d > e.ultimo) e.ultimo = d;
    }
  }

  // Grafias conflitantes: mesmo CNPJ base (raiz + filial, 12 digitos) escrito com
  // digitos verificadores diferentes. Pelo menos uma das grafias e erro de digitacao.
  const porBase = new Map();
  for (const r of all) {
    if (!r.cnpj) continue;
    const base = r.cnpj.slice(0, 12);
    if (!porBase.has(base)) porBase.set(base, new Map());
    const g = porBase.get(base);
    if (!g.has(r.cnpj)) g.set(r.cnpj, { cnpj: r.cnpj, valido: isValidCNPJ(r.cnpj), n: 0, aprovados: 0, nome: r.supplier });
    const e = g.get(r.cnpj);
    e.n++;
    if (r.status === 'Aprovado') e.aprovados++;
    if (!e.nome && r.supplier) e.nome = r.supplier;
  }
  const conflitos = [];
  for (const [base, g] of porBase) {
    if (g.size < 2) continue;
    const grafias = [...g.values()];
    if (grafias.every(x => x.valido)) continue; // filiais distintas, nao e erro
    conflitos.push({
      base,
      nome: grafias.find(x => x.nome)?.nome ?? null,
      grafias: grafias.sort((a, b) => b.n - a.n),
      aprovadosEmGrafiaInvalida: grafias.filter(x => !x.valido).reduce((s, x) => s + x.aprovados, 0),
    });
  }
  conflitos.sort((a, b) => b.aprovadosEmGrafiaInvalida - a.aprovadosEmGrafiaInvalida);

  return {
    aprovadosComDocInvalido: aprovados.length,
    documentosDistintos: porDoc.size,
    porDocumento: [...porDoc.values()].sort((a, b) => b.n - a.n).slice(0, 25),
    conflitosDeGrafia: conflitos.slice(0, 15),
    totalConflitos: conflitos.length,
  };
}

// ---------------------------------------------------------------- risco por tipo

// Sem valor em reais nao da para priorizar por dinheiro. Mas o TIPO do pedido e um
// proxy de materialidade que estava de graca no dado e o motor nao usava: algumas
// classes sao recusadas muito acima da media, e isso sobrevive a correcao de
// multiplas comparacoes (Bonferroni), diferente dos sinais de fila.
const lchoose = (n, k) => { let s = 0; for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1); return s; };
export function binomUpper(n, k, p) {
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(lchoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}

// Encolhimento: um lift de 26x vindo de 18 observacoes nao e 26x. Puxamos a taxa
// de cada tipo na direcao da taxa-base com um prior de PRIOR_N pseudo-observacoes,
// de modo que classe pequena so se afasta da media com evidencia de verdade.
export const PRIOR_N = 50;

export function buildKindRisk(all, minN = 15) {
  const dec = all.filter(r => r.status === 'Aprovado' || r.status === 'Recusado');
  const base = dec.length ? dec.filter(r => r.status === 'Recusado').length / dec.length : 0;
  const g = new Map();
  for (const r of dec) {
    if (!g.has(r.kind)) g.set(r.kind, { n: 0, recusados: 0 });
    const e = g.get(r.kind);
    e.n++;
    if (r.status === 'Recusado') e.recusados++;
  }
  const elegiveis = [...g.values()].filter(e => e.n >= minN).length || 1;
  const out = new Map();
  for (const [kind, e] of g) {
    const lift = base ? (e.recusados / e.n) / base : 1;
    const taxaEncolhida = (e.recusados + base * PRIOR_N) / (e.n + PRIOR_N);
    const liftEncolhido = base ? taxaEncolhida / base : 1;
    const p = e.n >= minN ? binomUpper(e.n, e.recusados, base) : 1;
    out.set(kind, { kind, ...e, lift, liftEncolhido, p, pAjustado: Math.min(1, p * elegiveis),
      significativo: e.n >= minN && p * elegiveis < 0.05 && lift > 1 });
  }
  return { base, comparacoes: elegiveis, porKind: out };
}

// ---------------------------------------------------------------- motivos de recusa

const HTML = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// O GLPI guarda o motivo da recusa em texto livre. As 152 recusas tem 100% de
// cobertura. Isso nao ajuda a triar a fila de hoje (so 11 pendentes tem comentario),
// mas diz o que de fato da errado, e mostra que quase todo motivo real depende
// justamente dos campos financeiros que o perfil de leitura nao entrega.
export const MOTIVOS = [
  { cat: 'centro de custo errado',   re: /centro de custo/i,                              precisaValor: true },
  { cat: 'nota fiscal ou documento', re: /\bnf\b|nota fiscal|boleto|comprovante/i,         precisaValor: true },
  { cat: 'valor errado',             re: /valor|r\$|pre[cç]o|desconto|juros/i,             precisaValor: true },
  { cat: 'duplicidade',              re: /duplic|repetid|j[aá] (foi|abriu)|mesma solicita/i, precisaValor: true },
  { cat: 'cadastro do fornecedor',   re: /cadastr|fornecedor|cnpj|dados banc|conta banc/i, precisaValor: false },
  { cat: 'aprovador errado',         re: /aprovador|n[aã]o (sou eu|e de minha)|encaminh|solicitante de aprova/i, precisaValor: false },
  { cat: 'e registro de teste',      re: /\bteste\b/i,                                     precisaValor: false },
  { cat: 'refazer o pedido',         re: /refaz|corrig|ajust|nova solicita|colocado errado/i, precisaValor: false },
];

export function motivosDeRecusa(all) {
  const rec = all.filter(r => r.status === 'Recusado');
  const textos = rec.map(r => ({ id: r.id, txt: HTML(r.commentValidation) })).filter(x => x.txt);
  const cat = MOTIVOS.map(m => ({ categoria: m.cat, precisaValor: m.precisaValor,
    n: textos.filter(x => m.re.test(x.txt)).length }));
  const classificados = new Set();
  for (const m of MOTIVOS) for (const x of textos) if (m.re.test(x.txt)) classificados.add(x.id);
  const dependemDeValor = cat.filter(c => c.precisaValor).reduce((s, c) => s + c.n, 0);
  return {
    recusas: rec.length,
    comMotivoRegistrado: textos.length,
    categorias: cat.sort((a, b) => b.n - a.n),
    semCategoria: textos.length - classificados.size,
    dependemDeCampoFinanceiro: dependemDeValor,
  };
}
