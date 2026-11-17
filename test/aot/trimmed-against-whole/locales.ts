import type { Program } from "./compare";

const everyLocale = (service: string) => `
const letters = "abcdefghijklmnopqrstuvwxyz";
const candidates = ["zh-Hant", "zh-Hans-HK", "sr-Latn", "pt-PT", "en-GB", "en-IN", "en-AU", "es-419", "es-MX", "fr-CA", "de-CH", "ar-EG", "ar-SA", "ar-u-nu-latn", "fa-u-ca-persian", "th-u-ca-buddhist-nu-thai", "ja-u-ca-japanese", "he-u-ca-hebrew", "hi-u-nu-deva", "de-u-co-phonebk", "zh-u-co-stroke", "sv-u-co-trad", "yue", "fil", "haw", "chr", "ckb", "und"];
for (const first of letters) for (const second of letters) candidates.push(first + second);
const locales = ${service}.supportedLocalesOf(candidates);
console.log(locales.length, "locales");
`;

const someLocales = `const locales = [undefined, "en", "en-GB", "de", "fr", "es", "pt-BR", "ru", "uk", "pl", "tr", "el", "he", "ar", "ar-EG", "fa", "hi", "bn", "ta", "th", "vi", "id", "zh", "zh-Hant", "ja", "ko", "sw", "am", "lt", "az", "ga", "cy", "is", "ka", "hy", "my", "km", "si", "ne", "mr"];\n`;

const shown = `
function shown(make) {
  try {
    return make();
  } catch (error) {
    return error.name + ": " + error.message;
  }
}
`;

const programs: Record<string, string> = {
  "number-format": `${everyLocale("Intl.NumberFormat")}
const styles = [{}, { style: "currency", currency: "EUR" }, { style: "currency", currency: "JPY", currencyDisplay: "name" }, { style: "percent" }, { notation: "compact" }, { notation: "compact", compactDisplay: "long" }, { notation: "scientific" }, { style: "unit", unit: "kilometer-per-hour", unitDisplay: "long" }, { style: "unit", unit: "megabyte", unitDisplay: "narrow" }, { signDisplay: "always", minimumFractionDigits: 3 }];
for (const locale of locales) console.log(locale, styles.map(style => shown(() => new Intl.NumberFormat(locale, style).format(-1234567.891))).join(" | "));
console.log(JSON.stringify(new Intl.NumberFormat("de", { style: "currency", currency: "USD" }).formatToParts(1234.5)), new Intl.NumberFormat("en").formatRange(3, 5));`,
  "number-to-locale-string": `${someLocales}
for (const locale of locales) console.log(locale, (1234567.891).toLocaleString(locale), (0.256).toLocaleString(locale, { style: "percent" }), (42).toLocaleString(locale, { style: "currency", currency: "GBP" }));`,
  "number-to-locale-string-of-the-environment": `console.log((1234567.891).toLocaleString(), (-0.5).toLocaleString(), (1e21).toLocaleString(), NaN.toLocaleString());`,
  "bigint-to-locale-string": `${someLocales}
for (const locale of locales) console.log(locale, 123456789012345678901234567890n.toLocaleString(locale), 5n.toLocaleString(locale, { style: "unit", unit: "liter" }));`,
  "array-to-locale-string": `${someLocales}
for (const locale of locales) console.log(locale, [1234.5, new Date(0), 7n, "text"].toLocaleString(locale, { timeZone: "UTC" }), new Float64Array([1234.5, 0.25]).toLocaleString(locale));`,
  "date-time-format": `${everyLocale("Intl.DateTimeFormat")}
const date = new Date(Date.UTC(2024, 1, 29, 15, 4, 5, 678));
const styles = [{ timeZone: "UTC" }, { dateStyle: "full", timeStyle: "full", timeZone: "UTC" }, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }, { month: "long", weekday: "long", era: "long", timeZone: "UTC" }, { timeZoneName: "long", timeZone: "America/New_York" }, { hour: "numeric", dayPeriod: "long", timeZone: "UTC" }, { fractionalSecondDigits: 3, second: "numeric", timeZone: "UTC" }];
for (const locale of locales) console.log(locale, styles.map(style => shown(() => new Intl.DateTimeFormat(locale, style).format(date))).join(" | "));
console.log(JSON.stringify(new Intl.DateTimeFormat("fr", { dateStyle: "long", timeZone: "UTC" }).formatToParts(date)), new Intl.DateTimeFormat("en", { timeZone: "UTC" }).formatRange(date, new Date(date.getTime() + 864e5 * 40)));`,
  "date-to-locale-string": `${someLocales}
const date = new Date(Date.UTC(2024, 1, 29, 15, 4, 5));
for (const locale of locales) console.log(locale, date.toLocaleString(locale, { timeZone: "UTC" }), "|", date.toLocaleDateString(locale, { timeZone: "UTC", dateStyle: "full" }), "|", date.toLocaleTimeString(locale, { timeZone: "Europe/Berlin" }));`,
  "date-of-the-environment": `const date = new Date(Date.UTC(2024, 6, 4, 12, 0, 0));
console.log(date.toString(), "|", date.toLocaleString(), "|", date.toLocaleDateString(), "|", date.toLocaleTimeString(), "|", date.getTimezoneOffset(), "|", new Date(2024, 0, 1).toISOString(), "|", new Date(1970, 5, 1, 2, 30).getTime(), "|", new Date("2024-03-10T02:30:00").toString(), "|", Date.parse("Mar 31 2024 02:30"));`,
  "time-zones": `const date = new Date(Date.UTC(2024, 1, 29, 15, 4, 5));
const zones = Intl.supportedValuesOf("timeZone");
console.log(zones.length, "time zones");
for (const timeZone of zones) console.log(timeZone, new Intl.DateTimeFormat("en", { timeZone, dateStyle: "short", timeStyle: "long" }).format(date), "|", new Intl.DateTimeFormat("de", { timeZone, timeZoneName: "long" }).format(date));`,
  "calendars": `const date = new Date(Date.UTC(2024, 1, 29));
for (const calendar of Intl.supportedValuesOf("calendar")) for (const locale of ["en", "ar", "ja", "he", "th", "zh"]) console.log(calendar, locale, new Intl.DateTimeFormat(locale, { calendar, dateStyle: "full", timeZone: "UTC" }).format(date));`,
  "numbering-systems": `for (const numberingSystem of Intl.supportedValuesOf("numberingSystem")) console.log(numberingSystem, new Intl.NumberFormat("en", { numberingSystem }).format(1234567890.5));`,
  "supported-values": `for (const key of ["calendar", "collation", "currency", "numberingSystem", "timeZone", "unit"]) console.log(key, Intl.supportedValuesOf(key).join());
for (const tag of ["EN-us", "zh-hans-cn", "sr-latn-rs", "art-lojban", "i-klingon", "en-u-ca-gregory", "cmn", "iw", "en-US-posix"]) console.log(tag, shown(() => Intl.getCanonicalLocales(tag).join()));`,
  "collator": `${everyLocale("Intl.Collator")}
const words = ["ä", "a", "z", "Z", "ß", "ss", "æ", "ch", "c", "d", "ñ", "n", "i", "ı", "İ", "I", "ö", "o", "å", "10", "9", "é", "e", "ll", "l", "м", "и", "一", "丁", "あ", "ア", "가", "나"];
for (const locale of locales) console.log(locale, [...words].sort(new Intl.Collator(locale).compare).join(""), [...words].sort(new Intl.Collator(locale, { numeric: true, caseFirst: "upper", sensitivity: "base" }).compare).join(""));
console.log(new Intl.Collator("de", { usage: "search", sensitivity: "base" }).compare("ä", "a"), JSON.stringify(new Intl.Collator("sv").resolvedOptions()));`,
  "locale-compare": `${someLocales}
const words = ["ä", "a", "z", "Z", "ß", "ss", "ch", "c", "ñ", "n", "i", "ı", "ö", "o", "å", "10", "9", "é", "e"];
for (const locale of locales) console.log(locale, [...words].sort((one, other) => one.localeCompare(other, locale)).join(""), "a".localeCompare("A", locale, { sensitivity: "base" }));`,
  "locale-compare-of-the-environment": `console.log(["ä", "a", "z", "Z", "ö", "o", "10", "9", "é", "e"].sort((one, other) => one.localeCompare(other)).join(""));`,
  "plural-rules": `${everyLocale("Intl.PluralRules")}
const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 20, 21, 22, 100, 101, 1.5, 1000000];
for (const locale of locales) console.log(locale, numbers.map(number => new Intl.PluralRules(locale).select(number)).join(), numbers.map(number => new Intl.PluralRules(locale, { type: "ordinal" }).select(number)).join());`,
  "relative-time-format": `${everyLocale("Intl.RelativeTimeFormat")}
for (const locale of locales) console.log(locale, new Intl.RelativeTimeFormat(locale).format(-1, "day"), "|", new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day"), "|", new Intl.RelativeTimeFormat(locale, { style: "narrow" }).format(5, "month"), "|", new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "year"));`,
  "list-format": `${everyLocale("Intl.ListFormat")}
for (const locale of locales) console.log(locale, ["conjunction", "disjunction", "unit"].flatMap(type => ["long", "short", "narrow"].map(style => new Intl.ListFormat(locale, { type, style }).format(["a", "b", "c"]))).join(" | "));`,
  "display-names": `${everyLocale("Intl.DisplayNames")}
const asked = [["region", "US"], ["region", "DE"], ["language", "fr"], ["language", "zh-Hant"], ["currency", "USD"], ["script", "Latn"], ["calendar", "gregory"], ["dateTimeField", "month"]];
for (const locale of locales) console.log(locale, asked.map(([type, code]) => shown(() => new Intl.DisplayNames(locale, { type }).of(code))).join(" | "));`,
  "segmenter": `const texts = ["The quick (brown) fox can't jump 32.3 feet, right? Yes. No!", "สวัสดีครับวันนี้อากาศดีมาก", "今日は天気がいいですね。明日も晴れるでしょう。", "我们今天去北京大学。", "👩‍👩‍👧‍👦🇺🇸é̂한국어", "ខ្ញុំស្រឡាញ់ភាសាខ្មែរ", "မြန်မာစာ"];
for (const granularity of ["grapheme", "word", "sentence"]) for (const locale of ["en", "th", "ja", "zh", "km", "my"]) for (const text of texts) console.log(granularity, locale, [...new Intl.Segmenter(locale, { granularity }).segment(text)].map(part => part.segment + (part.isWordLike ? "*" : "")).join("|"));`,
  "duration-format": `${someLocales}
for (const locale of locales) console.log(locale, ["long", "short", "narrow", "digital"].map(style => shown(() => new Intl.DurationFormat(locale, { style }).format({ years: 1, days: 2, hours: 3, minutes: 4, seconds: 5, milliseconds: 6 }))).join(" | "));`,
  "locale": `for (const tag of ["en", "zh", "zh-TW", "sr", "ar", "he", "und-US", "pt", "ja-JP-u-ca-japanese", "en-Latn-US-u-hc-h23-nu-arab", "de-AT", "fa", "ur", "yue", "az-Arab"]) {
  const locale = new Intl.Locale(tag);
  console.log(tag, locale.maximize().toString(), locale.minimize().toString(), locale.language, locale.script, locale.region, shown(() => JSON.stringify(locale.getWeekInfo())), shown(() => JSON.stringify(locale.getTextInfo())), shown(() => locale.getCalendars().join()), shown(() => locale.getHourCycles().join()), shown(() => locale.getNumberingSystems().join()), shown(() => String(locale.getTimeZones()?.slice(0, 3))), shown(() => locale.getCollations().join()));
}`,
  "case-mapping": `const words = ["ıstanbul İSTANBUL i I", "lietuvių Į̃ J̃ Ì", "ΟΔΥΣΣΕΥΣ ὈΔΥΣΣΕΎΣ ς", "straße ǆ ﬁ ŉ", "ĳsselmeer"];
for (const locale of [undefined, "en", "tr", "az", "lt", "el", "nl", "de"]) for (const word of words) console.log(locale, word.toLocaleUpperCase(locale), "|", word.toLocaleLowerCase(locale));
for (const word of words) console.log(word.toUpperCase(), "|", word.toLowerCase());`,
  "normalize": `const texts = ["Å Å é ﬁ ① ㌀ ｶﾞ 한 각 ẛ̣ ǆ ⁵ ℌ Ω", "\\u1E9B\\u0323", "\\uD55C\\uAE00", "\\u0041\\u030A\\u0301\\u0328", "ครับ"];
for (const form of ["NFC", "NFD", "NFKC", "NFKD"]) for (const text of texts) console.log(form, [...text.normalize(form)].map(character => character.codePointAt(0).toString(16)).join(" "));
console.log("a\\u0301".normalize() === "\\u00e1");`,
  "regexp-properties": `const text = "aZ9 _ß Ωж א ع अ ก 中 あ ア 한 😀 ǅ ² ⅷ \\u0301 \\u200d $ + ( « \\u2028";
for (const property of ["L", "Lu", "Ll", "Lt", "Lm", "Lo", "M", "Mn", "N", "Nd", "Nl", "No", "P", "Ps", "Pi", "S", "Sc", "Sm", "Z", "Zl", "Cf", "Alphabetic", "White_Space", "Emoji", "Emoji_Presentation", "ID_Start", "ID_Continue", "Uppercase", "Lowercase", "Any", "ASCII", "Assigned", "Script=Latin", "Script=Greek", "Script=Cyrillic", "Script=Hebrew", "Script=Arabic", "Script=Devanagari", "Script=Thai", "Script=Han", "Script=Hiragana", "Script=Katakana", "Script=Hangul", "Script_Extensions=Latin", "sc=Grek", "scx=Hira", "General_Category=Decimal_Number"])
  console.log(property, (text.match(new RegExp("\\\\p{" + property + "}", "gu")) ?? []).join(""), (text.match(new RegExp("\\\\P{" + property + "}", "gu")) ?? []).length);
console.log(/\\p{Script=Greek}+/u.exec("abc ΑΒΓ")[0], /[\\p{L}--\\p{Script=Latin}]+/v.exec("abc жзи")[0], /^\\p{RGI_Emoji}$/v.test("👩‍👩‍👧‍👦"), /ſ/iu.test("S"), /\\u212a/iu.test("k"), /[^\\W]/iu.test("ſ"), "ǅ".match(/ǆ/iu)?.[0]);`,
  "temporal-calendars": `const date = Temporal.PlainDate.from("2024-02-29");
for (const calendar of Intl.supportedValuesOf("calendar")) console.log(calendar, shown(() => { const other = date.withCalendar(calendar); return [other.era, other.eraYear, other.year, other.monthCode, other.day, other.daysInMonth, other.monthsInYear, other.inLeapYear, other.toString(), other.toLocaleString("en", { calendar })].join(" "); }));
console.log(Temporal.ZonedDateTime.from("2024-03-10T01:59:59[America/Los_Angeles]").add({ seconds: 1 }).toString(), Temporal.Instant.from("2024-02-29T00:00Z").toZonedDateTimeISO("Asia/Kolkata").toLocaleString("hi"), Temporal.Now.timeZoneId());`,
  "resolved-options-of-the-environment": `console.log(JSON.stringify([new Intl.NumberFormat().resolvedOptions(), new Intl.DateTimeFormat().resolvedOptions(), new Intl.Collator().resolvedOptions(), new Intl.PluralRules().resolvedOptions().locale, new Intl.ListFormat().resolvedOptions(), new Intl.Segmenter().resolvedOptions()]));`,
};

const environments: Record<string, Record<string, string>> = {
  "": {},
  "German in Berlin": { LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8", TZ: "Europe/Berlin" },
  "Japanese in Tokyo": { LANG: "ja_JP.UTF-8", LC_ALL: "ja_JP.UTF-8", TZ: "Asia/Tokyo" },
  "Arabic in Cairo": { LANG: "ar_EG.UTF-8", LC_ALL: "ar_EG.UTF-8", TZ: "Africa/Cairo" },
  "Hindi in Kolkata": { LANG: "hi_IN.UTF-8", LC_ALL: "hi_IN.UTF-8", TZ: "Asia/Kolkata" },
  "Portuguese in Sao Paulo": { LANG: "pt_BR.UTF-8", LC_ALL: "pt_BR.UTF-8", TZ: "America/Sao_Paulo" },
  "the C locale on Lord Howe Island": { LANG: "C", LC_ALL: "C", TZ: "Australia/Lord_Howe" },
  "a locale and a time zone that do not exist": { LANG: "xx_YY.UTF-8", LC_ALL: "xx_YY.UTF-8", TZ: "Nowhere/Special" },
};

export function programsOfEveryLocale(): Program[] {
  return Object.entries(programs).flatMap(([name, text]) =>
    Object.entries(environments)
      .filter(([environment]) => environment === "" || name.includes("environment") || /^(date|number|locale-compare|temporal|case)/.test(name))
      .map(([environment, env]) => ({ corpus: "locales", name: environment ? `${name}, ${environment}` : name, entry: "program.mjs", files: () => ({ "program.mjs": shown + text + "\n" }), env })),
  );
}
