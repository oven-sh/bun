function ask(run: () => unknown): string {
  return String(run());
}
class Box {
  x = 1;
}
let shared: number = 1;
const forms: [string, (value: number) => string][] = [
  ["a parameter", value => ask(() => typeof value === "object")],
  [
    "a constant",
    value => {
      const local: number = value;
      return ask(() => typeof local === "object");
    },
  ],
  ["not equal", value => ask(() => typeof value !== "object")],
  ["in a condition", value => ask(() => (typeof value === "object" ? "object" : "other"))],
  ["and not null", value => ask(() => typeof value === "object" && value !== null)],
  [
    "a function expression",
    value =>
      ask(function () {
        return typeof value === "object";
      }),
  ],
  ["the other way round", value => ask(() => "object" === typeof value)],
  ["loosely equal", value => ask(() => typeof value == "object")],
  [
    "the kind kept in a constant",
    value =>
      ask(() => {
        const kind = typeof value;
        return kind === "object";
      }),
  ],
  [
    "a field",
    value => {
      const box = new Box();
      box.x = value;
      return ask(() => typeof box.x === "object");
    },
  ],
  [
    "an element",
    value => {
      const items: number[] = [value];
      return ask(() => typeof items[0] === "object");
    },
  ],
  [
    "a member of a literal",
    value => {
      const bag = { held: value };
      return ask(() => typeof bag.held === "object");
    },
  ],
  [
    "a result",
    value => {
      const give = (): number => value;
      return String(typeof give() === "object");
    },
  ],
  [
    "a variable that is stored to",
    value => {
      let local: number = 0;
      local = value;
      return ask(() => typeof local === "object");
    },
  ],
  [
    "a variable of the module",
    value => {
      shared = value;
      return ask(() => typeof shared === "object");
    },
  ],
  ["a callback of a built-in", value => [0].map(() => typeof value === "object").join()],
];
const list: number[] = [1];
const wide: unknown[] = list;
wide.push({}, null, [], () => 1);
for (const [name, form] of forms) console.log(name + ": " + list.map(form).join(" "));
