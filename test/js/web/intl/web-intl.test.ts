import { describe, expect, it } from "bun:test";

// Define a set of diverse locales and currencies
const locales = [
  "id-ID",
  "en-US",
  "fr-FR",
  "ja-JP",
  "de-DE",
  "es-ES",
  "it-IT",
  "pt-BR",
  "ru-RU",
  "tr-TR",
  "zh-CN",
  "ar-SA",
  "hi-IN",
  "ar-KW",
  "ar-BH",
];
const currencies = ["IDR", "USD", "EUR", "JPY", "GBP", "MXN", "BRL", "RUB", "TRY", "CNY", "SAR", "INR", "KWD", "BHD"];

describe("Web Intl", () => {
  it("has globals", () => {
    expect(Intl.Collator.name).toBe("Collator");
    expect(Intl.DateTimeFormat.name).toBe("DateTimeFormat");
    expect(Intl.DisplayNames.name).toBe("DisplayNames");
    expect(Intl.ListFormat.name).toBe("ListFormat");
    expect(Intl.Locale.name).toBe("Locale");
    expect(Intl.NumberFormat.name).toBe("NumberFormat");
    expect(Intl.PluralRules.name).toBe("PluralRules");
    expect(Intl.RelativeTimeFormat.name).toBe("RelativeTimeFormat");
  });

  // Test for multiple locales and currencies
  locales.forEach(locale => {
    currencies.forEach(currency => {
      it(`should format number as currency correctly in ${locale} with ${currency}`, () => {
        const number = 123456.789;
        const options = { style: "currency", currency };
        expect(new Intl.NumberFormat(locale, options).format(number)).toMatchSnapshot();
      });

      it(`should format date correctly in ${locale}`, () => {
        const date = new Date("2021-01-01T00:00:00.000Z");
        expect(new Intl.DateTimeFormat(locale).format(date)).toMatchSnapshot();
      });

      it(`should format list correctly in ${locale}`, () => {
        const list = ["a", "b", "c"];
        expect(new Intl.ListFormat(locale).format(list)).toMatchSnapshot();
      });

      it(`should format plural rules correctly in ${locale}`, () => {
        const number = 1;
        expect(new Intl.PluralRules(locale).select(number)).toMatchSnapshot();
      });

      it(`should format relative time correctly in ${locale}`, () => {
        const number = -1;
        const unit = "day";
        expect(new Intl.RelativeTimeFormat(locale).format(number, unit)).toMatchSnapshot();
      });

      it(`should format display names correctly in ${locale}`, () => {
        const options: Intl.DisplayNamesOptions = { type: "language" };
        expect(new Intl.DisplayNames(locale, options).of("en")).toMatchSnapshot();
      });

      it(`should compare strings correctly in ${locale}`, () => {
        const collator = new Intl.Collator(locale);
        const a = "a";
        const b = "b";
        expect(collator.compare(a, b)).toMatchSnapshot();
      });
    });
  });
});
