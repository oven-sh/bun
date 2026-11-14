import { attempt, CALENDARS, done, LOCALES, SOME } from "./lists.js";

const codes = { language: ["en", "en-US", "de-AT", "zh-Hant", "sr-Latn-RS", "und", "fr-CA", "pt-BR", "yue", "ckb"], region: ["US", "DE", "419", "001", "UN", "XK", "JP"], script: ["Latn", "Cyrl", "Hant", "Arab", "Adlm"], currency: ["USD", "EUR", "JPY", "XXX"], calendar: CALENDARS, dateTimeField: ["era", "year", "quarter", "month", "weekOfYear", "weekday", "day", "dayPeriod", "hour", "minute", "second", "timeZoneName"] };
for (const locale of LOCALES) for (const type in codes) for (const style of ["long", "short", "narrow"]) for (const code of codes[type]) attempt(() => new Intl.DisplayNames(locale, { type, style }).of(code));
for (const locale of SOME) for (const languageDisplay of ["dialect", "standard"]) for (const fallback of ["code", "none"]) attempt(() => new Intl.DisplayNames(locale, { type: "language", languageDisplay, fallback }).of("en-GB"));
attempt(() => Intl.DisplayNames.supportedLocalesOf(LOCALES).length);
done("intl-displaynames");
