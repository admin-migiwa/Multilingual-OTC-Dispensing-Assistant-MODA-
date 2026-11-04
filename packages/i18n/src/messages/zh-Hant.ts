import type { Messages } from "./ja.ts";

/** 中国語（繁体）（AI による翻訳・未確認） */
export const zhHant: Messages = {
  common: {
    next: "下一步",
    back: "返回",
    yes: "是",
    no: "否",
    unknown: "不知道",
    notApplicable: "不適用",
    none: "無",
    other: "其他",
    redo: "重新回答上一題",
    emergencyButton: "突然感到非常不舒服",
    aiTranslationNotice: "本文由 AI 翻譯（尚未經過人工確認）。",
  },
  languageSelect: {
    title: "請選擇語言",
    selected: "將使用繁體中文繼續",
  },
  start: {
    title: "請問有什麼需要？",
    haveProduct: "我有想買的藥",
    haveProductHint: "輸入商品名稱，或拍攝手機畫面或商品",
    findBySymptom: "依症狀找藥",
    findBySymptomHint: "我們會逐一詢問您的身體狀況",
  },
  photoConsent: {
    title: "關於照片",
    body: "照片僅用於讓 AI 讀取上面的文字，不會保存。拍攝時請注意不要拍到姓名或手機通知等資訊。",
    agree: "同意並拍攝",
    decline: "不拍攝（輸入名稱）",
  },
  interview: {
    intro: "我們將逐一詢問您的身體狀況。",
    questions: {
      Q01: { text: "請告訴我們您的年齡。", unit: "歲" },
      Q02: {
        text: "請告訴我們您的性別。",
        options: { male: "男性", female: "女性", other: "其他", noAnswer: "不願回答" },
      },
      Q03: {
        text: "您是否懷孕？",
        options: { pregnant: "已懷孕", maybe: "可能懷孕", notPregnant: "沒有懷孕", notApplicable: "不適用" },
      },
      Q03a: { text: "距離預產期是否在12週以內？" },
      Q04: { text: "您是否正在哺乳？" },
      Q05: { text: "請告訴我們您的體重。", unit: "kg" },
      Q06: { text: "您是否曾經發作過氣喘？" },
      Q07: {
        text: "您是否有正在治療的疾病？（可複選）",
        options: {
          stomachUlcer: "胃潰瘍",
          liver: "肝臟疾病",
          kidney: "腎臟疾病",
          heart: "心臟疾病",
          hypertension: "高血壓",
          glaucoma: "青光眼",
          dialysis: "正在接受透析",
        },
      },
      Q08: {
        text: "您是否曾因藥物出現過敏（皮疹、呼吸困難等）？",
        drugNameLabel: "藥物名稱",
      },
      Q09: {
        text: "您現在是否正在服用藥物？（可複選）",
        options: {
          coldMedicine: "感冒藥",
          painReliever: "退燒止痛藥",
          antihistamine: "過敏或鼻炎藥",
          kampo: "漢方藥",
          prescription: "醫院開的藥（如有用藥手冊請出示）",
        },
        drugNameLabel: "藥物名稱",
      },
      Q10: { text: "服藥後是否打算駕駛汽車或機車？" },
      Q11: { text: "服藥前後是否打算飲酒？" },
      Q12: { text: "大約打算服用幾天？", unit: "天" },
      Q13: { text: "您是否配戴軟式隱形眼鏡？" },
      Q14: {
        text: "您打算貼在哪裡？",
        options: { body: "頸部、肩部、腰部等", nearEyes: "眼睛周圍、口鼻附近", skinProblem: "有濕疹、皮膚炎或傷口的部位" },
      },
      R01: { text: "您最近是否在其他店購買過類似的藥？" },
      R02: {
        text: "您想購買幾盒？",
        options: { smallOne: "小盒1盒", largeOne: "大盒1盒", multiple: "2盒以上" },
      },
      R03: { text: "請告訴我們需要大盒或2盒以上的原因。" },
      R04: { text: "您打算用於什麼症狀？" },
    },
    notUnderstood: "抱歉，我們沒能理解您的回答。請再回答一次。",
    done: "問題到此結束。藥劑師將進行確認，請稍候。",
  },
  emergency: {
    title: "請立即呼叫救護車",
    body: "您的症狀可能需要馬上到醫院就診。",
    call119: "請撥打119，並首先說「急救です（kyukyu desu）」（是急救）。",
    staffHelp: "工作人員會馬上為您提供協助。請把這個畫面給工作人員看。",
    consultLine: "如果不確定是否需要叫救護車，可以撥打急救諮詢電話（#7119 等，號碼依地區而異）。",
    childLine: "兒童在假日或夜間的諮詢電話是 #8000。",
  },
  pharmacist: {
    waiting: "藥劑師正在確認內容，請稍候。",
    notForSale: "非常抱歉。以您目前的狀況，本店的成藥無法滿足您的需要。建議您到醫院或診所就診。",
  },
  guidance: {
    title: "用藥說明",
    printed: "說明書已列印。我們也會一併提供日文原版說明書。",
    understandQuestion: "您理解說明了嗎？",
    understandOptions: { understood: "理解了", partly: "有些地方不太明白", notUnderstood: "沒有理解" },
    askAgain: "不明白的地方，藥劑師會再為您說明。",
  },
  feedback: {
    title: "感謝您的配合",
    question: "今天的說明容易理解嗎？",
    options: { good: "容易理解", fair: "普通", poor: "不易理解" },
  },
  checkout: {
    title: "結帳",
    body: "請到收銀台結帳。祝您早日康復。",
  },
};
