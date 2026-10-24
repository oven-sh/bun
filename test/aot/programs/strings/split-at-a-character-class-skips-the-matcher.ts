declare const aotOperationCount: (name: string) => number;
function measure(name: string, run: () => string[]) {
  const before = aotOperationCount("operationAOTStringSplitAtCharacterClass");
  let pieces = 0;
  for (let i = 0; i < 100; i++) pieces += run().length;
  console.log(`${name}: ${pieces} pieces, ${aotOperationCount("operationAOTStringSplitAtCharacterClass") - before} calls without the matcher`);
}
const text = ["one two  three", "four,five;six", "東京 大阪"].join(" ");
measure("spaces", () => text.split(/\s+/));
measure("one space", () => text.split(/\s/));
measure("a character", () => text.split(/,/));
measure("a class", () => text.split(/[,;]+/));
measure("a negated class", () => text.split(/[^a-z]+/));
measure("a limit", () => text.split(/\s+/, 2));
measure("two terms", () => text.split(/,\s*/));
measure("a group", () => text.split(/(\s+)/));
measure("a flag", () => text.split(/\s+/u));
measure("may be empty", () => text.split(/\s*/));
measure("a string", () => text.split(" "));
function wordsOf(words: string): string[] {
  return words.split(/\s+/).filter(word => word !== "");
}
function firstWords(words: string, most: number): string {
  return wordsOf(words).slice(0, most).join(" ");
}
function lastWord(words: string): string {
  return words.split(/\s+/).at(-1)!;
}
measure("the same call in three places", () => [firstWords(text, 2), lastWord(text), ...wordsOf(text)]);
