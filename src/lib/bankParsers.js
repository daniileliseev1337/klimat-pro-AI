// Умный импорт выписки Яндекс Банка v2. Чистые функции — покрыты vitest.

// Нормализация описания в ключ мерчанта: разные точки сети → один ключ.
export function normalizeMerchant(rawDesc) {
  const tokens = (rawDesc || "")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2 && !/^\d+$/.test(t));
  return tokens[0] || "";
}

// Стандартные группы MCC → категория сайта. Расширяется по мере встреч.
const MCC_CATEGORIES = {
  "4121": "Такси", "4111": "Транспорт", "4131": "Транспорт",
  "5411": "Питание", "5412": "Питание", "5499": "Питание",
  "5812": "Питание", "5814": "Питание", "5813": "Питание",
  "5912": "Здоровье / аптека", "5122": "Здоровье / аптека",
  "5815": "ПО и инструменты", "5816": "ПО и инструменты",
  "4814": "Связь", "4812": "Связь",
  "5541": "Транспорт", "5542": "Транспорт",
};

// Категория по MCC из описания вида YANDEX*NNNN*. null — если MCC нет/неизвестен.
export function categorizeByMcc(rawDesc) {
  const m = (rawDesc || "").match(/\*(\d{4})\*/);
  if (!m) return null;
  return MCC_CATEGORIES[m[1]] || null;
}

// Словарь-затравка (CAT_RULES) перенесён из App.jsx verbatim.
// Ключи мерчантов → категория. Матч идёт через keyMatches (границы слов).
const CAT_RULES = [
  { cat:"Такси", keys:[
    "yandex*4121*taxi","yandex*4121*uber","yandex*4111*go_transpo",
    "yandex7299*go_berizar","yandex*7299*go_berizar",
    "яндекс го","yandex go","yango","uber","bolt","такси","taxi",
    "ситимобил","maxim","indrive","indriver","яндекс такси","yandex taxi",
  ]},
  { cat:"Транспорт", keys:[
    "mos.transport","mostransport","mos. transport",
    "yandex*4111*troyka","troyka","тройка","strelkacard","strelka",
    "cppk","цппк","centralnaya ppk","ao centralnaya ppk",
    "petrovsko-razumov","petrovskorazumovskaya",
    "aeroexpress","аэроэкспресс","rzd","ржд",
    "tutu.ru","tutu ru","tpp_st_avtolajn",
    "метро","мцд","трамвай","троллейбус","мосгортранс","автобус",
  ]},
  { cat:"Кофе", keys:[
    "onepricecoffe","cofix","po kofeyku","po kofejku","sp_kofejnya",
    "kofejnya","kofein","kote kafe","street coffee","_kofejnya",
    "b1 maypo","coffeeshop",
  ]},
  { cat:"Питание", keys:[
    "vernyj 1300","vernyj","верный",
    "pyaterochka","пятёрочка","пятерочка",
    "magnit","магнит","perekrestok","перекрёсток","перекресток",
    "vkusvill","вкусвилл","dixy","дикси","spar","спар","lenta","лента",
    "auchan","ашан","окей","okej","глобус","globus",
    "krasnoe&beloe","krasnoe beloe","красное белое",
    "winelab","produkty","продукты","mikromarket",
    "yandex*5411*lavka","yandex*5814*eda","lavka","лавка",
    "delivery club","самокат","сбермаркет","азбука вкуса",
    "суши","sushi","пицца","pizza","burger","бургер","burger king",
    "mcdonalds","kfc","вкусно","dodo","додо","шоколадница","якитория",
    "subway","ebidoebi","doner market","шаурма","giro","girogiros",
    "qsr 29098","gastrokolledzh","mealty","столовая","ресторан","кафе",
    "pekarnya","evo_pekarnya","хлеб","пекарня","sunduk","tapper",
    "fix price","fixprice","spar 329","fix price 8090","fixprice 8090",
    "od verkhnie kotly","verkhnie kotly","rest june","микромаркет",
    "pizzasushiwok","donermkt",
  ]},
  { cat:"Здоровье / аптека", keys:[
    "gorzdrav","горздрав","36,6","36.6","aptechnoe","аптека","apteka",
    "rigla","ригла","pharmacy","antistress","ulybka radugi","улыбка радуги",
  ]},
  { cat:"Развлечения", keys:[
    "mori sinema","mori_sinema","синема","cinema","кино",
    "tslounge","lounge","duplet","бильярд","bowling","боулинг",
    "playerok","ggsel","pay4game","starsbus","onlypay",
    "ckassa","yp_kleekstore","onlypei","nrp","диалог восток",
  ]},
  { cat:"Кредит / займы", keys:[
    "погашение процентов","погашение основного долга",
    "погашение кредита","гашение долга",
  ]},
  { cat:"Табак", keys:[
    "evo_tabak","tabak 4","tabak","dym par","вейп","vape",
  ]},
  { cat:"ПО и инструменты", keys:[
    "yandex*5815*plus","yandex*5815","яндекс плюс","yandex plus",
    "кинопоиск","kinopoisk","okko","иви","яндекс музыка","яндекс 360",
    "google","apple","microsoft","adobe","jetbrains","notion","figma",
    "github","spotify","netflix","youtube premium","autodesk","revit",
    "telegram premium","discord nitro","chatgpt","openai","canva",
    "kaspersky","dr.web","vseinstrumenti","все инструменты",
  ]},
  { cat:"Связь", keys:[
    "yota_no3ds","yota","йота","мтс","мегафон","билайн",
    "tele2","теле2","ростелеком","beeline",
  ]},
  { cat:"Жильё / аренда", keys:[
    "жкх","квитанция","аренда","управляющая","тсж",
    "водоканал","мосэнерго","газпром","коммунал","еирц",
  ]},
  { cat:"Партнёр",  keys:["партнёр","партнер"] },
  { cat:"Семья",    keys:["родители","семья"] },
  { cat:"Питомцы",  keys:["зоомагазин","chetyre lap","zoomagazin","четыре лапы","зоо","vet ","ветклиника","ветеринар","petshop","pet shop"] },
  { cat:"Дети",     keys:["детский","детская","детсад","детский сад","игрушки","rosnova","школа"] },
  { cat:"Подарки",  keys:["подарок","gift","цветы","флорист","flower","букет"] },
  { cat:"Прочий доход", keys:[
    "капитализация","начисление процентов","кэшбэк","cashback",
    "возврат средств","отмена оплаты","внесение наличных","входящий перевод",
  ]},
];

// Матч ключа по границам слов внутри описания. Ключи с '*' (MCC-паттерны
// вида yandex*4121*taxi) матчатся как подстрока — они и так уникальны;
// обычные словарные ключи — по границам слов (чинит substring-слабость).
function keyMatches(desc, key) {
  if (key.includes("*")) return desc.includes(key);
  const esc = key.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zа-яё0-9])${esc}([^a-zа-яё0-9]|$)`, "i").test(desc);
}

// Категория по словарю-затравке. null — если ни одно правило не сработало.
export function categorizeByDict(rawDesc) {
  const d = (rawDesc || "").toLowerCase();
  for (const rule of CAT_RULES) {
    if (rule.keys.some(k => keyMatches(d, k.toLowerCase()))) return rule.cat;
  }
  return null;
}

// --- Классификация типа операции (Task 5) ---

const TRANSFER_RE = /перевод|перевода|сбп|transfer/i;
// I1: начислен[а-яёa-z]* процент — тесный класс вместо жадного .*
const TECH_RE = /капитализац|начислен[а-яёa-z]* процент|проценты на остаток|кэшбэк|cashback|внутрибанк/i;
// I2: PHONE_RE удалён — регекс телефона скопирован локально в classifyOperation (нет g-флага на модуле)

// Проверяет, содержит ли описание одно из имён владельца (для self_transfer).
function containsName(desc, names) {
  const d = desc.toLowerCase();
  return names.some(n => n && d.includes(n.toLowerCase()));
}

// Классификация типа операции + очистка ПДн из описания.
// opType: "technical" | "self_transfer" | "peer_transfer" | "payment"
export function classifyOperation(op, meNames = []) {
  const desc = op.rawDesc || "";
  if (TECH_RE.test(desc)) {
    return { opType: "technical", counterparty: null, cleanDesc: desc };
  }
  if (TRANSFER_RE.test(desc)) {
    if (containsName(desc, meNames)) {
      return { opType: "self_transfer", counterparty: null, cleanDesc: "Перевод себе" };
    }
    // I2+I3: локальный регекс (без g на модуле) + защита от утечки ФИО при отсутствии запятой
    const noPhone = desc.replace(/\+?\d[\d\s()-]{9,}\d/g, "");
    const parts = noPhone.split(",");
    const cleanDesc = parts.length > 1 ? (parts[0].trim() || "Перевод физлицу") : "Перевод физлицу";
    return { opType: "peer_transfer", counterparty: null, cleanDesc: cleanDesc };
  }
  return { opType: "payment", counterparty: null, cleanDesc: desc };
}

// --- Дедупликация (Task 7) ---

// Ключ операции для дедупа: дата + сумма + нормализованный мерчант.
export function hashOperation(op) {
  return `${op.date}|${op.amount}|${normalizeMerchant(op.rawDesc)}`;
}

// Пометка повторов относительно множества хешей уже импортированных операций.
export function dedupe(ops, existingHashes = new Set()) {
  return ops.map(op => ({ ...op, dupe: existingHashes.has(hashOperation(op)) }));
}

// Слой 4 (LLM) — заглушка. Реальная локальная модель подключается позже,
// не меняя сигнатуру: категоризатор станет async и вставит await между dict и none.
export async function categorizeLLM(_merchant) { return null; }

// Категоризатор-цепочка. Первый сработавший слой побеждает.
// learned: Map<merchantKey, category> из merchant_rules.
export function categorize(op, learned = new Map()) {
  const key = normalizeMerchant(op.rawDesc);
  if (key && learned.has(key)) return { category: learned.get(key), source: "learned" };
  const byMcc = categorizeByMcc(op.rawDesc);
  if (byMcc) return { category: byMcc, source: "mcc" };
  const byDict = categorizeByDict(op.rawDesc);
  if (byDict) return { category: byDict, source: "dict" };
  return { category: op.type === "income" ? "Прочий доход" : "Прочие расходы", source: "none" };
}

// --- Парсинг строк выписки Яндекс Банка (Task 6) ---

// Строки-заголовки и технические строки — пропускаем.
// Перенесён из parsePdfYandex App.jsx; расширен служебными фрагментами.
const YA_SKIP_RE = /входящий остаток|исходящий остаток|итого списаний|итого зачислений|всего расходных|всего приходных|страница \d|продолжение|выписка по договору|номер счёта|описание операции|сумма в валюте|дата.*мск|с уважением|начальник|ао «яндекс банк»|ао «яндекс|^дата\b|^описание\b|^итого\b|^остаток\b/i;

// Дата в формате ДД.ММ.ГГГГ — всегда первая в строке операции.
const YA_DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;

// Сумма в формате «[+–−-]пробелы_цифры,цц ₽» — берётся ПОСЛЕДНЯЯ в строке
// (это «Сумма в валюте Договора»; предыдущие суммы могут быть суммами в валюте платежа).
const YA_AMT_RE_ALL = /([+–−\-]\s*[\d\s]+,\d{2})\s*₽/g;

// Чистка описания: убираем дату, время («в ЧЧ:ММ»), суммы, знак ₽, номер карты (*NNNN).
function cleanYandexDesc(fullText) {
  return fullText
    .replace(/\d{2}\.\d{2}\.\d{4}/g, "")      // дата
    .replace(/[+–−\-]\s*[\d\s]+,\d{2}\s*₽/g, "") // суммы с ₽
    .replace(/в\s+\d{2}:\d{2}/g, "")           // время «в ЧЧ:ММ»
    .replace(/\*\d{4}/g, "")                   // последние 4 цифры карты
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * parseYandexRows — чистый парсинг строк PDF-выписки Яндекс Банка.
 *
 * Принимает массив строк текста (уже сгруппированных по вертикали — как
 * возвращает extractYandexPdfRows из App.jsx). Возвращает операции.
 *
 * @param {string[]} rows  — строки текста, по одной на «строку» PDF
 * @returns {Array<{date:string, amount:number, sign:1|-1, rawDesc:string}>}
 */
export function parseYandexRows(rows) {
  // Предвычислим метаданные каждой строки (аналог analyzed[] в parsePdfYandex)
  const analyzed = (rows || []).map(row => {
    const fullText = (row || "").trim();
    const dateM    = fullText.match(YA_DATE_RE);
    const amtAll   = [...fullText.matchAll(YA_AMT_RE_ALL)];
    const lastAmt  = amtAll.length > 0 ? amtAll[amtAll.length - 1] : null;
    const skip     = !fullText || YA_SKIP_RE.test(fullText);
    return { fullText, dateM, lastAmt, skip };
  });

  const out = [];
  let i = 0;
  while (i < analyzed.length) {
    const ar = analyzed[i];

    if (ar.skip) { i++; continue; }

    if (ar.dateM && ar.lastAmt) {
      // Дата → ISO
      const [, dd, mm, yyyy] = ar.dateM;
      const date = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;

      // Последняя сумма: «Сумма в валюте Договора» с учётом знака (– → минус)
      const amtStr = ar.lastAmt[1]
        .replace(/\s/g, "")
        .replace(",", ".")
        .replace("–", "-")
        .replace("−", "-"); // en-dash и математический минус
      const val = parseFloat(amtStr);
      if (isNaN(val) || val === 0) { i++; continue; }

      // Начальное описание из текущей строки
      let rawDesc = cleanYandexDesc(ar.fullText);

      // Дособираем многострочное описание: следующие строки без даты и суммы
      // (до 4 строк — как в оригинале «j < i + 5»).
      // В lib-версии нет minX, поэтому берём строки без даты/суммы подряд.
      let j = i + 1;
      while (j < analyzed.length && j < i + 5) {
        const next = analyzed[j];
        if (next.skip || next.dateM || next.lastAmt) break;
        rawDesc = (rawDesc + " " + next.fullText).replace(/\s{2,}/g, " ").trim();
        j++;
      }

      out.push({
        date,
        amount:  Math.abs(val),
        sign:    val < 0 ? -1 : 1,
        rawDesc,
      });
    }
    i++;
  }
  return out;
}
