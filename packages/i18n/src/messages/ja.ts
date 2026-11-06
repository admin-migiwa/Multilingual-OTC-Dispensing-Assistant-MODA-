/**
 * 患者さんの画面に出す定型文（日本語・原文）。
 *
 * ほかの言語はこの形にそろえて訳す。キーを足したら、すべての言語に足す（型で止まる）。
 * 問診の項目 ID（Q01 など）は docs/demo-data/interview-items.md と同じ。
 * 緊急案内の内容は docs/demo-data/emergency.md（EN01〜EN03）に合わせる。
 */
export const ja = {
  common: {
    next: "次へ",
    back: "戻る",
    yes: "はい",
    no: "いいえ",
    unknown: "わからない",
    notApplicable: "該当しない",
    none: "なし",
    other: "その他",
    redo: "前の答えをやり直す",
    emergencyButton: "具合が急に悪くなった",
    aiTranslationNotice: "この文は AI が翻訳したものです（まだ人が確認していません）。",
    networkError: "通信が止まりました。スタッフがすぐにお手伝いします。",
    retry: "もう一度試す",
  },
  languageSelect: {
    title: "言語を選んでください",
    selected: "日本語で続けます",
  },
  start: {
    title: "どうしましたか？",
    haveProduct: "ほしい薬がある",
    haveProductHint: "商品名を入れる、またはスマホの画面や商品を撮影します",
    findBySymptom: "症状から探す",
    findBySymptomHint: "体の具合を、1つずつ質問します",
    searchPlaceholder: "商品名を入れてください（スマホの画面の名前でも大丈夫です）",
    noMatch: "見つかりませんでした。スマホの画面をスタッフに見せてください。",
    symptomPrompt: "どんな症状ですか？",
    chooseDrug: "この薬にする",
    changeDrug: "別の薬を選び直す",
  },
  photoConsent: {
    title: "写真について",
    body: "写真は、文字を読むためだけに AI に送ります。写真は保存しません。名前やスマホの通知などが写らないように撮ってください。",
    agree: "同意して撮影する",
    decline: "撮影しない（名前を入力する）",
  },
  interview: {
    intro: "体の状態について、1つずつ質問します。",
    questions: {
      Q01: { text: "年齢を教えてください。", unit: "歳" },
      Q02: {
        text: "性別を教えてください。",
        options: { male: "男性", female: "女性", other: "その他", noAnswer: "答えない" },
      },
      Q03: {
        text: "妊娠していますか？",
        options: { pregnant: "妊娠している", maybe: "妊娠しているかもしれない", notPregnant: "していない", notApplicable: "該当しない" },
      },
      Q03a: { text: "出産予定日まで12週以内ですか？" },
      Q04: { text: "授乳中ですか？" },
      Q05: { text: "体重を教えてください。", unit: "kg" },
      Q06: { text: "ぜんそくを起こしたことがありますか？" },
      Q07: {
        text: "治療中の病気はありますか？（いくつでも選べます）",
        options: {
          stomachUlcer: "胃潰瘍",
          liver: "肝臓の病気",
          kidney: "腎臓の病気",
          heart: "心臓の病気",
          hypertension: "高血圧",
          glaucoma: "緑内障",
          dialysis: "透析を受けている",
        },
      },
      Q08: {
        text: "薬でアレルギー（発疹・息苦しさなど）が出たことはありますか？",
        drugNameLabel: "その薬の名前",
      },
      Q09: {
        text: "いま飲んでいる薬はありますか？（いくつでも選べます）",
        options: {
          coldMedicine: "かぜ薬",
          painReliever: "解熱鎮痛薬（熱や痛みの薬）",
          antihistamine: "アレルギー・鼻炎の薬",
          kampo: "漢方",
          prescription: "病院で出された薬（お薬手帳があれば見せてください）",
        },
        drugNameLabel: "薬の名前",
      },
      Q10: { text: "薬を飲んだあとに、車やバイクを運転する予定はありますか？" },
      Q11: { text: "薬を飲む前後に、お酒を飲む予定はありますか？" },
      Q12: { text: "何日くらい飲む予定ですか？", unit: "日" },
      Q13: { text: "ソフトコンタクトレンズをつけていますか？" },
      Q14: {
        text: "どこに貼りますか？",
        options: { body: "首・肩・腰など", nearEyes: "目の周り・口や鼻の近く", skinProblem: "湿疹・かぶれ・傷がある場所" },
      },
      R01: { text: "ほかのお店で、同じような薬を最近買いましたか？" },
      R02: {
        text: "いくつ買いたいですか？",
        options: { smallOne: "小さい箱を1つ", largeOne: "大きい箱を1つ", multiple: "2つ以上" },
      },
      R03: { text: "大きい箱や2つ以上が必要な理由を教えてください。" },
      R04: { text: "どんな症状に使いますか？" },
    },
    notUnderstood: "すみません、うまく受け取れませんでした。もう一度お答えください。",
    done: "質問は以上です。薬剤師が確認しますので、少しお待ちください。",
  },
  emergency: {
    title: "すぐに救急車を呼んでください",
    body: "あなたの症状は、すぐに病院で診てもらう必要があるかもしれません。",
    call119: "119番に電話して、最初に「救急です」と伝えてください。",
    staffHelp: "スタッフがすぐにお手伝いします。この画面をスタッフに見せてください。",
    consultLine: "救急車を呼ぶか迷うときは、救急相談窓口（#7119 など。地域によって番号が違います）に相談できます。",
    childLine: "子どもの休日・夜間の相談は #8000 です。",
    visitorHotline: "旅行で日本に来た方は、日本政府観光局（JNTO）の「Japan Visitor Hotline」050-3816-2787 に相談できます（24時間・年中無休。英語・中国語・韓国語。病気やけがなどの非常時の支援）。",
  },
  emergencyFollowUp: {
    intro: "薬剤師からの質問です。あてはまるものを選んでください。",
    questions: {
      EF01: { text: "その症状は突然始まりましたか？" },
      EF02: {
        text: "いつからですか？",
        options: { minutes: "数分前", withinHour: "1時間以内", today: "今日", yesterdayOrEarlier: "昨日以前" },
      },
      EF03: { text: "今も続いていますか？" },
      EF04: { text: "だんだん強くなっていますか？" },
      EF05: { text: "今までで一番つらいですか？" },
      EF06: { text: "息苦しさはありますか？" },
      EF07: { text: "冷や汗や吐き気はありますか？" },
      EF08: { text: "前にも同じ症状がありましたか？" },
      EF09: { text: "自分で歩けますか？" },
    },
    scale: { text: "今のつらさを、0から10の数字で選んでください。", min: "0：つらくない", max: "10：考えられる中でいちばんつらい" },
  },
  pharmacist: {
    waiting: "薬剤師が内容を確認しています。少しお待ちください。",
    notForSale: "申し訳ありません。今の状態では、お店の薬（市販薬）ではお応えできません。病院や診療所での受診をおすすめします。",
  },
  guidance: {
    title: "お薬の説明",
    printed: "説明書を印刷しました。日本語の説明書も一緒にお渡しします。",
    understandQuestion: "説明はわかりましたか？",
    understandOptions: { understood: "わかった", partly: "少しわからないところがある", notUnderstood: "わからなかった" },
    askAgain: "わからないところは、薬剤師がもう一度説明します。",
  },
  feedback: {
    title: "ご協力ありがとうございました",
    question: "今日の説明はわかりやすかったですか？",
    options: { good: "わかりやすかった", fair: "ふつう", poor: "わかりにくかった" },
  },
  checkout: {
    title: "お会計",
    body: "レジでお会計をお願いします。お大事にどうぞ。",
  },
};

/** 定型文の形。すべての言語がこの形にそろう。 */
export type Messages = typeof ja;
