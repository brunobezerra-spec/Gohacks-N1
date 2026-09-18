// Nivel hierarquico de cada aprovador do GLPI, para checar alcada (Art. 7).
// Fonte: Teamguide, casado por nome. Logins nao encontrados ficam DESCONHECIDO
// e o agente nao acusa alcada insuficiente sem evidencia.
export const NIVEIS_APROVADORES: Record<string,string> = {
 "joao.conde": "GERENTE",
 "edivar": "GERENTE",
 "joaquim": "DIRETOR",
 "simony.morais": "DIRETOR",
 "luis": "SOCIO",
 "guilherme": "SOCIO",
 "andre.castro": "DIRETOR",
 "carla.alencar": "ANALISTA",
 "joao.simao": "GERENTE",
 "rafael.menezes": "DIRETOR",
 "silvia.scarabelot": "GERENTE",
 "laiza.garcia": "GERENTE",
 "natalia.pavao": "GERENTE",
 "samir.labib": "GERENTE",
 "murilo.guimaraes": "GERENTE",
 "antonio.mendes": "ANALISTA",
 "fernanda.alves": "DESCONHECIDO",
 "larissa.queiroz": "ANALISTA",
 "camila.mussim": "GERENTE",
 "juliana.bortoletto": "GERENTE",
 "wilian.mello": "GERENTE",
 "fernanda.gentil": "GERENTE",
 "cristianne.moura": "DESCONHECIDO",
 "rodrigo.cruz": "GERENTE",
 "jessica.park": "GERENTE",
 "lucas.guerra": "DESCONHECIDO",
 "marilia.dantas": "DESCONHECIDO",
 "antonelle.gomes": "DESCONHECIDO",
 "carmem.bianca": "DESCONHECIDO",
 "matheus": "ANALISTA",
 "joao.carlos": "COORDENADOR",
 "luisa": "GERENTE",
 "carlos.feitosa": "DESCONHECIDO",
 "anderson.matos": "DESCONHECIDO",
 "vitoria.azevedo": "COORDENADOR",
 "nort.furlani": "DESCONHECIDO",
 // Acrescentados em 18/09/2026 apos o teste do pedido 143038: constam no
 // Teamguide com cargo, mas estavam fora deste mapa, entao o Art. 7 nunca era
 // checado para eles. Eram 47 pendentes, R$ 2,65 mi -- inclusive o aprovador
 // do piloto, que e Diretor Financeiro.
 "vinicius.nishide": "DIRETOR",      // Diretor Financeiro
 "rogerio.azbuy": "SOCIO",           // Socio
 "kamilly.silva": "ANALISTA",        // Analista Juridico JR I
 "lucas.fernandes": "ANALISTA",      // Analista Financeiro JR II
 "izabelly.machado": "ANALISTA",     // Estagiario Financeiro
 "joaovictor.esteves": "ANALISTA",   // Analista de RPA PL
 "luciano.cavalcante": "ANALISTA"    // Assistente de RPA Financeiro III
};
