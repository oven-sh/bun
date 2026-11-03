import { attempt, done, LOCALES, SOME } from "./lists.js";

const d = { years: 1, months: 2, weeks: 3, days: 4, hours: 5, minutes: 6, seconds: 7, milliseconds: 8, microseconds: 9, nanoseconds: 10 };
for (const locale of LOCALES) for (const style of ["long", "short", "narrow", "digital"]) { attempt(() => new Intl.DurationFormat(locale, { style }).format(d)); attempt(() => JSON.stringify(new Intl.DurationFormat(locale, { style, fractionalDigits: 2 }).formatToParts({ hours: 1, seconds: 2.5 ? 2 : 0, milliseconds: 500 }))); }
for (const locale of SOME) attempt(() => JSON.stringify(new Intl.DurationFormat(locale, { numberingSystem: "arab", hours: "2-digit" }).resolvedOptions()));
attempt(() => Intl.DurationFormat.supportedLocalesOf(LOCALES).length);
done("intl-durationformat");
