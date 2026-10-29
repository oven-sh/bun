import { attempt, done, LOCALES, SOME } from "./lists.js";

for (const locale of LOCALES) for (const style of ["long", "short", "narrow"]) for (const numeric of ["always", "auto"]) for (const unit of ["second", "minute", "hour", "day", "week", "month", "quarter", "year"]) for (const v of [-1, 0, 1, 2, 5.5]) attempt(() => new Intl.RelativeTimeFormat(locale, { style, numeric }).format(v, unit));
for (const locale of SOME) { attempt(() => JSON.stringify(new Intl.RelativeTimeFormat(locale).formatToParts(-3, "day"))); attempt(() => JSON.stringify(new Intl.RelativeTimeFormat(locale, { numberingSystem: "arab" }).resolvedOptions())); }
attempt(() => Intl.RelativeTimeFormat.supportedLocalesOf(LOCALES).length);
done("intl-relativetimeformat");
