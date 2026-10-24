// Object literals in text that becomes code at run time have the names of a declared type. Some of their values fit the fields, some do not.
interface Payload { value: unknown; issues: string[]; aborted?: boolean }
function describe(p: Payload): string { return JSON.stringify(p) + " " + Object.keys(p).join() + " " + typeof p.issues + " " + String(p.aborted) + " " + (Object.getPrototypeOf(p) === Object.prototype); }
const make = new Function("describe", "given", "issues", "aborted", process.env.OTHER_TEXT ?? "given.value = 2; return describe({ value: given, issues: issues, aborted: aborted }) + '|' + describe({ issues: issues, value: 1 }) + '|' + describe({ value: 1, issues })") as (d: typeof describe, given: Payload, issues: unknown, aborted: unknown) => string;
const given: Payload = { value: 1, issues: [] };
for (const issues of [[], ["a"], [1], "text", 7, null, undefined, { length: 2 }, new Array(3)])
  for (const aborted of [true, false, undefined, null, 0, "yes", {}])
    console.log(make(describe, given, issues, aborted));
for (const value of [Symbol.iterator, 10n, 1.5, -0, "s", () => 1, null, undefined])
  console.log(String(new Function("describe", "given", "value", process.env.OTHER_TEXT_2 ?? "const made = { value: 1, issues: value, aborted: value }; return typeof made.issues + typeof made.aborted + Object.keys(made) + (given === made)")(describe, given, value)));
