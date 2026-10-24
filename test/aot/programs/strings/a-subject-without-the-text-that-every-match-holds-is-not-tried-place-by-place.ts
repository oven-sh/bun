// Every match of these patterns holds a character or a text that stands behind a run of many characters. In a subject without it no place is tried. Each is timed against itself with one more alternative,
// a run longer than any in the subject, which holds nothing in particular: that one has to be tried place by place.
const nothing = String(Date.now()).slice(99);
const words = "the worker-7 finished job 8123 in 41 ms with status ok and no retries left ".repeat(1500) + "end";
const searches: [string, RegExp, RegExp][] = [
  ["a literal, a character behind a bounded run:", /\b([a-z0-9-]{1,64}@[a-z0-9-]+)\b/i, /\b([a-z0-9-]{1,64}@[a-z0-9-]+)\b|[a-z0-9-]{70}/i],
  ["a literal, a text behind two runs:", /\b([a-z0-9-]+\.[a-z0-9-]+\.example\.invalid)\b/i, /\b([a-z0-9-]+\.[a-z0-9-]+\.example\.invalid)\b|[a-z0-9-]{70}/i],
  ["a literal, one of two signs behind a word:", /\b[a-z]+\s*[=#]\s*(\S+)/i, /\b[a-z]+\s*[=#]\s*(\S+)|[a-z]{70}/i],
  ["a literal in unicode mode, a character behind a bounded run:", /\b([\p{L}\p{N}-]{1,64}@[a-z0-9-]+)\b/u, /\b([\p{L}\p{N}-]{1,64}@[a-z0-9-]+)\b|[\p{L}\p{N}-]{70}/u],
  ["a literal, a run that has to reach the end:", /[ \t\r\n\xa0\u2003\ufeff]+$/, /[ \t\r\n\xa0\u2003\ufeff]+$|[a-z0-9-]{70}/],
  ["a literal, a run at the start or one that has to reach the end:", /^[ \t\r\n\xa0\u2003\ufeff]+|[ \t\r\n\xa0\u2003\ufeff]+$/, /^[ \t\r\n\xa0\u2003\ufeff]+|[ \t\r\n\xa0\u2003\ufeff]+$|[a-z0-9-]{70}/],
  ["run-time text, a run that has to reach the end:", new RegExp("[ \\t\\xa0]+$" + nothing), new RegExp("[ \\t\\xa0]+$|[a-z0-9-]{70}" + nothing)],
  ["run-time text, a character behind a bounded run:", new RegExp("\\b([a-z0-9-]{1,63}@[a-z0-9-]+)\\b" + nothing, "i"), new RegExp("\\b([a-z0-9-]{1,63}@[a-z0-9-]+)\\b|[a-z0-9-]{70}" + nothing, "i")],
  ["run-time text, a text behind two runs:", new RegExp("\\b([a-z0-9-]+\\.[a-z0-9-]+\\.example\\.test)\\b" + nothing, "i"), new RegExp("\\b([a-z0-9-]+\\.[a-z0-9-]+\\.example\\.test)\\b|[a-z0-9-]{70}" + nothing, "i")],
  ["run-time text that looks back over a group, a character behind a run:", new RegExp("(?<!(?:x|y)+z)\\b([a-z0-9-]{1,64}@[a-z0-9-]+)\\b" + nothing, "i"), new RegExp("(?<!(?:x|y)+z)\\b([a-z0-9-]{1,64}@[a-z0-9-]+)\\b|[a-z0-9-]{70}" + nothing, "i")],
];
function fastestOf(runs: number, pattern: RegExp, subject: string): number {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (pattern.test(subject)) console.log("found");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
for (const subject of [words, "\u4e00 " + words]) {
  for (const [name, pattern, triedEverywhere] of searches)
    console.log(name, fastestOf(12, pattern, subject) * 6 < fastestOf(4, triedEverywhere, subject) ? "no place is tried" : "as slow as a try at every place");
}
