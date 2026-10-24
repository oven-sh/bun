// A literal with the flag u whose matches begin with a character outside ASCII: on a subject of 16-bit characters that is nearly all ASCII the search takes a fraction of the time it takes where every character has to be tested.
const invisible = /[\p{Cf}\p{Variation_Selector}]/gu;
const length = 400000;
const ascii = "\u4e00" + "the quick brown fox ".repeat(length / 20);
let tested = "";
for (let i = 0; i <= length; i += 100) tested += "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341".repeat(10);
function fastestOf(runs: number, subject: string): number {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (subject.replace(invisible, "").length !== subject.length) console.log("a match in", subject.length);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest / subject.length;
}
const passedOver = fastestOf(20, ascii), one = fastestOf(20, tested);
console.log(passedOver * 5 < one ? "ASCII is passed over in under a fifth of the time of a test" : "ASCII takes over a fifth of the time of a test");
