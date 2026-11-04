import type { Messages } from "./ja.ts";

/** ポルトガル語（ブラジル）（AI による翻訳・未確認） */
export const pt: Messages = {
  common: {
    next: "Próximo",
    back: "Voltar",
    yes: "Sim",
    no: "Não",
    unknown: "Não sei",
    notApplicable: "Não se aplica",
    none: "Nenhum",
    other: "Outro",
    redo: "Refazer a resposta anterior",
    emergencyButton: "De repente estou me sentindo muito mal",
    aiTranslationNotice: "Este texto foi traduzido por IA (ainda não foi revisado por uma pessoa).",
  },
  languageSelect: {
    title: "Escolha o seu idioma",
    selected: "Vamos continuar em português",
  },
  start: {
    title: "Como podemos ajudar?",
    haveProduct: "Sei qual remédio quero",
    haveProductHint: "Digite o nome do produto, ou tire uma foto da tela do celular ou do produto",
    findBySymptom: "Procurar pelos sintomas",
    findBySymptomHint: "Vamos perguntar como você está, uma pergunta por vez",
  },
  photoConsent: {
    title: "Sobre a foto",
    body: "A foto é enviada à IA apenas para ler o texto. A foto não é guardada. Cuide para que seu nome e as notificações do celular não apareçam.",
    agree: "Concordar e tirar a foto",
    decline: "Não tirar foto (digitar o nome)",
  },
  interview: {
    intro: "Vamos fazer perguntas sobre a sua saúde, uma por vez.",
    questions: {
      Q01: { text: "Qual é a sua idade?", unit: "anos" },
      Q02: {
        text: "Qual é o seu sexo?",
        options: { male: "Masculino", female: "Feminino", other: "Outro", noAnswer: "Prefiro não responder" },
      },
      Q03: {
        text: "Você está grávida?",
        options: { pregnant: "Estou grávida", maybe: "Posso estar grávida", notPregnant: "Não estou grávida", notApplicable: "Não se aplica" },
      },
      Q03a: { text: "Faltam 12 semanas ou menos para a data prevista do parto?" },
      Q04: { text: "Você está amamentando?" },
      Q05: { text: "Qual é o seu peso?", unit: "kg" },
      Q06: { text: "Você já teve asma?" },
      Q07: {
        text: "Você está em tratamento de alguma doença? (Pode escolher várias)",
        options: {
          stomachUlcer: "Úlcera no estômago",
          liver: "Doença do fígado",
          kidney: "Doença dos rins",
          heart: "Doença do coração",
          hypertension: "Pressão alta",
          glaucoma: "Glaucoma",
          dialysis: "Faz diálise",
        },
      },
      Q08: {
        text: "Você já teve alergia (manchas na pele, falta de ar etc.) a algum remédio?",
        drugNameLabel: "Nome do remédio",
      },
      Q09: {
        text: "Você está tomando algum remédio agora? (Pode escolher vários)",
        options: {
          coldMedicine: "Remédio para gripe ou resfriado",
          painReliever: "Remédio para febre ou dor",
          antihistamine: "Remédio para alergia ou nariz",
          kampo: "Kampo (medicina herbal japonesa)",
          prescription: "Remédio receitado pelo médico (mostre sua caderneta de medicamentos, se tiver)",
        },
        drugNameLabel: "Nome do remédio",
      },
      Q10: { text: "Você vai dirigir carro ou moto depois de tomar o remédio?" },
      Q11: { text: "Você vai beber álcool antes ou depois de tomar o remédio?" },
      Q12: { text: "Por quantos dias, mais ou menos, pretende tomar?", unit: "dias" },
      Q13: { text: "Você usa lentes de contato gelatinosas?" },
      Q14: {
        text: "Onde você vai colar o adesivo?",
        options: { body: "Pescoço, ombros, lombar etc.", nearEyes: "Ao redor dos olhos ou perto da boca ou do nariz", skinProblem: "Em eczema, irritação ou ferida" },
      },
      R01: { text: "Você comprou recentemente um remédio parecido em outra loja?" },
      R02: {
        text: "Quantos você quer comprar?",
        options: { smallOne: "Uma caixa pequena", largeOne: "Uma caixa grande", multiple: "Duas ou mais" },
      },
      R03: { text: "Diga por que você precisa de uma caixa grande ou de duas ou mais." },
      R04: { text: "Para quais sintomas você vai usar?" },
    },
    notUnderstood: "Desculpe, não conseguimos entender a sua resposta. Responda novamente, por favor.",
    done: "Essas são todas as perguntas. Um farmacêutico vai verificar as suas respostas. Aguarde um momento, por favor.",
  },
  emergency: {
    title: "Chame uma ambulância agora",
    body: "Os seus sintomas podem precisar de atendimento no hospital imediatamente.",
    call119: "Ligue para o 119 e diga primeiro \"Kyukyu desu\" (é uma emergência).",
    staffHelp: "Nossa equipe vai ajudar você agora. Mostre esta tela a um funcionário.",
    consultLine: "Se não tiver certeza se deve chamar uma ambulância, você pode ligar para uma linha de consulta de emergência (#7119 etc.; o número muda conforme a região).",
    childLine: "Para dúvidas sobre crianças em feriados ou à noite, ligue para #8000.",
  },
  pharmacist: {
    waiting: "Um farmacêutico está verificando as suas respostas. Aguarde um momento, por favor.",
    notForSale: "Sentimos muito. No seu estado atual, não podemos oferecer um remédio sem receita. Recomendamos que consulte um médico em um hospital ou clínica.",
  },
  guidance: {
    title: "Sobre o seu remédio",
    printed: "Imprimimos as instruções. Também vamos entregar a bula original em japonês.",
    understandQuestion: "Você entendeu a explicação?",
    understandOptions: { understood: "Sim, entendi", partly: "Algumas partes não ficaram claras", notUnderstood: "Não entendi" },
    askAgain: "O farmacêutico vai explicar de novo as partes que não ficaram claras.",
  },
  feedback: {
    title: "Obrigado pela colaboração",
    question: "A explicação de hoje foi fácil de entender?",
    options: { good: "Fácil de entender", fair: "Mais ou menos", poor: "Difícil de entender" },
  },
  checkout: {
    title: "Pagamento",
    body: "Por favor, pague no caixa. Melhoras!",
  },
};
