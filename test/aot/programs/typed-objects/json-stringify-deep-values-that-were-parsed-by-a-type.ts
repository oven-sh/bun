// Deep values that JSON.parse<T> made are written, validated, cloned and compared with what plain objects give.
import { validate } from "bun:bundle";
type Tree = { kids: Tree[] };
type Chain = { next: Chain | null; name: string };
type Deep = Deep[];
const plainParse: (text: string) => any = JSON.parse;
function say(run: () => unknown): string {
  try {
    const value = run();
    return typeof value === "string" ? "text of " + value.length : typeof value;
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}
const roads: [string, (text: string) => unknown, (value: unknown) => unknown, (levels: number) => string][] = [
  ["Tree", text => JSON.parse<Tree>(text), value => validate<Tree>(value), levels => '{"kids":['.repeat(levels) + "]}".repeat(levels)],
  ["Tree with undeclared keys", text => JSON.parse<Tree>(text), value => validate<Tree>(value), levels => '{"u":1,"kids":['.repeat(levels) + '],"v":"w"}'.repeat(levels)],
  ["Chain", text => JSON.parse<Chain>(text), value => validate<Chain>(value), levels => '{"next":'.repeat(levels) + "null" + ',"name":"n"}'.repeat(levels)],
  ["Deep", text => JSON.parse<Deep>(text), value => validate<Deep>(value), levels => "[".repeat(levels) + "]".repeat(levels)],
];
for (const [label, parse, validate, text] of roads) {
  for (const levels of [10, 47, 48, 49, 50, 100, 1000]) {
    const given = text(levels);
    const typed = parse(given);
    const plain = plainParse(given);
    const answers = [
      [say(() => JSON.stringify(typed)), say(() => JSON.stringify(plain))],
      [say(() => JSON.stringify(typed, null, 1)), say(() => JSON.stringify(plain, null, 1))],
      [say(() => JSON.stringify([typed, { a: typed }])), say(() => JSON.stringify([plain, { a: plain }]))],
      [say(() => JSON.stringify(validate(typed))), say(() => JSON.stringify(validate(plain)))],
      [say(() => JSON.stringify(structuredClone(typed))), say(() => JSON.stringify(structuredClone(plain)))],
    ];
    console.log(label + ", " + levels + " levels: " + answers.map(([one, other]) => (one === other ? "same" : "DIFFERENT: " + one + " | " + other)).join(", "));
  }
  const deep = text(400);
  const typed = parse(deep);
  const expected = say(() => JSON.stringify(plainParse(deep)));
  let frames = 0;
  let wrong = 0;
  let written = 0;
  const dive = (level: number): void => {
    try {
      dive(level + 1);
    } catch {
      if (frames === 0) frames = level;
    }
    if (frames - level > 600) return;
    const said = say(() => JSON.stringify(typed));
    if (said === expected) written++;
    else if (said !== "RangeError: Maximum call stack size exceeded.") wrong++;
  };
  dive(0);
  console.log(label + ", written near the end of the stack: " + wrong + " answers are neither the text nor a RangeError, " + (written ? "some" : "NO") + " texts");
}
