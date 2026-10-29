declare const Intl: any;
console.log(
  new Intl.DisplayNames("en", { type: "region" }).of("DE"),
  new Intl.DisplayNames("de", { type: "language" }).of("fr"),
);
console.log(new Intl.ListFormat("en").format(["a", "b", "c"]));
console.log(new Intl.Locale("zh").maximize().toString(), new Intl.Locale("en-US", { hourCycle: "h23" }).toString());
console.log(
  new Intl.PluralRules("en").select(1),
  new Intl.PluralRules("en", { type: "ordinal" }).select(2),
  new Intl.PluralRules("ar").select(3),
);
console.log(
  new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-1, "day"),
  new Intl.RelativeTimeFormat("es").format(3, "month"),
);
console.log(
  [...new Intl.Segmenter("en", { granularity: "word" }).segment("two words")]
    .map((part: any) => part.segment)
    .join("|"),
);
console.log([...new Intl.Segmenter("en").segment("éa")].length);
console.log(Intl.getCanonicalLocales("EN-us")[0], Intl.supportedValuesOf("calendar").length > 10);
console.log(new Intl.NumberFormat(new Intl.Locale("de")).format(1234.5));
