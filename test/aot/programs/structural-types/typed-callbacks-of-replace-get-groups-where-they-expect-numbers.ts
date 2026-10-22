function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const seen: string[] = [];

function atOffset(whole: string, offset: number): string {
  seen.push(typeof offset + " " + show(offset) + " " + show(offset + 1) + " " + show(offset * 2));
  return "<" + (offset + 1) + ">";
}

function offsetAndText(whole: string, offset: number, text: string): string {
  seen.push(typeof offset + " " + typeof text + " " + show(text.length) + " " + show(offset | 0));
  return whole.toUpperCase();
}

function withGroups(whole: string, first: string, offset: number, text: string, groups: { year: string }): string {
  seen.push([typeof first, typeof offset, typeof text, typeof groups].join(" "));
  return groups.year + "/" + (offset + 1);
}

function indexed(whole: string, offset: number): string {
  return "abcdef"[offset] + [10, 20, 30][offset];
}

function run(label: string, replace: () => string): void {
  seen.length = 0;
  attempt(label, replace);
  console.log("  saw: " + seen.join(" ; "));
}

let warm = "";
for (let i = 0; i < 2000; i++) warm = "a-b".replace("-", atOffset) + "a-b".replace(/-/, offsetAndText) + "a-b".replace(/-/g, indexed);
console.log("2000 honest rounds: " + warm);

run("no group: the second operand is the offset", () => "a-b-c".replace(/-/g, atOffset));
run("one group: the second operand is the group", () => "a-b-c".replace(/(-)/g, atOffset));
run("a group of digits", () => "a1b22c".replace(/(\d+)/g, atOffset));
run("a group that took no part", () => "ab".replace(/(x)?b/, atOffset));
run("two groups", () => "k=v".replace(/(\w)=(\w)/, atOffset));
run("offset and text, no group", () => "a-b".replace(/-/, offsetAndText));
run("offset and text, one group", () => "a-b".replace(/(-)/, offsetAndText));
run("offset and text, a group that took no part", () => "a-b".replace(/(x)?-/, offsetAndText));
run("offset and text, two groups", () => "a-b".replace(/(a)(-)/, offsetAndText));
run("named groups, as declared", () => "in 2024".replace(/(?<year>\d+)/, withGroups));
run("named groups, none in the pattern", () => "in 2024".replace(/(\d+)/, withGroups));
run("named groups, another name", () => "in 2024".replace(/(?<month>\d+)/, withGroups));
run("named groups, one group more", () => "in 2024".replace(/(?<year>\d)(\d+)/, withGroups));
run("an index, no group", () => "a-b".replace(/-/, indexed));
run("an index, a group of digits", () => "a2b".replace(/(\d)/, indexed));
run("an index, a group of letters", () => "a2b".replace(/([a-z])/g, indexed));
run("a text pattern", () => "a-b".replace("-", atOffset));

seen.length = 0;
attempt("replaceAll", () => "a1b2".replaceAll(/(\d)/g, atOffset));
console.log("  saw: " + seen.join(" ; "));

seen.length = 0;
attempt("an object with its own replace method", () =>
  "text".replace(
    {
      [Symbol.replace](text: string, replacer: (whole: string, ...rest: never[]) => string): string {
        return Reflect.apply(replacer, undefined, [text, { valueOf: () => 4 }, null]);
      },
    },
    atOffset,
  ),
);
console.log("  saw: " + seen.join(" ; "));

console.log("honest again: " + "a-b".replace("-", atOffset) + "a-b".replace(/-/, offsetAndText));

export {};
