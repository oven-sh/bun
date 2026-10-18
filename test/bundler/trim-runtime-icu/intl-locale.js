import { attempt, done, LOCALES } from "./lists.js";

for (const tag of LOCALES) { const l = () => new Intl.Locale(tag);
  for (const m of ["maximize", "minimize", "toString"]) attempt(() => l()[m]().toString());
  for (const m of ["getCalendars", "getCollations", "getHourCycles", "getNumberingSystems", "getTimeZones", "getTextInfo", "getWeekInfo"]) attempt(() => JSON.stringify(l()[m]()));
  for (const p of ["baseName", "calendar", "caseFirst", "collation", "hourCycle", "numeric", "numberingSystem", "language", "script", "region", "variants"]) attempt(() => l()[p]); }
for (const tag of ["en-u-ca-islamicc", "sgn-DE", "art-lojban", "i-klingon", "zh-min-nan", "cmn-Hans", "en-BU", "hy-arevela", "ja-Latn-hepburn-heploc", "und-Qaai", "en-u-tz-usnyc", "de-u-co-phonebk-kn", "sh", "mo", "iw", "aar", "en-840"]) attempt(() => new Intl.Locale(tag).maximize().toString());
done("intl-locale");
