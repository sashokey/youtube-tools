const strings: Record<
  string,
  readonly [string, string, string, string, string]
> = {
  "en-us": [
    "Watched videos",
    "Audio only",
    "Not interested",
    "Don't recommend channel",
    "Unavailable",
  ],
  "zh-cn": ["已观看的视频", "仅音频", "不感兴趣", "不推荐此频道", "不可用"],
  "zh-tw": [
    "已觀看的影片",
    "僅音訊",
    "不感興趣",
    "不要推薦這個頻道",
    "無法使用",
  ],
  "hi-in": [
    "देखे गए वीडियो",
    "केवल ऑडियो",
    "दिलचस्पी नहीं है",
    "चैनल का सुझाव न दें",
    "उपलब्ध नहीं है",
  ],
  "es-419": [
    "Videos vistos",
    "Solo audio",
    "No me interesa",
    "No recomendar canal",
    "No disponible",
  ],
  ar: [
    "الفيديوهات التي تمت مشاهدتها",
    "الصوت فقط",
    "غير مهتم",
    "عدم اقتراح القناة",
    "غير متاح",
  ],
  "fr-fr": [
    "Vidéos regardées",
    "Audio uniquement",
    "Pas intéressé",
    "Ne pas recommander cette chaîne",
    "Indisponible",
  ],
  "bn-bd": [
    "দেখা হয়েছে এমন ভিডিও",
    "শুধু অডিও",
    "আগ্রহী নই",
    "এই চ্যানেল সাজেস্ট করবেন না",
    "উপলভ্য নয়",
  ],
  "pt-br": [
    "Vídeos assistidos",
    "Somente áudio",
    "Não tenho interesse",
    "Não recomendar o canal",
    "Indisponível",
  ],
  "id-id": [
    "Video yang sudah ditonton",
    "Audio saja",
    "Tidak tertarik",
    "Jangan rekomendasikan channel",
    "Tidak tersedia",
  ],
  "ur-pk": [
    "دیکھی گئی ویڈیوز",
    "صرف آڈیو",
    "دلچسپی نہیں ہے",
    "چینل تجویز نہ کریں",
    "دستیاب نہیں",
  ],
  "ru-ru": [
    "Просмотренные видео",
    "Только аудио",
    "Не интересует",
    "Не рекомендовать канал",
    "Недоступно",
  ],
  "de-de": [
    "Angesehene Videos",
    "Nur Audio",
    "Kein Interesse",
    "Kanal nicht empfehlen",
    "Nicht verfügbar",
  ],
  "ja-jp": [
    "視聴済みの動画",
    "音声のみ",
    "興味なし",
    "チャンネルをおすすめに表示しない",
    "利用できません",
  ],
  pcm: [
    "Video wey you don watch",
    "Na only audio",
    "I no get interest",
    "No recommend dis channel",
    "E no dey available",
  ],
  arz: [
    "الفيديوهات اللي اتفرجت عليها",
    "الصوت بس",
    "مش مهتم",
    "ما تقترحش القناة دي",
    "مش متاح",
  ],
  "ar-eg": [
    "الفيديوهات اللي اتفرجت عليها",
    "الصوت بس",
    "مش مهتم",
    "ما تقترحش القناة دي",
    "مش متاح",
  ],
};

const keys = {
  watched: 0,
  audio: 1,
  interest: 2,
  channel: 3,
  unavailable: 4,
} as const;
const english = [
  "Watched videos",
  "Audio only",
  "Not interested",
  "Don't recommend channel",
  "Unavailable",
] as const;
const languages: Record<string, string> = {
  en: "en-us",
  zh: "zh-cn",
  hi: "hi-in",
  es: "es-419",
  fr: "fr-fr",
  bn: "bn-bd",
  pt: "pt-br",
  id: "id-id",
  ur: "ur-pk",
  ru: "ru-ru",
  de: "de-de",
  ja: "ja-jp",
};
type FeedbackAction = "interest" | "channel";

const nativeAliases: Record<
  string,
  Partial<Record<FeedbackAction, readonly string[]>>
> = {
  "zh-cn": { channel: ["不要推荐此频道"] },
  "zh-tw": { channel: ["不推薦此頻道"] },
  "hi-in": { interest: ["कोई दिलचस्पी नहीं"], channel: ["यह चैनल न सुझाएं"] },
  "es-419": { channel: ["No recomendar el canal"] },
  ar: { interest: ["لا يهمّني", "لا يهمني"] },
  "fr-fr": { channel: ["Ne pas recommander la chaîne"] },
  "bn-bd": { channel: ["চ্যানেল সাজেস্ট করবেন না", "এই চ্যানেলের সাজেশন চাই না"] },
  "ur-pk": { channel: ["چینل کی تجویز نہ کریں"] },
  "de-de": { channel: ["Keine Videos von diesem Kanal empfehlen"] },
  "ja-jp": { interest: ["興味がない"] },
};
const commonFeedbackLabels = {
  interest: ["Not interested", "Не интересует"],
  channel: [
    "Don't recommend channel",
    "Don't recommend this channel",
    "Не рекомендовать видео с этого канала",
    "Не рекомендовать канал",
  ],
};

function language(): string {
  const locale = document.documentElement.lang
    .toLowerCase()
    .replaceAll("_", "-");
  const base = locale.split("-")[0] ?? "";
  if (Object.hasOwn(strings, locale)) return locale;
  return /^zh-(?:hant|hk|mo)(?:-|$)/.test(locale)
    ? "zh-tw"
    : (languages[base] ?? base);
}

export function message(key: keyof typeof keys): string {
  const locale = language();
  const translation = Object.hasOwn(strings, locale)
    ? (strings[locale] ?? english)
    : english;
  return translation[keys[key]];
}

export function feedbackLabels(action: FeedbackAction): readonly string[] {
  const locale = language();
  const aliases = Object.hasOwn(nativeAliases, locale)
    ? (nativeAliases[locale]?.[action] ?? [])
    : [];
  return [message(action), ...commonFeedbackLabels[action], ...aliases];
}
