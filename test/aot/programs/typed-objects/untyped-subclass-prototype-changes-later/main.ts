// A class in JavaScript extends a class with declared fields and adds nothing to it. Later its prototype object gets a setter, a getter, a value, a method or another parent: objects made before and after go by that from then on.
import { Core, describeAny } from "./core";
import { makeHeir, makeHeirOf } from "./heirs.js";

const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));
const attempt = (action: () => unknown): unknown => {
  try {
    return action();
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
};
function use(object: any, round: number): unknown[] {
  const before = describeAny(object);
  const stored = [attempt(() => object.setSecond(round)), attempt(() => object.setThird("third " + round))];
  return [before, stored, describeAny(object), Object.keys(object).join(), String(object.caught)];
}
const changes: [string, (prototype: any) => void][] = [
  ["nothing", () => {}],
  ["a setter", prototype => Object.defineProperty(prototype, "third", { set(value) { this.caught = "caught " + value; }, configurable: true })],
  ["a getter", prototype => Object.defineProperty(prototype, "third", { get() { return "from the getter"; }, configurable: true })],
  ["a value", prototype => { prototype.third = "a value above"; }],
  ["a read-only value", prototype => Object.defineProperty(prototype, "second", { value: -1, writable: false, configurable: true })],
  ["a name that is no field", prototype => { prototype.other = "other"; }],
  ["a method of the class", prototype => { prototype.readThird = function () { return "overridden"; }; }],
  ["a symbol", prototype => { prototype[Symbol.toStringTag] = "Tagged"; }],
  ["toString", prototype => { prototype.toString = function () { return "an heir"; }; }],
  ["another parent", prototype => Object.setPrototypeOf(prototype, Object.create(Core.prototype, { third: { value: "of the new parent", writable: true, configurable: true } }))],
  ["an index", prototype => { prototype[0] = "zero"; }],
];
for (const depth of [1, 2]) {
  console.log("== heirs " + depth + " deep");
  for (const [label, change] of changes) {
    const Upper = makeHeir();
    const Heir = depth === 1 ? Upper : makeHeirOf(Upper);
    const early: any[] = [];
    for (let i = 0; i < 4; i++) early.push(new Heir(i));
    show(label + ", before", [use(early[0], 0), use(early[1], 1)]);
    change(Upper.prototype);
    show(label + ", made before", [use(early[2], 2), use(early[3], 3), String(early[2])]);
    show(label + ", made after", [use(new Heir(4), 4), use(new Heir(5), 5)]);
    if (label === "a setter" || label === "a value") {
      delete (Upper.prototype as any).third;
      show(label + ", taken away again", [use(new Heir(6), 6)]);
    }
  }
}
show("the class itself", use(new Core("own"), 9));
