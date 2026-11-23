import { domainToASCII, domainToUnicode } from "node:url";
import { attempt, done, LOCALES, use, ZONES } from "./lists.js";

for (const zone of ZONES.concat(["Etc/GMT+5", "Etc/GMT-14", "UTC", "Etc/Unknown", "Nowhere/Nothing", "EST5EDT", "US/Pacific", "Asia/Calcutta", "Antarctica/Troll", "+05:30"])) {
  process.env.TZ = zone;
  for (const ms of [Date.UTC(2024, 0, 15), Date.UTC(2024, 6, 15), Date.UTC(1900, 0, 1)]) {
    const date = new Date(ms);
    use(date.toString());
    use(date.toTimeString());
    use(`${date}`);
  }
  for (let year = 1850; year <= 2100; year += 11) for (const month of [0, 2, 5, 9]) {
    const date = new Date(year, month, 15, 2, 30);
    use(date.getTime());
    use(date.getHours());
    use(date.getTimezoneOffset());
  }
  use(Date.parse("2024-07-01T12:00:00"));
  use(Date.parse("Jan 5 2024 10:00"));
}
let text = "";
for (let c = 0x80; c < 0x30000; c++) {
  if (c >= 0xd800 && c < 0xe000) continue;
  text += String.fromCodePoint(c);
  if (text.length < 4000) continue;
  use(text.toUpperCase());
  use(text.toLowerCase());
  for (const form of ["NFC", "NFD", "NFKC", "NFKD"]) use(text.normalize(form));
  text = "";
}
for (const locale of LOCALES) for (const s of ["iıİI", "ΑΣ άς", "straße ﬁ"]) {
  attempt(() => s.toLocaleUpperCase(locale));
  attempt(() => s.toLocaleLowerCase(locale));
}
for (const host of ["bücher.example", "xn--bcher-kva.example", "日本語.jp", "faß.de", "٠١.example", "a‍b.example", "א.example", "мир.рф", "xn--a.example"]) {
  attempt(() => new URL("https://" + host + "/p").href);
  attempt(() => domainToASCII(host));
  attempt(() => domainToUnicode(host));
}
const sample = "Straße ΑΣς İi ǆ K K ſ 𐐀𐐨 漢字 😀 é";
for (const pattern of [/ss/iu, /σ/iu, /k/iu, /\p{Lu}+/gu, /\p{Script=Greek}+/gu, /\p{Emoji_Presentation}/gu, /[\p{L}--\p{ASCII}]+/gv, /(?<názov>\p{L}+)/u]) attempt(() => JSON.stringify(sample.match(pattern)));
for (const s of ["abc", "漢字", "😀", "👨‍👩‍👧", "é", "🇺🇸", "✈️", "👍🏽"]) attempt(() => Bun.stringWidth(s));
attempt(() => Bun.inspect(new Date(0)));
attempt(() => ["b", "a", "ä", "Z"].sort().join());
attempt(() => navigator.language);
done("none of the names");
