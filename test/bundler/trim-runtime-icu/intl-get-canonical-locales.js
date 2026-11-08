import { attempt, done, LOCALES } from "./lists.js";

for (const tag of LOCALES) attempt(() => Intl.getCanonicalLocales(tag).join());
for (const tag of ["en-u-ca-islamicc", "sgn-DE", "art-lojban", "i-klingon", "zh-min-nan", "cmn-Hans", "en-BU", "hy-arevela", "ja-Latn-hepburn-heploc", "und-Qaai", "en-u-tz-usnyc", "de-u-co-phonebk-kn", "sh", "mo", "iw", "aar", "en-840", "EN-us", "x-private", "en-t-de-m0-ungegn"]) attempt(() => Intl.getCanonicalLocales(tag).join());
done("intl-canonical");
