import { attempt, done, LOCALES } from "./lists.js";

const a = new Date(Date.UTC(2024, 0, 15, 3, 4, 5)), b = new Date(Date.UTC(2024, 0, 15, 17)), c = new Date(Date.UTC(2025, 5, 1));
for (const locale of LOCALES) for (const o of [{}, { dateStyle: "full", timeStyle: "full" }, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "numeric", timeZoneName: "short" }, { month: "long", calendar: "japanese", era: "long", year: "numeric" }, { hour: "numeric", dayPeriod: "short" }]) { const f = () => new Intl.DateTimeFormat(locale, { timeZone: "Europe/Paris", ...o });
  attempt(() => f().formatRange(a, b)); attempt(() => f().formatRange(a, c)); attempt(() => JSON.stringify(f().formatToParts(a))); attempt(() => JSON.stringify(f().formatRangeToParts(a, c))); attempt(() => JSON.stringify(f().resolvedOptions())); }
attempt(() => Intl.DateTimeFormat.supportedLocalesOf(LOCALES).length);
attempt(() => new Intl.DateTimeFormat().resolvedOptions().timeZone);
done("intl-datetimeformat");
