// Patterns built at run time that backtrack past the flat program's step limit, so the bytecode interpreter finishes the match, before and after their code is purged.
const collect: () => void = (globalThis as any).gc ?? (() => Bun.gc(true));
const tail = Date.now() < 0 ? "x" : "";

const patterns: [string, string][] = [
  ["(a|aa)+b", ""],
  ["(x*)*y", ""],
  ["(?:x+x+)+y", ""],
  ["^(\\w+\\s?)*$", ""],
  ["[a-z]+\\d*", ""],
  ["(\\d+)-(\\d+)", "g"],
];
const subjects = ["a".repeat(26) + "c", "x".repeat(19), "word ".repeat(5) + "!", "a1-22-333", ""];
const expressions = patterns.map(([text, flags]) => new RegExp(text + tail, flags));

function showMatches(round: number): void {
  for (const expression of expressions) {
    for (const subject of subjects) {
      const match = JSON.stringify(subject.match(expression));
      const test = expression.test(subject);
      const index = subject.search(expression);
      console.log(`${round} ${expression} ${subject.length}: ${match} ${test} ${index}`);
    }
  }
}

function matchOtherPatterns(count: number): number {
  let matched = 0;
  for (let i = 0; i < count; i++) {
    if (new RegExp("k" + i + "[a-z]+" + tail).test("k" + i + "word")) matched++;
  }
  return matched;
}

showMatches(1);
showMatches(2);
console.log(matchOtherPatterns(300));
collect();
collect();
showMatches(3);

export {};
