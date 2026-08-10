// Every Intl object is created before the freeze and used only after restore (or, in a plain run, used right away): each holds
// ICU state, and any of it that were per-process would show up as different output or a crash. Output is compared between the
// two kinds of run by the test.
const objs = {
  collator: new Intl.Collator("de"),
  dtf: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full", timeStyle: "long" }),
  nf: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }),
  pr: new Intl.PluralRules("ar-EG"),
  rtf: new Intl.RelativeTimeFormat("es", { numeric: "auto" }),
  lf: new Intl.ListFormat("en", { type: "conjunction" }),
  dn: new Intl.DisplayNames("fr", { type: "region" }),
  seg: new Intl.Segmenter("ja", { granularity: "word" }),
  locale: new Intl.Locale("en-Latn-US-u-ca-gregory"),
};
function use() {
  return [
    ["ä", "a", "z"].sort(objs.collator.compare).join(""),
    objs.dtf.format(new Date(Date.UTC(2020, 1, 29, 12, 34, 56))),
    objs.nf.format(1234567.891),
    [0, 1, 2, 3, 11, 100].map(n => objs.pr.select(n)).join(","),
    objs.rtf.format(-1, "day") + "|" + objs.rtf.format(2, "week"),
    objs.lf.format(["a", "b", "c"]),
    objs.dn.of("JP"),
    Array.from(objs.seg.segment("東京都に住んでいます"), s => s.segment).join("/"),
    objs.locale.maximize().toString(),
    new Date(0).toLocaleString("en-GB", { timeZone: "UTC" }),
  ].join("\n");
}
if (process.env.PLAIN) {
  console.log(use());
} else {
  process.on("restore", () => { console.log(use()); process.exit(0); });
  setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
}
