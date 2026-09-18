const pptxgen = require("pptxgenjs");
const P = new pptxgen();
P.layout = "LAYOUT_WIDE";            // 13.33 x 7.5 in
P.author = "Gogroup"; P.company = "Gogroup";
P.title  = "Goworker do Financeiro";

const AZUL="2659a5", LIMA="d7d900", VERM="e5381a", PINK="e61782",
      LARA="f8ae13", CIANO="3dbfef", BR="ffffff", OFF="f5f0e8",
      GRAF="12213a";
const F="Poppins", W=13.33, H=7.5;
const LOGO_AZ=process.env.HOME+"/.claude/skills/gogroup-brand/assets/logos/gogroup-wordmark-azul.png";
const LOGO_LI=process.env.HOME+"/.claude/skills/gogroup-brand/assets/logos/gogroup-wordmark-on-yellow.png";
const RR=(s)=>({shape:P.ShapeType.roundRect, rectRadius:s});

// tres pontos lima
function pontos(s,{x=.62,y=.6,c=LIMA,d=.13,g=.24}={}){
  for(let i=0;i<3;i++) s.addShape(P.ShapeType.ellipse,{x:x+i*g,y,w:d,h:d,fill:{color:c}});
}
function pilula(s,txt,{x,y,w,h=.36,fill=LIMA,color=AZUL,size=10}={}){
  s.addShape(P.ShapeType.roundRect,{x,y,w,h,rectRadius:.18,fill:{color:fill}});
  s.addText(txt,{x,y,w,h,fontFace:F,fontSize:size,bold:true,color,align:"center",
    valign:"middle",charSpacing:1.4});
}
// moldura de janela: borda lima por fora, slab azul por dentro
function molduraEscura(s){
  s.background={color:LIMA};
  s.addShape(P.ShapeType.roundRect,{x:.28,y:.28,w:W-.56,h:H-.56,rectRadius:.09,fill:{color:AZUL}});
}
// conteudo claro: off-white dentro de borda azul
function molduraClara(s){
  s.background={color:AZUL};
  s.addShape(P.ShapeType.roundRect,{x:.28,y:.28,w:W-.56,h:H-.56,rectRadius:.09,fill:{color:OFF}});
}
const logoClaro=(s)=>s.addImage({path:LOGO_AZ,x:W-2.06,y:H-.98,w:1.3,h:.333});
const logoEscuro=(s)=>{            // pilula lima + wordmark azul: o PNG "on-yellow"
  s.addShape(P.ShapeType.roundRect,  // do brandbook e um mockup de cartao, nao serve
    {x:W-2.50,y:H-1.05,w:1.74,h:.52,rectRadius:.26,fill:{color:LIMA}});
  s.addImage({path:LOGO_AZ,x:W-2.32,y:H-.97,w:1.38,h:.353});
};

/* ─────────────────────────── 1. CAPA ─────────────────────────── */
{
  const s=P.addSlide(); molduraEscura(s); pontos(s,{x:.78,y:.78});
  pilula(s,"HACKATHON 2026  ·  FINANCEIRO",{x:W-4.6,y:.72,w:3.8});

  s.addText("O financeiro não vai usar IA.",
    {x:1.0,y:2.05,w:11.3,h:.62,fontFace:F,fontSize:26,color:BR,align:"left"});
  s.addText("O financeiro vai virar IA.",
    {x:1.0,y:2.62,w:11.3,h:.9,fontFace:F,fontSize:40,bold:true,color:LIMA,align:"left"});

  s.addShape(P.ShapeType.roundRect,{x:1.0,y:3.9,w:.09,h:1.5,rectRadius:.04,fill:{color:LIMA}});
  s.addText("Goworker do Financeiro",
    {x:1.32,y:3.95,w:9,h:.62,fontFace:F,fontSize:30,bold:true,color:BR});
  s.addText("O primeiro funcionário de IA do fluxo de pagamentos",
    {x:1.34,y:4.58,w:10,h:.42,fontFace:F,fontSize:15,color:BR,charSpacing:.4});
  s.addText("NÃO É DASHBOARD.  NÃO É CHATBOT.  EXECUTA.",
    {x:1.34,y:5.02,w:10,h:.36,fontFace:F,fontSize:11,bold:true,color:LIMA,charSpacing:2});

  logoEscuro(s);
}

/* ────────────────────── 2. STATUS ATUAL ─────────────────────── */
{
  const s=P.addSlide(); molduraClara(s); pontos(s,{x:.78,y:.78});
  s.addText("Hoje o aprovador é a única peneira",
    {x:.95,y:1.18,w:11,h:.62,fontFace:F,fontSize:30,bold:true,color:AZUL});
  s.addText("Fila de aprovação de pagamentos no GoService  ·  medido em 18/09/2026",
    {x:.97,y:1.82,w:11,h:.34,fontFace:F,fontSize:13,color:GRAF});

  const cards=[
    {n:"1.058",  l:"pedidos esperando\naprovação",              c:AZUL},
    {n:"R$ 64,4 mi", l:"parados na fila\nde aprovação",         c:VERM},
    {n:"91 dias",l:"idade mediana de um\npedido na fila",       c:LARA},
    {n:"768",    l:"acima de 30 dias\n(Art. 11 exige controle)",c:PINK},
  ];
  cards.forEach((k,i)=>{
    const x=.95+i*2.92;
    s.addShape(P.ShapeType.roundRect,{x,y:2.45,w:2.66,h:2.25,rectRadius:.16,fill:{color:k.c}});
    s.addText(k.n,{x,y:2.72,w:2.66,h:.86,fontFace:F,fontSize:30,bold:true,color:BR,align:"center"});
    s.addText(k.l,{x:x+.16,y:3.58,w:2.34,h:.95,fontFace:F,fontSize:12,color:BR,align:"center",valign:"top",lineSpacing:16});
  });

  s.addShape(P.ShapeType.roundRect,{x:.95,y:5.12,w:11.43,h:1.0,rectRadius:.16,
    fill:{color:BR},line:{color:AZUL,width:1.5}});
  s.addText([
    {text:"Todo pedido chega igual na mesa do diretor.  ",options:{bold:true,color:AZUL}},
    {text:"Teste, duplicata, alçada errada e pagamento legítimo disputam a mesma atenção.",options:{color:GRAF}},
  ],{x:1.25,y:5.12,w:10.83,h:1.0,fontFace:F,fontSize:14,valign:"middle"});

  logoClaro(s);
}

/* ─────────── 3. HERO: O FLUXO (extremamente visual) ─────────── */
{
  const s=P.addSlide(); molduraClara(s); pontos(s,{x:.78,y:.7});
  s.addText("O Goworker é a peneira entre o pedido e o aprovador",
    {x:.95,y:1.0,w:11.4,h:.55,fontFace:F,fontSize:26,bold:true,color:AZUL});

  // --- SOLICITANTE
  s.addShape(P.ShapeType.roundRect,{x:.95,y:2.55,w:1.72,h:1.9,rectRadius:.16,
    fill:{color:BR},line:{color:AZUL,width:2}});
  s.addText("SOLICITANTE",{x:.95,y:2.78,w:1.72,h:.4,fontFace:F,fontSize:10.5,bold:true,
    color:AZUL,align:"center",charSpacing:.8});
  s.addText("pede um\npagamento",{x:.95,y:3.22,w:1.72,h:.8,fontFace:F,fontSize:11,
    color:GRAF,align:"center",lineSpacing:15});

  s.addShape(P.ShapeType.rightArrow,{x:2.78,y:3.32,w:.46,h:.34,fill:{color:LIMA}});

  // --- GOWORKER (nucleo)
  s.addShape(P.ShapeType.roundRect,{x:3.36,y:1.72,w:3.62,h:4.68,rectRadius:.18,fill:{color:AZUL}});
  s.addText("GOWORKER",{x:3.36,y:1.98,w:3.62,h:.42,fontFace:F,fontSize:15,bold:true,
    color:LIMA,align:"center",charSpacing:1.6});
  s.addText("lê, confronta e decide",{x:3.36,y:2.4,w:3.62,h:.3,fontFace:F,fontSize:10.5,
    color:BR,align:"center"});
  const passos=[
    ["1","Lê o pedido","fornecedor, CNPJ, valor,\nvencimento, centro de custo"],
    ["2","Confronta as regras","27 sinais ativos + Política\nCorporativa de Pagamentos"],
    ["3","Checa consistência","matriz e filial, duplicidade,\nalçada, aprovador ativo"],
  ];
  passos.forEach((p,i)=>{
    const y=2.80+i*1.18;
    s.addShape(P.ShapeType.roundRect,{x:3.6,y,w:3.14,h:1.06,rectRadius:.12,fill:{color:"1e4a8a"}});
    s.addShape(P.ShapeType.ellipse,{x:3.76,y:y+.17,w:.34,h:.34,fill:{color:LIMA}});
    s.addText(p[0],{x:3.76,y:y+.17,w:.34,h:.34,fontFace:F,fontSize:11,bold:true,color:AZUL,
      align:"center",valign:"middle"});
    s.addText(p[1],{x:4.2,y:y+.15,w:2.44,h:.32,fontFace:F,fontSize:11.5,bold:true,color:LIMA});
    s.addText(p[2],{x:4.2,y:y+.47,w:2.44,h:.56,fontFace:F,fontSize:9,color:BR,lineSpacing:11.5});
  });

  s.addShape(P.ShapeType.rightArrow,{x:7.1,y:3.32,w:.46,h:.34,fill:{color:LIMA}});

  // --- 4 DESTINOS
  s.addText("4 DESTINOS POSSÍVEIS",{x:7.72,y:1.5,w:4.6,h:.3,fontFace:F,fontSize:10,bold:true,
    color:AZUL,charSpacing:1.6});
  const dest=[
    {c:CIANO, t:"ENCAMINHAR",  d:"passa limpo para o aprovador decidir", n:"208", p:"20%", tc:AZUL},
    {c:LARA,  t:"RE-ROTEAR",   d:"alçada errada: manda para quem pode assinar", n:"128", p:"12%", tc:AZUL},
    {c:PINK,  t:"DEVOLVER",    d:"volta ao solicitante para corrigir", n:"16", p:"2%", tc:BR},
    {c:VERM,  t:"DESCARTAR",   d:"teste, fila zumbi e o que não vira pagamento", n:"706", p:"66%", tc:BR},
  ];
  dest.forEach((k,i)=>{
    const y=1.80+i*1.18;
    s.addShape(P.ShapeType.roundRect,{x:7.72,y,w:4.66,h:1.06,rectRadius:.14,fill:{color:k.c}});
    s.addText(k.t,{x:7.96,y:y+.12,w:2.7,h:.34,fontFace:F,fontSize:13,bold:true,color:k.tc,charSpacing:.6});
    s.addText(k.d,{x:7.96,y:y+.48,w:2.86,h:.52,fontFace:F,fontSize:9,color:k.tc,lineSpacing:11.5});
    s.addText(k.n,{x:10.86,y:y+.12,w:1.34,h:.52,fontFace:F,fontSize:21,bold:true,color:k.tc,align:"right"});
    s.addText(k.p+" da fila",{x:10.86,y:y+.64,w:1.34,h:.28,fontFace:F,fontSize:9,color:k.tc,align:"right"});
  });

  s.addText("Sozinho, sem pedir permissão a cada pedido. O Goworker nunca aprova nem recusa: isso continua com a alçada (Art. 4 e 7).",
    {x:.95,y:6.72,w:10.1,h:.3,fontFace:F,fontSize:10,italic:true,color:GRAF});

  logoClaro(s);
}

/* ──────────────────── 4. ANTES x DEPOIS ─────────────────────── */
{
  const s=P.addSlide(); molduraEscura(s); pontos(s,{x:.78,y:.72});
  s.addText("O que muda no GoService",
    {x:.95,y:1.05,w:11,h:.6,fontFace:F,fontSize:30,bold:true,color:LIMA});
  s.addText("Mesma fila de 1.058 pedidos, com e sem o Goworker",
    {x:.97,y:1.68,w:11,h:.32,fontFace:F,fontSize:13,color:BR});

  pilula(s,"ANTES",{x:3.62,y:2.3,w:2.2,h:.4,fill:"1e4a8a",color:BR,size:11});
  pilula(s,"DEPOIS",{x:6.6,y:2.3,w:5.78,h:.4,fill:LIMA,color:AZUL,size:11});

  const linhas=[
    ["Chegam à mesa do aprovador","1.058","208",   "−80%"],
    ["Valor que ele precisa olhar","R$ 64,4 mi","R$ 7,2 mi","−89%"],
    ["Triagem de cada pedido","manual","automática","minutos"],
    ["Alçada do Art. 7 conferida","não","209 fora da regra","R$ 15,0 mi"],
  ];
  linhas.forEach((l,i)=>{
    const y=2.86+i*.86;
    if(i%2===0) s.addShape(P.ShapeType.roundRect,{x:.95,y:y-.06,w:11.43,h:.78,rectRadius:.1,
      fill:{color:"1e4a8a"}});
    s.addText(l[0],{x:1.2,y,w:2.5,h:.66,fontFace:F,fontSize:12,color:BR,valign:"middle"});
    s.addText(l[1],{x:3.62,y,w:2.2,h:.66,fontFace:F,fontSize:15,color:"9db6dd",align:"center",valign:"middle"});
    s.addShape(P.ShapeType.rightArrow,{x:5.98,y:y+.26,w:.34,h:.22,fill:{color:LIMA}});
    s.addText(l[2],{x:6.6,y,w:3.2,h:.66,fontFace:F,fontSize:17,bold:true,color:LIMA,align:"center",valign:"middle"});
    s.addText(l[3],{x:9.9,y,w:2.36,h:.66,fontFace:F,fontSize:12,bold:true,color:BR,align:"center",valign:"middle"});
  });

  s.addShape(P.ShapeType.roundRect,{x:.95,y:6.28,w:9.6,h:.72,rectRadius:.14,fill:{color:LIMA}});
  s.addText([
    {text:"749 ações já escritas no GoService  ",options:{bold:true}},
    {text:"·  640 comentários, 109 encerramentos",options:{}},
  ],{x:.95,y:6.28,w:9.6,h:.72,fontFace:F,fontSize:13,color:AZUL,align:"center",valign:"middle"});

  logoEscuro(s);
}

/* ───────────── 5. RESULTADOS E PRÓXIMOS PASSOS ──────────────── */
{
  const s=P.addSlide(); molduraClara(s); pontos(s,{x:.78,y:.72});
  s.addText("Entregue, e o que vem depois",
    {x:.95,y:1.05,w:11,h:.6,fontFace:F,fontSize:30,bold:true,color:AZUL});

  // ENTREGUE
  s.addShape(P.ShapeType.roundRect,{x:.95,y:1.88,w:5.6,h:3.16,rectRadius:.16,fill:{color:AZUL}});
  pilula(s,"ENTREGUE",{x:1.22,y:2.12,w:1.9,h:.36,fill:LIMA,color:AZUL,size:10});
  const ent=[
    "POC pronta e validada em teste",
    "Agente rodando em produção, sozinho",
    "749 ações reais no GoService",
    "1 vaga congelada",
  ];
  ent.forEach((t,i)=>{
    const y=2.66+i*.56;
    s.addShape(P.ShapeType.ellipse,{x:1.26,y:y+.1,w:.14,h:.14,fill:{color:LIMA}});
    s.addText(t,{x:1.56,y,w:4.8,h:.4,fontFace:F,fontSize:13,color:BR,valign:"middle"});
  });

  // PRÓXIMOS PASSOS
  const prox=[
    {c:CIANO,tc:AZUL,t:"MELHORIA CONTÍNUA",d:"Ler o anexo do pedido: hoje o boleto e a nota\nficam fora do alcance do agente"},
    {c:LARA, tc:AZUL,t:"ESCALAR O MODELO",  d:"Goworkers iguais nas demais atividades\ndo financeiro: conciliação, cadastro, fiscal"},
  ];
  prox.forEach((k,i)=>{
    const y=1.88+i*1.64;
    s.addShape(P.ShapeType.roundRect,{x:6.78,y,w:5.6,h:1.46,rectRadius:.16,fill:{color:k.c}});
    s.addText(k.t,{x:7.06,y:y+.16,w:5,h:.34,fontFace:F,fontSize:12.5,bold:true,color:k.tc,charSpacing:.8});
    s.addText(k.d,{x:7.06,y:y+.54,w:5.06,h:.78,fontFace:F,fontSize:11,color:k.tc,lineSpacing:14});
  });
  s.addShape(P.ShapeType.roundRect,{x:6.78,y:5.16,w:5.6,h:1.46,rectRadius:.16,
    fill:{color:BR},line:{color:AZUL,width:2}});
  s.addText("O DESTINO",{x:7.06,y:5.32,w:5,h:.32,fontFace:F,fontSize:11,bold:true,color:AZUL,charSpacing:1.4});
  s.addText("Um financeiro IA First: pessoas decidem,\nagentes executam o caminho até a decisão.",
    {x:7.06,y:5.66,w:5.06,h:.8,fontFace:F,fontSize:12,bold:true,color:AZUL,lineSpacing:15});

  s.addShape(P.ShapeType.roundRect,{x:.95,y:5.16,w:5.6,h:1.46,rectRadius:.16,fill:{color:LIMA}});
  s.addText("196 h",{x:1.22,y:5.32,w:2.4,h:.66,fontFace:F,fontSize:30,bold:true,color:AZUL});
  s.addText("economizadas na fila atual,\ncom premissas declaradas e auditáveis",
    {x:1.24,y:5.98,w:5.1,h:.56,fontFace:F,fontSize:11,color:AZUL,lineSpacing:14});

  logoClaro(s);
}

P.writeFile({fileName:"/Users/bruno/.claude/jobs/7ad70897/tmp/deck/goworker.pptx"})
 .then(f=>console.log("OK",f));
