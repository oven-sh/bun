import { attempt, done, LOCALES } from "./lists.js";

for (const locale of LOCALES) for (const type of ["conjunction", "disjunction", "unit"]) for (const style of ["long", "short", "narrow"]) { attempt(() => new Intl.ListFormat(locale, { type, style }).format(["a", "b", "c", "i", "o"])); attempt(() => JSON.stringify(new Intl.ListFormat(locale, { type, style }).formatToParts(["x", "y"]))); }
attempt(() => Intl.ListFormat.supportedLocalesOf(LOCALES).length);
done("intl-listformat");
