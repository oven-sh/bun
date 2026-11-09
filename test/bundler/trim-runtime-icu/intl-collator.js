import { attempt, COLLATIONS, done, LOCALES, SOME } from "./lists.js";

for (const locale of LOCALES) { attempt(() => new Intl.Collator(locale).compare("a", "ä")); attempt(() => JSON.stringify(new Intl.Collator(locale, { usage: "search" }).resolvedOptions())); }
for (const locale of SOME) for (const collation of COLLATIONS) attempt(() => JSON.stringify(new Intl.Collator(locale, { collation }).resolvedOptions()));
attempt(() => Intl.Collator.supportedLocalesOf(LOCALES).length);
done("intl-collator");
