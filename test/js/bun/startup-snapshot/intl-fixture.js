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
  dur: typeof Intl.DurationFormat === "function" ? new Intl.DurationFormat("en", { style: "long" }) : null,
};
// Iteration objects held across the boundary too: a Segments object, and an iterator that has already been advanced one step.
const heldSegments = objs.seg.segment("今日は良い天気ですね");
const heldIterator = heldSegments[Symbol.iterator]();
const firstBeforeBoundary = heldIterator.next().value.segment;
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
    objs.dur ? objs.dur.format({ hours: 1, minutes: 2 }) : "(no DurationFormat)",
    heldSegments.containing(3).segment,
    firstBeforeBoundary + ">" + Array.from({ length: 3 }, () => heldIterator.next().value?.segment).join("|"),
    new Date(0).toLocaleString("en-GB", { timeZone: "UTC" }),
  ].join("\n");
}
if (process.env.PLAIN) {
  console.log(use());
} else {
  process.on("restore", () => { console.log(use()); process.exit(0); });
  setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
}
