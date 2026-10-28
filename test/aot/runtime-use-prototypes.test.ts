// The members of a host prototype are enumerable, so a program that holds the prototype can copy them without naming one, and call
// a copy under a key that nobody knows. `image` of Blob.prototype is the probe: it is the only use of the feature Image here.
import { describe, expect } from "bun:test";
import { closed, completeness, retainsFeature } from "./runtime-use-expectations";
import { of } from "./runtime-use-harness";
import { test } from "./supported";

const start = `declare const Blob: any;\nconst blob = new Blob(["x"]);\nconst copied: any = {};\nconst value: any = JSON.parse(process.argv[2] ?? "{}");\n`;

const callsWhatWasCopied = `\nconsole.log(copied[process.argv[3]]());`;

async function reported(text: string) {
  const use = await of(start + text);
  return { ...completeness(use), retainsImage: retainsFeature(use.lines, "Image") };
}

describe.concurrent("the enumerable members of host prototypes", () => {
  test.each([
    ["Object.getPrototypeOf as an argument", `Object.assign(copied, Object.getPrototypeOf(blob));`],
    ["Reflect.getPrototypeOf as an argument", `Object.assign(copied, Reflect.getPrototypeOf(blob));`],
    ["the prototype of a global class as an argument", `Object.assign(copied, Blob.prototype);`],
    ["the prototype of a global class after a type assertion", `Object.assign(copied, (Blob as any).prototype);`],
    ["the prototype of an unknown constructor", `Object.assign(copied, blob.constructor.prototype);`],
    ["__proto__ as an argument", `Object.assign(copied, blob.__proto__);`],
    ["__proto__ in brackets", `Object.assign(copied, blob["__proto__"]);`],
    ["__proto__ folded from two strings", `Object.assign(copied, blob["__pro" + "to__"]);`],
    [
      "__proto__ in the pattern of a declaration",
      `const { __proto__: parent } = blob;\nObject.assign(copied, parent);`,
    ],
    [
      "__proto__ in the pattern of an assignment",
      `let parent: any;\n({ __proto__: parent } = blob);\nObject.assign(copied, parent);`,
    ],
    ["__proto__ through Reflect.get", `Object.assign(copied, Reflect.get(blob, "__proto__"));`],
    ["a constant that is passed on", `const parent = Object.getPrototypeOf(blob);\nObject.assign(copied, parent);`],
    [
      "a variable that is stored to twice",
      `let parent = blob;\nparent = Object.getPrototypeOf(parent);\nObject.assign(copied, parent);`,
    ],
    [
      "a returned prototype",
      `function parentOf(of: any) { return Object.getPrototypeOf(of); }\nObject.assign(copied, parentOf(blob));`,
    ],
    [
      "a prototype stored in an object",
      `const holder = { parent: Object.getPrototypeOf(blob) };\nObject.assign(copied, holder.parent);`,
    ],
    ["a prototype stored in an array", `const list = [Object.getPrototypeOf(blob)];\nObject.assign(copied, list[0]);`],
    ["a prototype or else null", `const parent = Object.getPrototypeOf(blob) || null;\nObject.assign(copied, parent);`],
    ["a prototype as the receiver of a call", `Object.assign(copied, Object.getPrototypeOf(blob).valueOf());`],
    ["a spread prototype", `Object.assign(copied, { ...Object.getPrototypeOf(blob) });`],
    ["getPrototypeOf as a callback", `Object.assign(copied, [blob].map(Object.getPrototypeOf)[0]);`],
    [
      "the prototype above a class of the program's own",
      `class Mine extends Blob {}\nObject.assign(copied, Object.getPrototypeOf(Mine.prototype));`,
    ],
    [
      "a prototype stored as the prototype of a function of the program's own",
      `function Mine() {}\nMine.prototype = Object.getPrototypeOf(blob);\nObject.assign(copied, Mine.prototype);`,
    ],
    [
      "the replacer of JSON.stringify",
      `JSON.stringify(Object.getPrototypeOf(blob), (key, member) => (copied[0] = member));`,
    ],
  ])("count as used with %s", async (_, text) => {
    expect(await reported(text + callsWhatWasCopied)).toEqual({ ...closed, retainsImage: true });
  });

  test.each([
    ["a call under a key that nobody knows, on an object that nothing was copied to", callsWhatWasCopied],
    ["a copy that nothing is called on", `Object.assign(copied, Object.getPrototypeOf(blob));`],
    ["a comparison", `console.log(String(Object.getPrototypeOf(value) === Object.prototype));`],
    [
      "a constant that is only compared",
      `const parent = Object.getPrototypeOf(value);\nconsole.log(String(parent === null || parent === Object.prototype));`,
    ],
    ["a comparison with null", `console.log(Object.getPrototypeOf(value) == null ? "none" : "one");`],
    ["a test", `if (Object.getPrototypeOf(value)) console.log("one");`],
    ["typeof", `console.log(typeof value.__proto__);`],
    [
      "two steps and a comparison",
      `console.log(String(Object.getPrototypeOf(Object.getPrototypeOf(value)) === null));`,
    ],
    ["a list of its keys", `console.log(String(Object.keys(Object.getPrototypeOf(value)).length));`],
    [
      "a method read from the prototype of a global class",
      `console.log(String(Object.prototype.hasOwnProperty.call(value, "a")), Object.prototype.toString.call(value));`,
    ],
    [
      "a method stored on the prototype of a function of the program's own",
      `function Point(this: any) { this.x = 1; }\nPoint.prototype.double = function () { return this.x * 2; };\nconsole.log(String(new (Point as any)().double()));`,
    ],
    [
      "the prototype of a function of the program's own as an argument",
      `function Point() {}\nObject.assign(Point.prototype, { hello() { return "hello"; } });\nconsole.log(new (Point as any)().hello());`,
    ],
    [
      "the prototype of a class of the program's own in an array",
      `const Point = class { hello() { return "hello"; } };\nconst list = [Point.prototype];\nconsole.log(list[0].hello());`,
    ],
    [
      "Object.create",
      `function Parent() {}\nfunction Child() {}\nChild.prototype = Object.create(Parent.prototype);\nChild.prototype.constructor = Child;\nconsole.log(typeof new (Child as any)());`,
    ],
    ["Object.create of an unknown prototype", `console.log(typeof Object.create(Object.getPrototypeOf(value)));`],
    [
      "Object.setPrototypeOf in the constructor of an error",
      `class Failure extends Error { constructor(message: string) { super(message); Object.setPrototypeOf(this, new.target.prototype); } }\nconsole.log(new Failure("no").message);`,
    ],
    ["a store to __proto__", `copied.__proto__ = null;\nconsole.log(typeof copied);`],
    ["the name as the left operand of in", `console.log(String("prototype" in Blob));`],
    [
      "copies of objects that are no prototypes",
      `const copy = { ...value, a: 1 };\nconst { a, ...rest } = copy;\nconsole.log(String(Object.entries(Object.assign({}, copy, rest)).length), String(Object.values(copy).length), JSON.stringify(copy, (key, member) => member));`,
    ],
  ])("do not count as used with %s", async (_, text) => {
    expect(await reported(text)).toEqual({ ...closed, retainsImage: false });
  });
});

describe.concurrent("a class of the host of which the program makes no instance", () => {
  const unknown = `declare const CustomEvent: any;\nconst value: any = new CustomEvent("x", { detail: JSON.parse(process.argv[2] ?? "{}") }).detail;\n`;
  const retainsTest = async (text: string) => retainsFeature((await of(text)).lines, "Test");

  test.each(["items", "not", "returns", "parameters", "instance", "resolves"])(
    "value.%s, the name of a getter of what expectTypeOf() answers, is no use of bun:test",
    async name => {
      expect(await retainsTest(unknown + `console.log(value.${name});`)).toBe(false);
    },
  );

  test("nor is a call of a method of that name, with text evaluated at run time beside it", async () => {
    expect(
      await retainsTest(
        unknown + `console.log(value.map((x: any) => x), value.pick("a"), value.not, new Function(process.argv[3])());`,
      ),
    ).toBe(false);
  });

  test("a program that calls expectTypeOf() keeps bun:test", async () => {
    expect(await retainsTest(`import { expectTypeOf } from "bun:test";\nconsole.log(expectTypeOf(1).not);`)).toBe(true);
  });
});

// Each title says what was once taken for granted of the program. The compiler follows the value all the way instead: nothing blocks --trim, and neither the global object nor process nor Bun
// counts as handed to code that nobody sees. What such a program uses is what it names.
describe.concurrent("what the compiler follows, so that it is no longer so:", () => {
  test.each([
    [
      "count as used with the getter of __proto__",
      'declare const Blob: any;\nconst blob = new Blob(["x"]);\nconst copied: any = {};\nconst value: any = JSON.parse(process.argv[2] ?? "{}");\nObject.assign(copied, Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.get!.call(blob));\nconsole.log(copied[process.argv[3]]());',
    ],
  ])("%s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});
