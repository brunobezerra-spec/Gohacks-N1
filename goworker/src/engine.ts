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
const dayKey = (ts) => new Date(ts).toISOString().slice(0,10);

export const RE_TESTE = /\btestes?\b|automa[cç][aã]o|n[aã]o [eé] um chamado real|homolog|\bdummy\b|\bfake\b/i;

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

export function buildApproverActivity(all, now) {
  const act = new Map();
  for (const r of all) {
    if (!r.approver) continue;
    if (!act.has(r.approver)) act.set(r.approver, { decided: 0, pending: 0, lastDecisionAt: null, hours: [] });
    const e = act.get(r.approver);
    if (r.status === 'Aguardando') e.pending++;
    else {
      e.decided++;
      if (r.decidedAt && (!e.lastDecisionAt || r.decidedAt > e.lastDecisionAt)) e.lastDecisionAt = r.decidedAt;
      if (r.decisionHours !== null) e.hours.push(r.decisionHours);
    }
  }
  for (const e of act.values()) {
    e.medianH = median(e.hours); e.p90H = pctl(e.hours, 0.9);
    e.idleDays = e.lastDecisionAt ? (now - e.lastDecisionAt) / DAY : null;
    delete e.hours;
  }
  return act;
}

export function analyze(all, opts = {}) {
  const now = opts.now ?? Date.now();
  const base = opts.baselines || buildBaselines(all);
  const prof = buildKeyProfiles(all);
  const activity = buildApproverActivity(all, now);

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

    // R9 volume do dia acima do p95 do proprio fornecedor
    const p = prof.get(r.dupKey);
    if (r.money && r.submittedAt && p) {
      const sameDay = p.perDay.get(dayKey(r.submittedAt)) || 1;
      if (sameDay > Math.max(2, p.perDayP95)) findings.push({ code: 'VOLUME_ACIMA_DO_PADRAO', severity: 1,
        msg: `${sameDay} pedidos deste beneficiario em ${dayKey(r.submittedAt)}; o p95 historico dele e ${p.perDayP95}/dia.`,
        evidence: [{ sameDay, p95: p.perDayP95, total: p.total, distinctDays: p.distinctDays }] });
    }

    results.push({ ...r, ageDays, isTest, findings, ...decide(findings) });
  }

  return { pending: results, baselines: base, profiles: prof, activity, now };
}

// ---------------------------------------------------------------- recomendacao

const BLOQUEIO   = new Set(['CNPJ_INVALIDO', 'CPF_INVALIDO', 'BENEFICIARIO_SO_RECUSADO']);
const ARQUIVO    = new Set(['REGISTRO_DE_TESTE']);
const REDIRECIONA= new Set(['APROVADOR_INATIVO']);

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
  else if (codes.has('FILA_ZUMBI')) { action='CONFIRMAR'; why='Velha demais para decidir sem reconfirmar que ainda vale.'; }
  else if (maxSev >= 2)       { action='REVISAR';      why='Cadastro incompleto ou beneficiario sem historico.'; }
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
    globalMedianDecisionH: analysis.baselines.globalMedianH,
    globalP90DecisionH: analysis.baselines.globalP90H,
    decidedSample: analysis.baselines.decidedCount,
  };
}
