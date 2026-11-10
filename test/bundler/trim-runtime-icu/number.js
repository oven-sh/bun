import { attempt, CURRENCIES, done, LOCALES, NUMBERING, SOME, UNITS } from "./lists.js";

const plain = [undefined, {}, { style: "percent" }, { notation: "scientific" }, { notation: "engineering" }, { signDisplay: "always" }, { useGrouping: "min2" }, { useGrouping: false }, { minimumIntegerDigits: 3 }, { maximumSignificantDigits: 3 }, { roundingIncrement: 5, maximumFractionDigits: 2 }];
for (const locale of LOCALES) {
  for (const options of plain) for (const value of [1234567.891, -0.5, NaN]) attempt(() => value.toLocaleString(locale, options));
  for (const compactDisplay of ["short", "long"]) for (const value of [1, 1234, 2e9]) attempt(() => value.toLocaleString(locale, { notation: "compact", compactDisplay }));
  for (const numbers of ["native", "traditio", "finance", "arab", "hanidec"]) attempt(() => (2024.5).toLocaleString(locale + "-u-nu-" + numbers));
  for (const currencyDisplay of ["symbol", "narrowSymbol", "code", "name"]) for (const currency of ["USD", "EUR", "JPY", "XXX"]) attempt(() => (-1234.5).toLocaleString(locale, { style: "currency", currency, currencyDisplay, currencySign: "accounting" }));
  for (const unitDisplay of ["long", "short", "narrow"]) for (const unit of ["kilometer-per-hour", "celsius", "day", "byte"]) attempt(() => (2.5).toLocaleString(locale, { style: "unit", unit, unitDisplay }));
}
for (const locale of SOME) {
  attempt(() => 12345678901234567890n.toLocaleString(locale));
  for (const numberingSystem of NUMBERING.concat(["hebr", "roman", "jpan", "hant", "taml"])) attempt(() => (1234567.891).toLocaleString(locale, { numberingSystem }));
  for (const currency of CURRENCIES) attempt(() => (2).toLocaleString(locale, { style: "currency", currency, currencyDisplay: "name" }));
  for (const unit of UNITS) for (const value of [1, 5.5]) attempt(() => value.toLocaleString(locale, { style: "unit", unit, unitDisplay: "long" }));
  attempt(() => [1234.5, "x", null].toLocaleString(locale));
  attempt(() => new Float64Array([1234.5, 2]).toLocaleString(locale));
}
attempt(() => (1234.5).toLocaleString());
done("number");
