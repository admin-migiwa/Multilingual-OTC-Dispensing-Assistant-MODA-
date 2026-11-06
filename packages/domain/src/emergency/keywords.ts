/**
 * 緊急症状のキーワード辞書（docs/demo-data/emergency.md の ☑ の行だけ）。
 *
 * - 日本語（ja）は emergency.md の「キーワード（日本語の例）」と、その書き方の違い（漢字・ひらがな、
 *   「痛い／痛む」など語尾の違い）だけを入れている。表にない症状は足さない。
 *   カタカナは照合のときにひらがなとみなすので、ここには書かない。
 * - 日本語以外の8言語は、日本語のキーワードを AI で訳したもの（**AI の訳・未確認**）。
 *   人が確認するまでは EMERGENCY_KEYWORD_TRANSLATION で "ai_unreviewed" としておく。
 * - 見落とさないことを優先する（言い過ぎで止まった場合は、薬剤師がその場で問診に戻せる）。
 * - 照合は「文の中にキーワードが含まれるか」で行う。そのため、語尾が変わっても拾えるように
 *   「胸が痛」のように語の前半だけを書いているものがある。
 *
 * 言語コードは packages/i18n の LANGUAGES と同じ文字列。domain は外部に依存させないため、
 * i18n を読み込まずにここで同じ一覧を持つ（9言語そろっていないと型で止まる）。
 */

export const EMERGENCY_KEYWORD_LANGUAGES = ["ja", "en", "zh-Hans", "zh-Hant", "ko", "es", "pt", "fr", "vi"] as const;

export type EmergencyKeywordLanguage = (typeof EMERGENCY_KEYWORD_LANGUAGES)[number];

export type KeywordsByLanguage = Readonly<Record<EmergencyKeywordLanguage, readonly string[]>>;

/** キーワードの出どころ。original は日本語の原文、ai_unreviewed は AI の訳で人が未確認。 */
export const EMERGENCY_KEYWORD_TRANSLATION: Readonly<Record<EmergencyKeywordLanguage, "original" | "ai_unreviewed">> = {
  ja: "original",
  en: "ai_unreviewed",
  "zh-Hans": "ai_unreviewed",
  "zh-Hant": "ai_unreviewed",
  ko: "ai_unreviewed",
  es: "ai_unreviewed",
  pt: "ai_unreviewed",
  fr: "ai_unreviewed",
  vi: "ai_unreviewed",
};

export interface EmergencyRule {
  /** emergency.md の ID（EA01〜EA24、EC01〜EC08） */
  readonly id: string;
  /** adult：おとな（年齢にかかわらず使う）／child：こども（15歳以下のときだけ使う） */
  readonly audience: "adult" | "child";
  /** 薬剤師向けの日本語の説明（emergency.md の「資料の症状」） */
  readonly labelJa: string;
  /** どれか1つが文に含まれたら当てはまる */
  readonly keywords: KeywordsByLanguage;
  /**
   * これがあるときは、keywords に加えて、こちらのどれか1つも含まれたときだけ当てはまる。
   * EA08「突然の高熱」で使う（ただの高熱では緊急にしない：決定8・11/4 薬剤師の判断）。
   */
  readonly alsoRequires?: KeywordsByLanguage;
}

const NONE: KeywordsByLanguage = { ja: [], en: [], "zh-Hans": [], "zh-Hant": [], ko: [], es: [], pt: [], fr: [], vi: [] };

export const EMERGENCY_RULES: readonly EmergencyRule[] = [
  // ───────── おとな（16歳以上。こどもにも使う） ─────────
  {
    id: "EA01",
    audience: "adult",
    labelJa: "顔半分が動きにくい、またはしびれる",
    keywords: {
      ja: ["顔が動かない", "顔の片側", "顔がしびれ", "顔が痺れ"],
      en: ["face won't move", "can't move my face", "one side of my face", "face is numb", "face numb", "facial numbness"],
      "zh-Hans": ["脸动不了", "半边脸", "脸麻", "面部麻木"],
      "zh-Hant": ["臉動不了", "半邊臉", "臉麻", "面部麻木"],
      ko: ["얼굴이 안 움직", "얼굴 한쪽", "얼굴이 저려", "얼굴이 마비"],
      es: ["no puedo mover la cara", "un lado de la cara", "cara dormida", "cara entumecida", "adormecimiento de la cara"],
      pt: ["não consigo mexer o rosto", "um lado do rosto", "rosto dormente", "dormência no rosto"],
      fr: ["visage ne bouge", "un côté du visage", "visage engourdi", "engourdissement du visage"],
      vi: ["mặt không cử động", "một bên mặt", "tê mặt", "mặt bị tê"],
    },
  },
  {
    id: "EA02",
    audience: "adult",
    labelJa: "ニッコリ笑うと口や顔の片方がゆがむ",
    keywords: {
      ja: ["口がゆがむ", "口が歪む", "顔がゆがむ", "顔が歪む", "口がゆがん", "顔がゆがん"],
      en: ["mouth droop", "face droop", "droopy face", "crooked mouth", "crooked face", "mouth is crooked", "face is crooked"],
      "zh-Hans": ["嘴歪", "脸歪", "口角歪斜"],
      "zh-Hant": ["嘴歪", "臉歪", "口角歪斜"],
      ko: ["입이 돌아", "입이 비뚤", "얼굴이 비뚤", "얼굴이 일그러"],
      es: ["boca torcida", "cara torcida", "boca caída", "cara caída"],
      pt: ["boca torta", "rosto torto", "boca caída", "rosto caído"],
      fr: ["bouche déformée", "visage déformé", "bouche tordue", "visage tordu", "bouche tombante"],
      vi: ["méo miệng", "miệng bị méo", "méo mặt", "mặt bị méo", "lệch mặt"],
    },
  },
  {
    id: "EA03",
    audience: "adult",
    labelJa: "ろれつがまわりにくく、うまく話せない",
    keywords: {
      ja: ["ろれつ", "呂律", "うまく話せない", "上手く話せない", "言葉が出ない", "言葉がでない"],
      en: ["slurred speech", "slurring", "can't speak properly", "cannot speak properly", "can't talk properly", "trouble speaking", "can't get words out", "words won't come out"],
      "zh-Hans": ["口齿不清", "说话不清", "说不出话", "说话困难"],
      "zh-Hant": ["口齒不清", "說話不清", "說不出話", "說話困難"],
      ko: ["발음이 꼬", "말이 어눌", "말을 잘 못", "말이 안 나와", "말이 나오지 않"],
      es: ["no puedo hablar bien", "habla arrastrada", "arrastro las palabras", "no me salen las palabras", "dificultad para hablar"],
      pt: ["fala arrastada", "não consigo falar direito", "as palavras não saem", "dificuldade para falar", "dificuldade de falar"],
      fr: ["élocution difficile", "je n'arrive pas à parler", "difficulté à parler", "les mots ne sortent pas", "parole pâteuse"],
      vi: ["nói ngọng", "nói líu lưỡi", "nói không rõ", "không nói được", "khó nói"],
    },
  },
  {
    id: "EA04",
    audience: "adult",
    labelJa: "見える範囲が狭くなる",
    keywords: {
      ja: ["見える範囲が狭", "視野が欠け", "視野がかけ"],
      en: ["vision is narrow", "narrowed vision", "narrow vision", "part of my vision", "visual field"],
      "zh-Hans": ["视野变窄", "视野缺损", "看到的范围变小"],
      "zh-Hant": ["視野變窄", "視野缺損", "看到的範圍變小"],
      ko: ["시야가 좁아", "시야가 가려", "시야 결손", "보이는 범위가 좁"],
      es: ["campo de visión reducido", "parte de la visión", "visión reducida", "pérdida de visión"],
      pt: ["campo de visão reduzido", "parte da visão", "visão reduzida", "perda de visão"],
      fr: ["champ de vision réduit", "champ visuel", "vision réduite", "perte de vision"],
      vi: ["tầm nhìn bị thu hẹp", "thu hẹp tầm nhìn", "mất một phần tầm nhìn", "nhìn bị hẹp"],
    },
  },
  {
    id: "EA05",
    audience: "adult",
    labelJa: "突然、周りが二重に見える",
    keywords: {
      ja: ["二重に見え", "だぶって見え", "ダブって見え"],
      en: ["double vision", "seeing double", "see double"],
      "zh-Hans": ["重影", "复视", "看东西是双的"],
      "zh-Hant": ["重影", "複視", "看東西是雙的"],
      ko: ["두 개로 보", "겹쳐 보", "복시"],
      es: ["visión doble", "veo doble"],
      pt: ["visão dupla", "vista dupla", "vendo duplo", "vejo duplo"],
      fr: ["vision double", "vois double"],
      vi: ["nhìn đôi", "song thị", "nhìn một thành hai"],
    },
  },
  {
    id: "EA06",
    audience: "adult",
    labelJa: "顔色が明らかに悪い",
    keywords: {
      ja: ["顔色が悪", "真っ青", "まっさお"],
      en: ["very pale", "turned pale", "looks pale", "face is pale", "pale face"],
      "zh-Hans": ["脸色很差", "脸色不好", "脸色苍白", "脸色发白"],
      "zh-Hant": ["臉色很差", "臉色不好", "臉色蒼白", "臉色發白"],
      ko: ["안색이 나빠", "안색이 안 좋", "얼굴이 창백", "새파랗"],
      es: ["pálido", "pálida", "mal color"],
      pt: ["pálido", "pálida", "cor ruim"],
      fr: ["pâle", "mauvaise mine"],
      vi: ["sắc mặt kém", "sắc mặt xấu", "mặt tái", "tái mét", "xanh xao"],
    },
  },
  {
    id: "EA07",
    audience: "adult",
    labelJa: "突然の激しい頭痛",
    keywords: {
      ja: ["激しい頭痛", "突然の頭痛", "急な頭痛", "一番ひどい頭痛", "頭が激しく痛", "急に頭が痛"],
      en: ["severe headache", "sudden headache", "worst headache", "terrible headache", "intense headache"],
      "zh-Hans": ["剧烈头痛", "突然头痛", "头剧痛", "最严重的头痛", "头痛得厉害", "头疼得厉害"],
      "zh-Hant": ["劇烈頭痛", "突然頭痛", "頭劇痛", "最嚴重的頭痛", "頭痛得厲害", "頭疼得厲害"],
      ko: ["심한 두통", "갑작스러운 두통", "극심한 두통", "갑자기 머리가 아", "머리가 심하게 아", "가장 심한 두통"],
      es: ["dolor de cabeza fuerte", "dolor de cabeza intenso", "dolor de cabeza muy fuerte", "dolor de cabeza repentino", "el peor dolor de cabeza"],
      pt: ["dor de cabeça forte", "dor de cabeça intensa", "dor de cabeça muito forte", "dor de cabeça súbita", "dor de cabeça repentina", "pior dor de cabeça"],
      fr: ["mal de tête violent", "maux de tête violents", "mal de tête intense", "mal de tête soudain", "pire mal de tête"],
      vi: ["đau đầu dữ dội", "đau đầu đột ngột", "nhức đầu dữ dội", "đau đầu kinh khủng"],
    },
  },
  {
    id: "EA08",
    audience: "adult",
    labelJa: "突然の高熱（「突然」「急に」とあわせたときだけ）",
    keywords: {
      ja: ["高熱"],
      en: ["high fever"],
      "zh-Hans": ["高烧", "高热"],
      "zh-Hant": ["高燒", "高熱"],
      ko: ["고열"],
      es: ["fiebre alta"],
      pt: ["febre alta"],
      fr: ["forte fièvre", "fièvre élevée", "fièvre forte"],
      vi: ["sốt cao"],
    },
    alsoRequires: {
      ja: ["突然", "急に", "急な"],
      en: ["sudden"],
      "zh-Hans": ["突然"],
      "zh-Hant": ["突然"],
      ko: ["갑자기", "갑작스러운", "갑작스런"],
      es: ["de repente", "repentin", "súbit"],
      pt: ["de repente", "repentin", "súbit"],
      fr: ["soudain", "brusque", "tout à coup", "d'un coup"],
      vi: ["đột ngột", "đột nhiên", "bất ngờ"],
    },
  },
  {
    id: "EA09",
    audience: "adult",
    labelJa: "支えなしで立てないぐらい急にふらつく",
    keywords: {
      ja: ["立てない", "立っていられない", "急にふらつ", "急にふらふら"],
      en: ["can't stand", "cannot stand", "unable to stand", "suddenly dizzy", "suddenly unsteady"],
      "zh-Hans": ["站不起来", "站不住", "突然站不稳", "突然头晕", "突然摇晃"],
      "zh-Hant": ["站不起來", "站不住", "突然站不穩", "突然頭暈", "突然搖晃"],
      ko: ["서 있을 수 없", "일어설 수 없", "설 수가 없", "갑자기 휘청", "갑자기 비틀", "갑자기 어지러"],
      es: ["no puedo estar de pie", "no puedo mantenerme de pie", "no me puedo parar", "mareo repentino", "me tambaleo"],
      pt: ["não consigo ficar de pé", "não consigo ficar em pé", "não consigo me levantar", "tontura repentina", "cambaleando"],
      fr: ["je ne peux pas me tenir debout", "ne tiens pas debout", "impossible de rester debout", "vertige soudain", "titube"],
      vi: ["không đứng được", "không thể đứng", "đột nhiên loạng choạng", "đột nhiên chóng mặt", "loạng choạng"],
    },
  },
  {
    id: "EA10",
    audience: "adult",
    labelJa: "胸や背中の突然の激痛",
    keywords: {
      ja: ["胸の激痛", "背中の激痛", "胸が激しく痛", "背中が激しく痛"],
      en: ["severe chest pain", "sharp chest pain", "intense chest pain", "severe back pain", "sudden back pain"],
      "zh-Hans": ["胸部剧痛", "胸口剧痛", "背部剧痛", "后背剧痛"],
      "zh-Hant": ["胸部劇痛", "胸口劇痛", "背部劇痛", "後背劇痛"],
      ko: ["가슴에 극심한 통증", "가슴이 심하게 아", "등이 심하게 아", "등에 극심한 통증"],
      es: ["dolor fuerte en el pecho", "dolor intenso en el pecho", "dolor fuerte en la espalda", "dolor intenso en la espalda"],
      pt: ["dor forte no peito", "dor intensa no peito", "dor forte nas costas", "dor intensa nas costas"],
      fr: ["douleur violente à la poitrine", "douleur intense à la poitrine", "douleur violente dans le dos", "douleur intense dans le dos"],
      vi: ["đau ngực dữ dội", "đau lưng dữ dội", "đau dữ dội ở ngực", "đau dữ dội ở lưng"],
    },
  },
  {
    id: "EA11",
    audience: "adult",
    labelJa: "急な息切れ、呼吸困難",
    keywords: {
      ja: ["息ができない", "息が出来ない", "いきができない", "息苦し", "息ぐるし", "いきぐるし", "息が苦し", "息がくるし", "いきがくるし", "呼吸が苦し", "呼吸がくるし", "こきゅうがくるし", "呼吸困難"],
      en: ["can't breathe", "cannot breathe", "short of breath", "shortness of breath", "difficulty breathing", "hard to breathe", "trouble breathing"],
      "zh-Hans": ["喘不过气", "无法呼吸", "呼吸困难", "呼吸急促", "透不过气"],
      "zh-Hant": ["喘不過氣", "無法呼吸", "呼吸困難", "呼吸急促", "透不過氣"],
      ko: ["숨을 쉴 수 없", "숨이 안 쉬어", "숨쉬기 힘들", "숨쉬기가 힘들", "숨이 차", "호흡곤란", "호흡이 힘들", "숨이 막혀"],
      es: ["no puedo respirar", "me falta el aire", "falta de aire", "dificultad para respirar", "me ahogo"],
      pt: ["não consigo respirar", "falta de ar", "dificuldade para respirar", "dificuldade de respirar"],
      fr: ["je ne peux pas respirer", "n'arrive pas à respirer", "essouffl", "du mal à respirer", "difficulté à respirer", "souffle court"],
      vi: ["không thở được", "khó thở", "thở không được", "hụt hơi"],
    },
  },
  {
    id: "EA12",
    audience: "adult",
    labelJa: "胸の中央が締め付けられる・圧迫されるような痛みが2〜3分続く",
    keywords: {
      ja: ["胸が締め付け", "胸がしめつけ", "胸が締めつけ", "むねがしめつけ", "胸が圧迫", "むねが圧迫", "胸が痛", "胸がいた", "むねがいた", "むねが痛", "胸の痛", "むねの痛", "むねのいた", "胸痛"],
      en: ["chest pain", "chest hurts", "pain in my chest", "pain in the chest", "chest is tight", "chest tightness", "tight chest", "chest feels tight", "pressure in my chest", "chest pressure"],
      "zh-Hans": ["胸痛", "胸疼", "胸口痛", "胸口疼", "胸部疼痛", "胸闷", "胸口发紧", "胸口压迫"],
      "zh-Hant": ["胸痛", "胸疼", "胸口痛", "胸口疼", "胸部疼痛", "胸悶", "胸口發緊", "胸口壓迫"],
      ko: ["가슴이 아", "가슴 통증", "흉통", "가슴이 조이", "가슴이 조여", "가슴이 답답", "가슴이 압박", "가슴이 짓눌"],
      es: ["dolor en el pecho", "dolor de pecho", "me duele el pecho", "opresión en el pecho", "presión en el pecho"],
      pt: ["dor no peito", "meu peito dói", "peito doendo", "aperto no peito", "pressão no peito"],
      fr: ["douleur à la poitrine", "douleur thoracique", "mal à la poitrine", "oppression thoracique", "serrement à la poitrine", "poitrine serrée", "pression dans la poitrine"],
      vi: ["đau ngực", "tức ngực", "thắt ngực", "ngực bị đè"],
    },
  },
  {
    id: "EA13",
    audience: "adult",
    labelJa: "痛む場所が移動する",
    keywords: {
      ja: ["痛みが移動", "痛む場所が移動", "痛い場所が移動", "痛いところが移動"],
      en: ["pain is moving", "pain moves", "pain moved", "pain keeps moving", "pain shifts"],
      "zh-Hans": ["疼痛在移动", "疼的地方在移动", "痛的位置在变", "疼痛转移", "痛点移动"],
      "zh-Hant": ["疼痛在移動", "疼的地方在移動", "痛的位置在變", "疼痛轉移", "痛點移動"],
      ko: ["통증이 이동", "아픈 곳이 이동", "아픈 부위가 옮겨", "통증이 옮겨"],
      es: ["el dolor se mueve", "el dolor cambia de lugar", "el dolor se desplaza"],
      pt: ["a dor se move", "a dor muda de lugar", "a dor se desloca"],
      fr: ["la douleur se déplace", "douleur qui se déplace", "la douleur bouge"],
      vi: ["cơn đau di chuyển", "đau di chuyển", "chỗ đau di chuyển"],
    },
  },
  {
    id: "EA14",
    audience: "adult",
    labelJa: "突然の激しい腹痛／激しい腹痛が持続する",
    keywords: {
      ja: ["激しい腹痛", "おなかが激しく痛", "お腹が激しく痛", "腹が激しく痛"],
      en: ["severe stomach pain", "severe abdominal pain", "severe stomachache", "severe belly pain", "intense abdominal pain"],
      "zh-Hans": ["剧烈腹痛", "肚子剧痛", "肚子疼得厉害", "肚子痛得厉害"],
      "zh-Hant": ["劇烈腹痛", "肚子劇痛", "肚子疼得厲害", "肚子痛得厲害"],
      ko: ["심한 복통", "극심한 복통", "배가 심하게 아"],
      es: ["dolor abdominal intenso", "dolor abdominal fuerte", "dolor de barriga muy fuerte", "dolor de estómago muy fuerte"],
      pt: ["dor abdominal intensa", "dor abdominal forte", "dor de barriga muito forte", "dor de estômago muito forte"],
      fr: ["douleur abdominale intense", "violent mal de ventre", "douleur violente au ventre", "très mal au ventre"],
      vi: ["đau bụng dữ dội", "đau bụng dữ"],
    },
  },
  {
    id: "EA15",
    audience: "adult",
    labelJa: "血を吐く（吐血・喀血）",
    keywords: {
      ja: ["血を吐", "血をはい", "血をはく", "ちをはい", "ちをはく", "吐血", "喀血"],
      en: ["vomited blood", "vomiting blood", "threw up blood", "coughing up blood", "coughed up blood"],
      "zh-Hans": ["吐血", "呕血", "咯血"],
      "zh-Hant": ["吐血", "嘔血", "咯血"],
      ko: ["피를 토", "토혈", "각혈", "객혈"],
      es: ["vomité sangre", "vomitando sangre", "vómito con sangre", "tosiendo sangre"],
      pt: ["vomitei sangue", "vomitando sangue", "vômito com sangue", "tossindo sangue"],
      fr: ["vomi du sang", "vomit du sang", "vomissement de sang", "crache du sang", "craché du sang"],
      vi: ["nôn ra máu", "ói ra máu", "nôn máu", "ho ra máu"],
    },
  },
  {
    id: "EA16",
    audience: "adult",
    labelJa: "便に血が混ざる、または真っ黒い便が出る",
    keywords: {
      ja: ["血便", "便に血", "黒い便", "真っ黒な便"],
      en: ["blood in my stool", "blood in stool", "bloody stool", "black stool", "black poop", "tarry stool"],
      "zh-Hans": ["便血", "大便有血", "黑便", "大便发黑", "黑色大便"],
      "zh-Hant": ["便血", "大便有血", "黑便", "大便發黑", "黑色大便"],
      ko: ["혈변", "변에 피", "검은 변", "까만 변"],
      es: ["sangre en las heces", "heces con sangre", "heces negras", "caca negra"],
      pt: ["sangue nas fezes", "fezes com sangue", "fezes pretas", "cocô preto"],
      fr: ["sang dans les selles", "selles sanglantes", "selles noires"],
      vi: ["đi ngoài ra máu", "đi cầu ra máu", "phân có máu", "phân đen"],
    },
  },
  {
    id: "EA17",
    audience: "adult",
    labelJa: "突然のしびれ／突然、片方の腕や足に力が入らなくなる",
    keywords: {
      ja: ["手足がしびれ", "手足が痺れ", "腕に力が入らない", "足に力が入らない", "手に力が入らない"],
      en: ["arm is numb", "leg is numb", "numb arm", "numb leg", "numbness in my arm", "numbness in my leg", "weakness in one arm", "no strength in my arm", "no strength in my leg", "arm feels weak", "leg feels weak"],
      "zh-Hans": ["手脚发麻", "手脚麻木", "胳膊使不上劲", "腿使不上劲", "胳膊没力气", "腿没力气", "手臂无力"],
      "zh-Hant": ["手腳發麻", "手腳麻木", "胳膊使不上勁", "腿使不上勁", "胳膊沒力氣", "腿沒力氣", "手臂無力"],
      ko: ["팔다리가 저려", "손발이 저려", "팔에 힘이 안", "다리에 힘이 안", "팔에 힘이 없", "다리에 힘이 없"],
      es: ["brazo dormido", "pierna dormida", "hormigueo en el brazo", "hormigueo en la pierna", "no tengo fuerza en el brazo", "no tengo fuerza en la pierna", "debilidad en un brazo"],
      pt: ["braço dormente", "perna dormente", "formigamento no braço", "formigamento na perna", "sem força no braço", "sem força na perna", "fraqueza em um braço"],
      fr: ["bras engourdi", "jambe engourdie", "fourmillements dans le bras", "plus de force dans le bras", "plus de force dans la jambe", "faiblesse dans un bras"],
      vi: ["tê tay chân", "tê tay", "tê chân", "tay không có lực", "chân không có lực", "yếu một bên tay"],
    },
  },
  {
    id: "EA18",
    audience: "adult",
    labelJa: "意識がない、またはおかしい（もうろう）／ぐったりしている",
    keywords: {
      ja: ["意識がない", "意識が無い", "いしきがない", "意識がおかしい", "いしきがおかしい", "もうろう", "朦朧", "ぐったり", "返事がない", "へんじがない"],
      en: ["unconscious", "not conscious", "passed out", "unresponsive", "not responding", "dazed"],
      "zh-Hans": ["没有意识", "失去意识", "昏迷", "意识模糊", "神志不清", "没反应", "瘫软"],
      "zh-Hant": ["沒有意識", "失去意識", "昏迷", "意識模糊", "神志不清", "沒反應", "癱軟"],
      ko: ["의식이 없", "의식을 잃", "의식이 흐릿", "몽롱", "축 늘어", "반응이 없"],
      es: ["inconsciente", "perdió el conocimiento", "no responde", "desmayad", "aturdid"],
      pt: ["inconsciente", "desmai", "não responde", "atordoad"],
      fr: ["inconscient", "perdu connaissance", "ne répond pas", "évanoui", "hébété"],
      vi: ["bất tỉnh", "mất ý thức", "lơ mơ", "không phản ứng", "li bì", "ngất xỉu"],
    },
  },
  {
    id: "EA19",
    audience: "adult",
    labelJa: "冷や汗を伴うような強い吐き気",
    keywords: {
      ja: ["冷や汗", "冷汗", "ひやあせ", "強い吐き気", "吐き気が強", "ひどい吐き気"],
      en: ["cold sweat", "severe nausea", "strong nausea", "very nauseous"],
      "zh-Hans": ["冷汗", "剧烈恶心", "严重恶心", "恶心得厉害"],
      "zh-Hant": ["冷汗", "劇烈噁心", "嚴重噁心", "噁心得厲害"],
      ko: ["식은땀", "심한 메스꺼움", "심한 구역질"],
      es: ["sudor frío", "sudores fríos", "náuseas fuertes", "náuseas intensas"],
      pt: ["suor frio", "náusea forte", "náuseas fortes", "enjoo forte"],
      fr: ["sueur froide", "sueurs froides", "nausée intense", "nausées intenses", "fortes nausées"],
      vi: ["mồ hôi lạnh", "buồn nôn dữ dội", "rất buồn nôn"],
    },
  },
  {
    id: "EA20",
    audience: "adult",
    labelJa: "物をのどにつまらせて、呼吸が苦しい、意識がない",
    keywords: {
      ja: ["のどにつま", "喉につま", "のどに詰ま", "喉に詰ま"],
      en: ["choking", "stuck in my throat", "stuck in the throat", "stuck in his throat", "stuck in her throat"],
      "zh-Hans": ["噎住", "噎到", "卡在喉咙", "卡住喉咙"],
      "zh-Hant": ["噎住", "噎到", "卡在喉嚨", "卡住喉嚨"],
      ko: ["목에 걸렸", "목에 걸려", "목이 막혀"],
      es: ["atragant", "atorado en la garganta", "atascado en la garganta"],
      pt: ["engasg", "preso na garganta", "entalad"],
      fr: ["s'étouffe", "coincé dans la gorge", "bloqué dans la gorge", "fausse route"],
      vi: ["bị hóc", "mắc nghẹn", "bị nghẹn", "nghẹn thở", "mắc ở cổ họng"],
    },
  },
  {
    id: "EA21",
    audience: "adult",
    labelJa: "けいれんが止まらない／止まっても意識がもどらない",
    keywords: {
      ja: ["けいれん", "痙攣", "ケイレン", "ひきつけ"],
      en: ["seizure", "convuls"],
      "zh-Hans": ["抽搐", "痉挛"],
      "zh-Hant": ["抽搐", "痙攣"],
      ko: ["경련", "발작"],
      es: ["convulsi", "ataque epiléptico"],
      pt: ["convuls", "ataque epiléptico"],
      fr: ["convulsion", "crise d'épilepsie", "crise épileptique"],
      vi: ["co giật", "lên cơn động kinh"],
    },
  },
  {
    id: "EA22",
    audience: "adult",
    labelJa: "大量の出血を伴うけが／広範囲のやけど",
    keywords: {
      ja: ["大量の出血", "大量出血", "血が止まらない", "出血が止まらない", "広い範囲のやけど", "広範囲のやけど", "広い範囲の火傷", "広範囲の火傷"],
      en: ["heavy bleeding", "bleeding a lot", "won't stop bleeding", "bleeding won't stop", "bleeding doesn't stop", "large burn", "extensive burn"],
      "zh-Hans": ["大量出血", "血止不住", "流血不止", "出血不止", "大面积烧伤", "大面积烫伤"],
      "zh-Hant": ["大量出血", "血止不住", "流血不止", "出血不止", "大面積燒傷", "大面積燙傷"],
      ko: ["출혈이 심", "피가 멈추지 않", "피가 안 멈춰", "피가 계속 나", "넓은 범위의 화상", "광범위한 화상"],
      es: ["sangrado abundante", "mucha sangre", "no para de sangrar", "no deja de sangrar", "quemadura extensa", "quemaduras extensas"],
      pt: ["sangramento intenso", "muito sangue", "não para de sangrar", "sangramento não para", "queimadura extensa", "queimaduras extensas"],
      fr: ["saigne beaucoup", "saignement abondant", "hémorragie", "ne s'arrête pas de saigner", "brûlure étendue", "brûlures étendues"],
      vi: ["chảy máu nhiều", "mất nhiều máu", "máu không cầm được", "chảy máu không ngừng", "bỏng diện rộng"],
    },
  },
  {
    id: "EA23",
    audience: "adult",
    labelJa: "交通事故にあった、水におぼれている、高いところから落ちた",
    keywords: {
      ja: ["交通事故", "おぼれ", "溺れ", "高いところから落ち", "高い所から落ち"],
      en: ["traffic accident", "car accident", "hit by a car", "drowning", "drowned", "fell from a height", "fell from a high place"],
      "zh-Hans": ["交通事故", "车祸", "被车撞", "溺水", "从高处摔下", "从高处掉下"],
      "zh-Hant": ["交通事故", "車禍", "被車撞", "溺水", "從高處摔下", "從高處掉下"],
      ko: ["교통사고", "차에 치", "물에 빠", "익사", "높은 곳에서 떨어"],
      es: ["accidente de tráfico", "accidente de tránsito", "accidente de coche", "atropell", "se ahogó", "ahogando", "cayó desde lo alto", "caí desde lo alto"],
      pt: ["acidente de trânsito", "acidente de carro", "atropelad", "afogando", "afogou", "caiu de um lugar alto", "caí de um lugar alto"],
      fr: ["accident de la route", "accident de voiture", "renversé par une voiture", "noyade", "se noie", "tombé de haut", "chute de hauteur"],
      vi: ["tai nạn giao thông", "bị xe đâm", "bị xe tông", "đuối nước", "chết đuối", "ngã từ trên cao", "rơi từ trên cao"],
    },
  },
  {
    id: "EA24",
    audience: "adult",
    labelJa: "いつもと違う場合、様子がおかしい場合",
    // emergency.md：キーワードでは拾わず、薬剤師が手動で「緊急の確認を開く」で対応する
    keywords: NONE,
  },

  // ───────── こども（15歳以下のときだけ使う） ─────────
  {
    id: "EC01",
    audience: "child",
    labelJa: "くちびるの色が紫色",
    keywords: {
      ja: ["くちびるが紫", "唇が紫", "くちびるがむらさき", "唇の色が紫", "くちびるの色が紫"],
      en: ["lips are purple", "purple lips", "lips are blue", "blue lips", "lips turned purple", "lips turned blue"],
      "zh-Hans": ["嘴唇发紫", "嘴唇紫", "嘴唇青紫"],
      "zh-Hant": ["嘴唇發紫", "嘴唇紫", "嘴唇青紫"],
      ko: ["입술이 보라", "입술이 파랗", "입술이 새파랗"],
      es: ["labios morados", "labios azules"],
      pt: ["lábios roxos", "lábios azulados", "boca roxa"],
      fr: ["lèvres violettes", "lèvres bleues"],
      vi: ["môi tím", "tím môi", "môi bị tím"],
    },
  },
  {
    id: "EC02",
    audience: "child",
    labelJa: "激しい咳やゼーゼーして呼吸が苦しそう／呼吸が弱い",
    keywords: {
      ja: ["ゼーゼー", "ぜーぜー", "ゼイゼイ", "ぜいぜい", "呼吸が弱"],
      en: ["wheez", "breathing is weak", "weak breathing", "barely breathing"],
      "zh-Hans": ["喘鸣", "呼哧呼哧", "喘得厉害", "呼吸微弱", "呼吸很弱"],
      "zh-Hant": ["喘鳴", "呼哧呼哧", "喘得厲害", "呼吸微弱", "呼吸很弱"],
      ko: ["쌕쌕", "그르렁", "숨소리가 약", "호흡이 약"],
      es: ["silbido al respirar", "sibilancia", "respiración débil", "respira débil"],
      pt: ["chiado no peito", "chiado ao respirar", "sibilância", "respiração fraca"],
      fr: ["respiration sifflante", "sifflement", "respiration faible", "respire faiblement"],
      vi: ["khò khè", "thở yếu", "hơi thở yếu"],
    },
  },
  {
    id: "EC03",
    audience: "child",
    labelJa: "手足が硬直している",
    keywords: {
      ja: ["手足が固ま", "手足がかたま", "手足が硬", "硬直"],
      en: ["stiff arms", "stiff legs", "arms and legs are stiff", "limbs are stiff", "rigid"],
      "zh-Hans": ["手脚僵硬", "四肢僵硬", "身体僵直", "僵直"],
      "zh-Hant": ["手腳僵硬", "四肢僵硬", "身體僵直", "僵直"],
      ko: ["팔다리가 굳", "손발이 굳", "경직", "뻣뻣"],
      es: ["brazos y piernas rígidos", "rígido", "rígida", "rigidez"],
      pt: ["braços e pernas rígidos", "rígido", "rígida", "rigidez"],
      fr: ["bras et jambes raides", "raide", "rigide", "raideur"],
      vi: ["tay chân cứng đờ", "cứng đờ", "co cứng", "cứng người"],
    },
  },
  {
    id: "EC04",
    audience: "child",
    labelJa: "頭を強くぶつけて、出血がとまらない、意識がない、けいれんがある など",
    keywords: {
      ja: ["頭を強くぶつけ", "頭を強く打", "頭を強くうっ"],
      en: ["hit his head", "hit her head", "hit their head", "hit my head", "bumped his head", "bumped her head", "banged his head", "banged her head", "head injury"],
      "zh-Hans": ["头部受到重击", "重重撞到头", "头撞得很厉害", "撞到头"],
      "zh-Hant": ["頭部受到重擊", "重重撞到頭", "頭撞得很厲害", "撞到頭"],
      ko: ["머리를 세게 부딪", "머리를 세게 박", "머리를 세게 맞", "머리를 부딪"],
      es: ["golpe fuerte en la cabeza", "se golpeó la cabeza", "golpe en la cabeza"],
      pt: ["bateu a cabeça", "batida forte na cabeça", "pancada na cabeça"],
      fr: ["cogné la tête", "coup violent à la tête", "choc à la tête"],
      vi: ["đập đầu", "va đầu mạnh", "va đập mạnh vào đầu"],
    },
  },
  {
    id: "EC05",
    audience: "child",
    labelJa: "激しい下痢や嘔吐で水分が取れない／嘔吐が止まらない など",
    keywords: {
      ja: ["水分が取れない", "水分がとれない", "吐き続け", "嘔吐が止まらない", "吐くのが止まらない"],
      en: ["can't keep fluids down", "can't keep water down", "can't drink anything", "keeps vomiting", "keeps throwing up", "vomiting won't stop", "can't stop vomiting"],
      "zh-Hans": ["喝不下水", "不能喝水", "一直吐", "吐个不停", "呕吐不止", "不停地吐"],
      "zh-Hant": ["喝不下水", "不能喝水", "一直吐", "吐個不停", "嘔吐不止", "不停地吐"],
      ko: ["물을 못 마", "수분을 못 섭취", "계속 토", "구토가 멈추지 않", "구토가 안 멈춰"],
      es: ["no puede tomar líquidos", "no retiene líquidos", "no puede beber agua", "vomita sin parar", "no para de vomitar", "sigue vomitando"],
      pt: ["não consegue beber água", "não consegue tomar líquidos", "vomita sem parar", "não para de vomitar", "continua vomitando"],
      fr: ["ne peut pas boire", "ne garde rien", "vomit sans arrêt", "n'arrête pas de vomir", "vomissements incessants"],
      vi: ["không uống được nước", "không uống được", "nôn liên tục", "ói liên tục", "nôn không ngừng"],
    },
  },
  {
    id: "EC06",
    audience: "child",
    labelJa: "虫に刺されて全身にじんましんが出て、顔色が悪くなった",
    keywords: {
      ja: ["全身のじんましん", "全身にじんましん", "全身の蕁麻疹", "全身に蕁麻疹", "虫に刺され", "虫にさされ"],
      en: ["hives all over", "hives over the whole body", "rash all over the body", "stung by an insect", "insect sting", "bitten by an insect", "insect bite"],
      "zh-Hans": ["全身荨麻疹", "全身起疹子", "全身起风团", "被虫子咬", "被虫咬", "被虫蛰"],
      "zh-Hant": ["全身蕁麻疹", "全身起疹子", "全身起風團", "被蟲子咬", "被蟲咬", "被蟲螫"],
      ko: ["온몸에 두드러기", "전신 두드러기", "온몸 두드러기", "벌레에 물", "벌레에 쏘"],
      es: ["ronchas por todo el cuerpo", "urticaria en todo el cuerpo", "picadura de insecto", "le picó un insecto", "me picó un insecto"],
      pt: ["urticária no corpo todo", "urticária pelo corpo todo", "picada de inseto", "picado por um inseto"],
      fr: ["urticaire sur tout le corps", "plaques sur tout le corps", "piqûre d'insecte", "piqué par un insecte"],
      vi: ["nổi mề đay khắp người", "mề đay toàn thân", "nổi mẩn khắp người", "bị côn trùng đốt", "bị côn trùng cắn"],
    },
  },
  {
    id: "EC07",
    audience: "child",
    labelJa: "痛みのひどいやけど／広範囲のやけど",
    keywords: {
      ja: ["ひどいやけど", "ひどい火傷", "やけどがひどい", "火傷がひどい"],
      en: ["bad burn", "severe burn", "serious burn", "badly burned", "badly burnt"],
      "zh-Hans": ["严重烧伤", "严重烫伤", "烫伤很严重", "烧伤很严重"],
      "zh-Hant": ["嚴重燒傷", "嚴重燙傷", "燙傷很嚴重", "燒傷很嚴重"],
      ko: ["심한 화상", "화상이 심"],
      es: ["quemadura grave", "quemadura fuerte", "se quemó mucho"],
      pt: ["queimadura grave", "queimadura forte", "se queimou muito"],
      fr: ["brûlure grave", "brûlure sévère", "gravement brûlé"],
      vi: ["bỏng nặng", "phỏng nặng"],
    },
  },
  {
    id: "EC08",
    audience: "child",
    labelJa: "生まれて3カ月未満の乳児の様子がおかしい",
    keywords: {
      ja: ["赤ちゃんの様子がおかし", "赤ちゃんの様子が変", "赤ちゃんがおかしい", "赤ちゃんの様子がいつもと違"],
      en: ["something is wrong with my baby", "something wrong with the baby", "baby is acting strange", "baby is not acting normal", "baby isn't acting normal"],
      "zh-Hans": ["宝宝不对劲", "婴儿不对劲", "宝宝的样子不对", "婴儿的样子不对", "婴儿状态异常"],
      "zh-Hant": ["寶寶不對勁", "嬰兒不對勁", "寶寶的樣子不對", "嬰兒的樣子不對", "嬰兒狀態異常"],
      ko: ["아기가 이상", "아기 상태가 이상", "아기가 평소와 달라"],
      es: ["el bebé está raro", "el bebé no está bien", "algo le pasa al bebé", "algo le pasa a mi bebé", "mi bebé está raro"],
      pt: ["o bebê está estranho", "o bebê não está bem", "algo errado com o bebê", "meu bebê está estranho"],
      fr: ["le bébé est bizarre", "mon bébé est bizarre", "quelque chose ne va pas avec le bébé", "bébé ne va pas bien"],
      vi: ["em bé có biểu hiện lạ", "em bé không bình thường", "bé có biểu hiện lạ", "em bé bất thường"],
    },
  },
];
