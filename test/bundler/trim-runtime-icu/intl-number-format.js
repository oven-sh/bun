import { attempt, done, LOCALES } from "./lists.js";

for (const locale of LOCALES) { const f = () => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  attempt(() => f().formatRange(1, 2000)); attempt(() => JSON.stringify(f().formatToParts(-1234.5))); attempt(() => JSON.stringify(f().formatRangeToParts(3, 5))); attempt(() => JSON.stringify(f().resolvedOptions()));
  attempt(() => new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "long" }).formatRange(1, 2)); attempt(() => new Intl.NumberFormat(locale, { notation: "compact", compactDisplay: "long" }).formatRange(1000, 2e6)); attempt(() => new Intl.NumberFormat(locale).format("1234567890123456789012345.678")); }
attempt(() => Intl.NumberFormat.supportedLocalesOf(LOCALES).length);
done("intl-numberformat");
