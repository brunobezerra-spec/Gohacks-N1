// Situacao de emprego de cada aprovador do GoService, conferida no Teamguide
// em 18/09/2026. Resolve a pendencia 4 do handoff (regra 7).
//
// Metodo: list_employees devolve so ativos, entao "nao achei" NUNCA virou
// desligado. Todo ativo=false tem data de desligamento explicita vinda de
// get_employee_tenure(includeResigned=true). Quem nao deu para identificar
// fica como "desconhecido" e o agente NAO acusa.
export type SituacaoEmprego = true | false | "desconhecido";
export const TEAMGUIDE: Record<string, { ativo: SituacaoEmprego; nome: string|null; cargo: string|null; evidencia: string }> = {
 "joao.conde": {
  "ativo": true,
  "nome": "Joao Batista Rufino Conde",
  "cargo": "Gerente de Transportes",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "edivar": {
  "ativo": true,
  "nome": "Edivar Moreira Marinho Filho",
  "cargo": "Head de Sourcing e Procurement",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "joaquim": {
  "ativo": true,
  "nome": "Joaquim Quindere",
  "cargo": "Diretor de Operacoes",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "simony.morais": {
  "ativo": true,
  "nome": "Simony Fernanda Santos De Oliveira Morais",
  "cargo": "Diretora de Gente e Gestao",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "luis": {
  "ativo": true,
  "nome": "Luis Liveri",
  "cargo": "CEO",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "guilherme": {
  "ativo": true,
  "nome": "Guilherme Reis da Nobrega",
  "cargo": "COO",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "andre.castro": {
  "ativo": true,
  "nome": "Andre Moreira de Mesquita Castro",
  "cargo": "Diretor de Growth e Marketing de Influencia",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "carla.alencar": {
  "ativo": true,
  "nome": "Carla Bruna Araujo Couto De Alencar",
  "cargo": "Analista de Operacoes Pleno",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "joao.simao": {
  "ativo": true,
  "nome": "Joao Guilherme De Grossi Kochanowski Simao",
  "cargo": "Gerente B2B",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "rafael.menezes": {
  "ativo": true,
  "nome": "Rafael dos Santos Menezes",
  "cargo": "Diretor de Operacoes",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "silvia.scarabelot": {
  "ativo": true,
  "nome": "Silvia Scarabelot",
  "cargo": "Gerente de Produto",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "laiza.garcia": {
  "ativo": true,
  "nome": "Laiza Sousa Garcia",
  "cargo": "Head de Gestao e CX",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "natalia.pavao": {
  "ativo": true,
  "nome": "Natalia Pavao Silva",
  "cargo": "Gerente de Operacoes e Qualidade",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "samir.labib": {
  "ativo": true,
  "nome": "Samir Labib Teixeira Salamoun",
  "cargo": "Gerente Fiscal",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "murilo.guimaraes": {
  "ativo": true,
  "nome": "Jose Murilo Veloso Guimaraes Filho",
  "cargo": "Gerente de Supply",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "antonio.mendes": {
  "ativo": true,
  "nome": "Antonio Bruno Goncalves Mendes",
  "cargo": "Estagiario Go Builders AI",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "fernanda.alves": {
  "ativo": false,
  "nome": "Fernanda De Souza Alves",
  "cargo": "Gerente B2B",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-02-12"
 },
 "larissa.queiroz": {
  "ativo": true,
  "nome": "Larissa Soares Maia de Queiroz",
  "cargo": "Especialista de Melhoria Continua",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "camila.mussim": {
  "ativo": true,
  "nome": "Camila Boatto Mussim",
  "cargo": "Head de Compliance",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "juliana.bortoletto": {
  "ativo": true,
  "nome": "Juliana de Oliveira Bortoletto",
  "cargo": "Gerente de Gente e Gestao",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "wilian.mello": {
  "ativo": true,
  "nome": "Wilian de Mello Souza",
  "cargo": "Gerente de Logistica",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "fernanda.gentil": {
  "ativo": true,
  "nome": "Fernanda Gentil Peixoto",
  "cargo": "Head de Operacoes",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "cristianne.moura": {
  "ativo": false,
  "nome": "Cristianne Moura Roberto",
  "cargo": "Gerente de CSC",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-05-15"
 },
 "rodrigo.cruz": {
  "ativo": true,
  "nome": "Rodrigo Ribeiro Monteiro Cruz",
  "cargo": "Head de Financas",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "jessica.park": {
  "ativo": true,
  "nome": "Jessica Bo Hee Park",
  "cargo": "Gerente de Produto",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "lucas.guerra": {
  "ativo": false,
  "nome": "Lucas Teixeira Pinheiro Guerra",
  "cargo": "Head de B2B",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-06-01"
 },
 "marilia.dantas": {
  "ativo": false,
  "nome": "Anna Marilia Pinheiro Dantas",
  "cargo": "Gerente Financeiro",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-07-27"
 },
 "antonelle.gomes": {
  "ativo": false,
  "nome": "Antonelle Araujo Gomes",
  "cargo": "Analista Fiscal PL",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-07-09"
 },
 "carmem.bianca": {
  "ativo": false,
  "nome": "Carmem Bianca Quirino de Sousa",
  "cargo": "Estagiario(a) de Projetos",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-04-30"
 },
 "matheus": {
  "ativo": "desconhecido",
  "nome": null,
  "cargo": null,
  "evidencia": "login ambiguo: nao existe e-mail 'matheus@' na base. Ha 5 pessoas ativas com esse primeiro nome (Matheus De Faria Galvao, Matheus Sa de Castro, Matheus Vasconcelos de Almeida, Matheus Zacche Caetano, Mateus de Alcantara Aragao) e o get_employee_tenure com includeResigned nao completou (HTTP 429 repetido). NAO ha evidencia de desligamento - apenas nao foi possivel identificar a pessoa"
 },
 "joao.carlos": {
  "ativo": true,
  "nome": "Joao Carlos de Oliveira Neto",
  "cargo": "Coordenador de Projetos",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "luisa": {
  "ativo": true,
  "nome": "Luisa Ferraiuoli Vieira de Souza",
  "cargo": "Gerente de Projetos",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "carlos.feitosa": {
  "ativo": false,
  "nome": "Jose Carlos Feitosa Azevedo",
  "cargo": "Coordenador Financeiro Pleno",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-07-09"
 },
 "anderson.matos": {
  "ativo": false,
  "nome": "Anderson dos Santos Matos",
  "cargo": "Coordenador Financeiro",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-06-24"
 },
 "vitoria.azevedo": {
  "ativo": true,
  "nome": "Vitoria Oliveira Azevedo",
  "cargo": "Coordenadora de Suprimento",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "nort.furlani": {
  "ativo": false,
  "nome": "Nortpool Furlani Junior",
  "cargo": "Diretor de Marketing",
  "evidencia": "nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-07-24"
 },
 "vinicius.nishide": {
  "ativo": true,
  "nome": "Vinicius Medice Nishide",
  "cargo": "Diretor Financeiro",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "rogerio.azbuy": {
  "ativo": true,
  "nome": "Rogerio Prado",
  "cargo": "Socio",
  "evidencia": "match por inferencia (unico 'Rogerio' em toda a base, incluindo desligados, e o login aponta para a AZ); consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "nort": {
  "ativo": false,
  "nome": "Nortpool Furlani Junior",
  "cargo": "Diretor de Marketing",
  "evidencia": "match por inferencia (mesmo aprovador de 'nort.furlani'; unica pessoa 'Nort*' na base); nao consta no organograma de ativos; get_employee_tenure (includeResigned=true) retorna resigned=true com resignationDate 2026-07-24"
 },
 "kamilly.silva": {
  "ativo": true,
  "nome": "Kamilly Silva",
  "cargo": "Analista Juridico JR I",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "lucas.fernandes": {
  "ativo": true,
  "nome": "Lucas de Sousa Fernandes",
  "cargo": "Analista Financeiro JR II",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "izabelly.machado": {
  "ativo": true,
  "nome": "Maria Izabelly Barbosa Machado",
  "cargo": "Estagiario Financeiro",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "joaovictor.esteves": {
  "ativo": true,
  "nome": "Joao Victor Tavares Esteves",
  "cargo": "Analista de RPA PL",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 },
 "luciano.cavalcante": {
  "ativo": true,
  "nome": "Luciano Pinheiro Cavalcante",
  "cargo": "Assistente de RPA Financeiro III",
  "evidencia": "consta em list_employees (organograma Gogroup, 444 ativos, consulta 18/09/2026) e get_employee_tenure nao o marca como resigned"
 }
};

// So devolve true quando ha EVIDENCIA de desligamento. Ausencia de dado nunca
// vira acusacao: o agente prefere nao sinalizar a sinalizar errado.
export function saiuDaEmpresa(login: string | null): boolean {
  if (!login) return false;
  return TEAMGUIDE[login]?.ativo === false;
}
export function situacao(login: string | null) {
  if (!login) return { ativo: "desconhecido" as SituacaoEmprego, nome: null, cargo: null, evidencia: "sem login" };
  return TEAMGUIDE[login] ?? { ativo: "desconhecido" as SituacaoEmprego, nome: null, cargo: null, evidencia: "login nao mapeado no Teamguide" };
}
