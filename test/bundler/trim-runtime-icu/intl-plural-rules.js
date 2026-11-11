import { attempt, done, LOCALES } from "./lists.js";

for (const locale of LOCALES) for (const type of ["cardinal", "ordinal"]) { const f = () => new Intl.PluralRules(locale, { type });
  for (const v of [0, 1, 2, 3, 5, 11, 21, 100, 1.5, 1e6]) attempt(() => f().select(v)); attempt(() => f().selectRange(1, 5)); attempt(() => JSON.stringify(f().resolvedOptions())); attempt(() => new Intl.PluralRules(locale, { type, notation: "compact", minimumFractionDigits: 2 }).select(1e6)); }
attempt(() => Intl.PluralRules.supportedLocalesOf(LOCALES).length);
done("intl-pluralrules");
