import type { Messages } from "./ja.ts";

/** フランス語（AI による翻訳・未確認） */
export const fr: Messages = {
  common: {
    next: "Suivant",
    back: "Retour",
    yes: "Oui",
    no: "Non",
    unknown: "Je ne sais pas",
    notApplicable: "Non concerné(e)",
    none: "Aucun",
    other: "Autre",
    redo: "Refaire ma réponse précédente",
    emergencyButton: "Je me sens soudain très mal",
    aiTranslationNotice: "Ce texte a été traduit par une IA (il n'a pas encore été vérifié par une personne).",
  },
  languageSelect: {
    title: "Veuillez choisir votre langue",
    selected: "Nous continuons en français",
  },
  start: {
    title: "Que pouvons-nous faire pour vous ?",
    haveProduct: "Je sais quel médicament je veux",
    haveProductHint: "Saisissez le nom du produit, ou prenez en photo l'écran de votre téléphone ou le produit",
    findBySymptom: "Chercher selon les symptômes",
    findBySymptomHint: "Nous vous poserons des questions sur votre état, une à la fois",
  },
  photoConsent: {
    title: "À propos de la photo",
    body: "La photo est envoyée à l'IA uniquement pour lire le texte. Elle n'est pas conservée. Veillez à ce que votre nom et les notifications du téléphone ne soient pas visibles.",
    agree: "Accepter et prendre la photo",
    decline: "Ne pas prendre de photo (saisir le nom)",
  },
  interview: {
    intro: "Nous allons vous poser des questions sur votre santé, une à la fois.",
    questions: {
      Q01: { text: "Quel âge avez-vous ?", unit: "ans" },
      Q02: {
        text: "Quel est votre sexe ?",
        options: { male: "Homme", female: "Femme", other: "Autre", noAnswer: "Je préfère ne pas répondre" },
      },
      Q03: {
        text: "Êtes-vous enceinte ?",
        options: { pregnant: "Je suis enceinte", maybe: "Je suis peut-être enceinte", notPregnant: "Je ne suis pas enceinte", notApplicable: "Non concernée" },
      },
      Q03a: { text: "La date prévue de l'accouchement est-elle dans 12 semaines ou moins ?" },
      Q04: { text: "Allaitez-vous ?" },
      Q05: { text: "Quel est votre poids ?", unit: "kg" },
      Q06: { text: "Avez-vous déjà eu de l'asthme ?" },
      Q07: {
        text: "Êtes-vous soigné(e) pour une maladie ? (Plusieurs choix possibles)",
        options: {
          stomachUlcer: "Ulcère de l'estomac",
          liver: "Maladie du foie",
          kidney: "Maladie des reins",
          heart: "Maladie du cœur",
          hypertension: "Hypertension",
          glaucoma: "Glaucome",
          dialysis: "Dialyse",
        },
      },
      Q08: {
        text: "Avez-vous déjà eu une allergie (éruption cutanée, difficulté à respirer, etc.) à un médicament ?",
        drugNameLabel: "Nom du médicament",
      },
      Q09: {
        text: "Prenez-vous des médicaments en ce moment ? (Plusieurs choix possibles)",
        options: {
          coldMedicine: "Médicament contre le rhume",
          painReliever: "Médicament contre la fièvre ou la douleur",
          antihistamine: "Médicament contre l'allergie ou pour le nez",
          kampo: "Kampo (médecine japonaise à base de plantes)",
          prescription: "Médicament prescrit par un médecin (montrez votre carnet de médicaments si vous en avez un)",
        },
        drugNameLabel: "Nom du médicament",
      },
      Q10: { text: "Allez-vous conduire une voiture ou une moto après avoir pris le médicament ?" },
      Q11: { text: "Allez-vous boire de l'alcool avant ou après avoir pris le médicament ?" },
      Q12: { text: "Pendant combien de jours environ comptez-vous le prendre ?", unit: "jours" },
      Q13: { text: "Portez-vous des lentilles de contact souples ?" },
      Q14: {
        text: "Où allez-vous coller le patch ?",
        options: { body: "Cou, épaules, bas du dos, etc.", nearEyes: "Autour des yeux, ou près de la bouche ou du nez", skinProblem: "Sur un eczéma, une irritation ou une plaie" },
      },
      R01: { text: "Avez-vous récemment acheté un médicament similaire dans un autre magasin ?" },
      R02: {
        text: "Combien souhaitez-vous en acheter ?",
        options: { smallOne: "Une petite boîte", largeOne: "Une grande boîte", multiple: "Deux ou plus" },
      },
      R03: { text: "Dites-nous pourquoi vous avez besoin d'une grande boîte ou de deux ou plus." },
      R04: { text: "Pour quels symptômes allez-vous l'utiliser ?" },
    },
    notUnderstood: "Désolé, nous n'avons pas compris votre réponse. Veuillez répondre à nouveau.",
    done: "C'est la fin des questions. Un pharmacien va vérifier vos réponses. Veuillez patienter un instant.",
  },
  emergency: {
    title: "Appelez une ambulance maintenant",
    body: "Vos symptômes nécessitent peut-être un examen à l'hôpital tout de suite.",
    call119: "Appelez le 119 et dites d'abord « Kyukyu desu » (c'est une urgence).",
    staffHelp: "Notre personnel va vous aider tout de suite. Montrez cet écran à un membre du personnel.",
    consultLine: "Si vous hésitez à appeler une ambulance, vous pouvez contacter une ligne de conseil d'urgence (#7119, etc. ; le numéro dépend de la région).",
    childLine: "Pour un conseil concernant un enfant les jours fériés ou la nuit, appelez le #8000.",
  },
  emergencyFollowUp: {
    intro: "Voici des questions du pharmacien. Choisissez la réponse qui correspond.",
    questions: {
      EF01: { text: "Le symptôme a-t-il commencé soudainement ?" },
      EF02: {
        text: "Depuis quand ?",
        options: { minutes: "Il y a quelques minutes", withinHour: "Depuis moins d'une heure", today: "Aujourd'hui", yesterdayOrEarlier: "Hier ou avant" },
      },
      EF03: { text: "Est-ce que cela continue encore ?" },
      EF04: { text: "Est-ce que cela s'aggrave ?" },
      EF05: { text: "Est-ce le pire que vous ayez jamais ressenti ?" },
      EF06: { text: "Avez-vous du mal à respirer ?" },
      EF07: { text: "Avez-vous des sueurs froides ou des nausées ?" },
      EF08: { text: "Avez-vous déjà eu le même symptôme ?" },
      EF09: { text: "Pouvez-vous marcher sans aide ?" },
    },
    scale: { text: "Choisissez de 0 à 10 à quel point vous vous sentez mal maintenant.", min: "0 : aucune gêne", max: "10 : le pire imaginable" },
  },
  pharmacist: {
    waiting: "Un pharmacien vérifie vos réponses. Veuillez patienter un instant.",
    notForSale: "Nous sommes désolés. Dans votre état actuel, nous ne pouvons pas vous proposer de médicament sans ordonnance. Nous vous conseillons de consulter un médecin à l'hôpital ou dans une clinique.",
  },
  guidance: {
    title: "À propos de votre médicament",
    printed: "Nous avons imprimé les instructions. Nous vous remettons aussi la notice originale en japonais.",
    understandQuestion: "Avez-vous compris l'explication ?",
    understandOptions: { understood: "Oui, j'ai compris", partly: "Certaines parties ne sont pas claires", notUnderstood: "Non, je n'ai pas compris" },
    askAgain: "Le pharmacien va réexpliquer les parties qui ne sont pas claires.",
  },
  feedback: {
    title: "Merci de votre coopération",
    question: "L'explication d'aujourd'hui était-elle facile à comprendre ?",
    options: { good: "Facile à comprendre", fair: "Moyennement", poor: "Difficile à comprendre" },
  },
  checkout: {
    title: "Paiement",
    body: "Veuillez payer à la caisse. Prenez soin de vous.",
  },
};
