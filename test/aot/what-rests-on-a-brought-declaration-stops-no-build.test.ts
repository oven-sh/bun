// A project that has not installed the types of Bun is checked beside declarations that the build brings along. They hold no program to what its project has
// not installed: an error that rests on one of them stops nothing, whoever of the program hands the value on: a function, a method, a field, another file.
// What the program says by itself stops the build as ever. Each program stands alone in a folder without a tsconfig.json and without packages.
// With a tsconfig.json of their own: parallel/what-tsc-accepts-a-build-accepts/a-timer-*.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const ring = `function ring(): void {\n  console.log("rang");\n}\n`;
const later = `function later(run: () => void) {\n  return setTimeout(run, 1);\n}\n`;

const builds: Record<string, { files: Record<string, string>; stdout: string }> = {
  "a parameter that a function of Node.js types, and one in a literal beside a number of Bun's": {
    files: {
      "main.ts": `export {};\nfunction each<T>(item: T, options: { use: (item: T) => void }) {\n  options.use(item);\n}\neach(Bun.file(import.meta.path).size, {\n  use: size => {\n    const text: string = size;\n    console.log(typeof text);\n  },\n});\nprocess.on("exit", code => {\n  const text: string = code;\n  console.log(typeof text);\n});\n`,
    },
    stdout: "number\nnumber\n",
  },
  "what Bun adds to fetch is asked of no function, and the program declares import.meta.dirname and process": {
    files: {
      "main.ts": `declare global {\n  interface ImportMeta {\n    readonly dirname: string;\n  }\n  const process: { readonly argv: readonly string[] };\n}\nconst canned = { ok: true } as unknown as Response;\nasync function answer(input: string | URL | Request): Promise<Response> {\n  return canned;\n}\nasync function load(get: typeof fetch): Promise<boolean> {\n  return (await get("http://localhost/")).ok;\n}\nconsole.log(await load(answer), typeof import.meta.dirname, process.argv.length > 0);\nexport {};\n`,
    },
    stdout: "true string true\n",
  },
  "a timer out of a function of the program": {
    files: { "main.ts": `export {};\n${ring}${later}const id: number = later(ring);\nconsole.log(typeof id);\n` },
    stdout: "object\nrang\n",
  },
  "a timer handed to a parameter of the program": {
    files: {
      "main.ts": `export {};\n${ring}${later}function kind(id: number) {\n  return typeof id;\n}\nconsole.log(kind(later(ring)));\n`,
    },
    stdout: "object\nrang\n",
  },
  "a timer that a private method hands to a private field": {
    files: {
      "main.ts": `export {};\n${ring}class Debouncer {\n  private timer: number | undefined;\n  private start(run: () => void) {\n    return setTimeout(run, 1);\n  }\n  call(run: () => void) {\n    this.timer = this.start(run);\n    return typeof this.timer;\n  }\n}\nconsole.log(new Debouncer().call(ring));\n`,
    },
    stdout: "object\nrang\n",
  },
  "a timer out of a field of a class": {
    files: {
      "main.ts": `export {};\n${ring}class Poller {\n  timer = setTimeout(ring, 1);\n}\nconst id: number = new Poller().timer;\nconsole.log(typeof id);\n`,
    },
    stdout: "object\nrang\n",
  },
  "a timer out of a variable of another file": {
    files: {
      "bell.ts": `${ring}export const timer = setTimeout(ring, 1);\n`,
      "main.ts": `import { timer } from "./bell";\nconst id: number = timer;\nconsole.log(typeof id);\n`,
    },
    stdout: "object\nrang\n",
  },
  "a number of Bun's out of a function of the program: the message names primitives alone": {
    files: {
      "main.ts": `export {};\nfunction open() {\n  return Bun.file(import.meta.path);\n}\nconst size: string = open().size;\nconsole.log(typeof size);\n`,
    },
    stdout: "number\n",
  },
  "the same out of a method, a getter, a field and another file": {
    files: {
      "shelf.ts": `export const far = Bun.file(import.meta.path).size;\nexport function farther() {\n  return Bun.file(import.meta.path).size;\n}\n`,
      "main.ts": `import { far, farther } from "./shelf";\nclass Crate {\n  weight = Bun.file(import.meta.path).size;\n  heavier() {\n    return Bun.file(import.meta.path).size;\n  }\n  get most() {\n    return Bun.file(import.meta.path).size;\n  }\n}\nconst all: string[] = [new Crate().weight, new Crate().heavier(), new Crate().most, far, farther()];\nconsole.log(all.map(one => typeof one).join());\n`,
    },
    stdout: "number,number,number,number,number\n",
  },
  "the same through the variable of a for-of, a parameter that its context types and a let that is stored to later": {
    files: {
      "main.ts": `export {};\nfunction show(text: string): void {\n  console.log(typeof text);\n}\nfor (const size of [Bun.file(import.meta.path).size]) show(size);\n[Bun.file(import.meta.path).size].forEach(size => show(size));\nlet late;\nlate = Bun.file(import.meta.path).size;\nshow(late);\n`,
    },
    stdout: "number\nnumber\nnumber\n",
  },
  "timers that are reckoned with: the message names nothing at all": {
    files: {
      "main.ts": `export {};\n${ring}const id = setTimeout(ring, 1);\nconst ids = [setTimeout(ring, 2), setTimeout(ring, 3)];\nids.sort((a, b) => a - b);\nconsole.log(typeof (id * 1), typeof (id % 8), typeof -id, ids.length);\n`,
    },
    stdout: "number number number 2\nrang\nrang\nrang\n",
  },
  "an error that would stand at an operator: its cause is what goes into it": {
    files: {
      "main.ts": `export {};\n${ring}const version = Bun.version;\nconst id = setTimeout(ring, 1);\nconsole.log(Bun.version === 3, version !== 3, Bun.nanoseconds() < "a", id === 4, id > 2, typeof (Bun.version as number));\n`,
    },
    stdout: "false true false false false string\nrang\n",
  },
  "a timer chooses among the signatures of a function of the program": {
    files: {
      "main.ts": `export {};\n${ring}function kind(value: number): "number";\nfunction kind(value: object): "object";\nfunction kind(value: unknown) {\n  return typeof value;\n}\nconst word: "number" = kind(setTimeout(ring, 1));\nconsole.log(word);\n`,
    },
    stdout: "object\nrang\n",
  },
  "a parameter that a written callback type types, where that type is made of a name of Bun's": {
    files: {
      "main.ts": `export {};\n${ring}function withPlatform(use: (platform: typeof navigator.platform) => void) {\n  use(navigator.platform);\n}\nwithPlatform(platform => console.log(platform === "Made-up 9000"));\nfunction later(use: (id: ReturnType<typeof setTimeout>) => void) {\n  use(setTimeout(ring, 1));\n}\nlater(id => {\n  if (typeof id === "number") console.log(id.toFixed(0));\n  console.log(typeof id);\n});\nconst run: (p: typeof navigator.platform) => boolean = p => p === "Made-up 9000";\nconsole.log(run(navigator.platform));\n`,
    },
    stdout: "false\nobject\nfalse\nrang\n",
  },
  "a conversion to a written type made of a name of Bun's, and such a type among written type arguments": {
    files: {
      "main.ts": `export {};\n${ring}const platform = JSON.parse('"Made-up 9000"') as typeof navigator.platform;\nconsole.log(platform === "Made-up 9000");\nconst counts = new Map<typeof navigator.platform, number>();\nfor (const name of counts.keys()) if (name === "Made-up 9000") console.log("made up");\nconst timers = new Map<string, ReturnType<typeof setTimeout>>();\ntimers.set("a", setTimeout(ring, 1));\nconst id = timers.get("a");\nif (typeof id === "number") console.log(id.toFixed(0));\n`,
    },
    stdout: "true\nrang\n",
  },
  "a name that a pattern takes out of a written type made of a name of Bun's": {
    files: {
      "main.ts": `export {};\nfunction isMadeUp({ platform }: { platform: typeof navigator.platform }) {\n  return platform === "Made-up 9000";\n}\nconsole.log(isMadeUp({ platform: navigator.platform }));\n`,
    },
    stdout: "false\n",
  },
  "a member of an object in another file, behind `&&` on the same object": {
    files: {
      "other.ts": `class Seat {\n  platform = navigator.platform;\n}\nconst seat = new Seat();\nexport const word = seat && seat.platform;\n`,
      "main.ts": `import { word } from "./other";\nconsole.log(word === "Made-up 9000");\n`,
    },
    stdout: "false\n",
  },
  "an object and a member of it in one literal of another file": {
    files: {
      "other.ts": `class Seat {\n  platform = navigator.platform;\n}\nconst seat = new Seat();\nexport const state = { seat, platform: seat.platform };\n`,
      "main.ts": `import { state } from "./other";\nconsole.log(state.platform === "Made-up 9000");\n`,
    },
    stdout: "false\n",
  },
  "a member of what a function with a written function type gives in another file": {
    files: {
      "other.ts": `interface Seat {\n  platform: typeof navigator.platform;\n}\nconst open: () => Seat = () => ({ platform: navigator.platform });\nexport const word = open().platform;\n`,
      "main.ts": `import { word } from "./other";\nconsole.log(word === "Made-up 9000");\n`,
    },
    stdout: "false\n",
  },
  "the default export of another file is an expression": {
    files: {
      "other.ts": `export default [navigator.platform][0];\n`,
      "main.ts": `import word from "./other";\nconsole.log(word === "Made-up 9000");\n`,
    },
    stdout: "false\n",
  },
  "what a generic function and a field make of names of Bun's in another file": {
    files: {
      "other.ts": `function identity<T>(value: T): T {\n  return value;\n}\nexport const word = identity(navigator.platform);\nexport class Box {\n  started = setTimeout(() => {}, 0);\n}\nexport const at = new Box().started;\n`,
      "main.ts": `import { at, word } from "./other";\nconsole.log(word === "Made-up 9000", at > 0);\n`,
    },
    stdout: "false true\n",
  },
  "a function whose written result is the type of the function itself, at an error that a comment takes away": {
    files: {
      "main.ts": `export {};\nfunction chain(n: number): typeof chain {\n  console.log(n);\n  return chain;\n}\n// @ts-expect-error\nconst text: string = chain(1)(2);\nconsole.log(typeof text);\n`,
    },
    stdout: "1\n2\nfunction\n",
  },
  "a method of a literal calls a function that compares a timer of the same literal": {
    files: {
      "main.ts": `export {};\nconst job = {\n  again() {\n    return due();\n  },\n  at: setTimeout(() => {}, 0),\n};\nfunction due() {\n  return job.at > 0;\n}\nconsole.log(due(), typeof job.again);\n`,
    },
    stdout: "true function\n",
  },
  "an operator on a field, on a member and behind a written type that are made of a name of Bun's; a pattern over one":
    {
      files: {
        "main.ts": `export {};\n${ring}class Seat {\n  p = navigator.platform;\n  id = setTimeout(ring, 1);\n  isPhone() {\n    return this.p === "Made-up 9000";\n  }\n  next() {\n    return this.id + 1;\n  }\n}\nconst seat = new Seat();\nconst typed = (p: typeof navigator.platform) => p === "Made-up 9000";\nconst timer: ReturnType<typeof setTimeout> = setTimeout(ring, 2);\ntype Job = { timer: ReturnType<typeof setTimeout> };\nconst job: Job = { timer };\nconst weights: Partial<Record<typeof navigator.platform, number>> = { "Made-up 9000": 1 };\nconst { made } = Bun.version;\nconsole.log(seat.isPhone(), seat.p === "Made-up 9000", typed(seat.p), typeof seat.next(), timer > 0, typeof job.timer.toString(36), Object.keys(weights).length, made);\n`,
      },
      stdout: "false false false number true string 1 undefined\nrang\nrang\n",
    },
  "an error that would stand at a literal: its cause is the receiver, or what is switched on": {
    files: {
      "main.ts": `export {};\n${ring}const id = setTimeout(ring, 1);\nconsole.log(typeof id.toString(36));\nswitch (navigator.platform) {\n  case "Made-up 9000":\n    console.log("made up");\n    break;\n  default:\n    console.log("other");\n}\n`,
    },
    stdout: "string\nother\nrang\n",
  },
  "a number of Bun's through a generic function, a generic class, a map, a promise of all and a pattern": {
    files: {
      "main.ts": `export {};\nfunction same<T>(value: T): T {\n  return value;\n}\nclass Box<T> {\n  constructor(public held: T) {}\n}\nconst size = () => Bun.file(import.meta.path).size;\nconst one: string = same(size());\nconst two: string = new Box(size()).held;\nconst three: string = new Map([["a", size()]]).get("a")!;\nconst [four] = await Promise.all([size()]);\nconst five: string = four;\nconst { held } = { ...new Box(size()) };\nconst six: string = held;\nconsole.log(typeof one, typeof two, typeof three, typeof five, typeof six);\n`,
    },
    stdout: "number number number number number\n",
  },
};

// `code x count`, as the build prints them.
const stops: Record<string, { text: string; others?: Record<string, string>; errors: string[] }> = {
  // TypeScript's own library for browsers declares these with a type parameter, and tsc says the same of them.
  "classes without a constructor below classes of the web that take a type": {
    text: `export {};\nclass Told extends CustomEvent {}\nclass Sent extends MessageEvent {}\nclass Pipe extends ReadableStream {}\nconsole.log(new Told("e", { detail: 1 }).detail, new Sent("m", { data: 2 }).data, new Pipe({}).locked);\n`,
    errors: ["TS2508", "TS2508", "TS2510", "TS2351", "TS2351"],
  },
  "a number out of a field in another file, held against a text in the result of a function and at the top": {
    text: `import { n } from "./other";\nconst r = inner();\nfunction inner() {\n  return n === "one";\n}\nif (n === "two") console.log(r);\nconsole.log("ran");\n`,
    others: { "other.ts": `class Box {\n  count = 5;\n}\nconst box = new Box();\nexport const n = box.count;\n` },
    errors: ["TS2367", "TS2367"],
  },
  "a member of an enum and a member under an interface of the program in another file, held against a text": {
    text: `import { color, port } from "./other";\nconsole.log(color === "red", port === "3000");\n`,
    others: {
      "other.ts": `enum Color {\n  Red = 1,\n}\ninterface Config {\n  port: number;\n}\nconst config: Config = { port: 3000 };\nexport const color = Color.Red;\nexport const port = config.port;\n`,
    },
    errors: ["TS2367", "TS2367"],
  },
  "a number out of a member of a literal in another file, held against a text": {
    text: `import { port } from "./config";\nconsole.log(port === "3000");\n`,
    others: { "config.ts": `const config = { port: 3000, host: "a" };\nexport const port = config.port;\n` },
    errors: ["TS2367"],
  },
  "the program's own written types: of a callback, in a conversion, among type arguments, taken apart by a pattern": {
    text: `export {};\nfunction withCount(use: (count: number) => void) {\n  use(1);\n}\nwithCount(count => console.log(count === "one"));\nconst label = JSON.parse('"a"') as "a" | "b";\nconsole.log(label === "c");\nconst counts = new Map<"a" | "b", number>();\nfor (const name of counts.keys()) if (name === "c") console.log("c");\nfunction isOne({ count }: { count: number }) {\n  return count === "one";\n}\nconsole.log(isOne({ count: 1 }));\n`,
    errors: ["TS2367", "TS2367", "TS2367", "TS2367"],
  },
  "a parameter that a written type of the program types: in a literal, in a method, in an arrow that an arrow gives": {
    text: `export {};\ninterface Options {\n  onDone: (count: number) => void;\n  onStart(count: number): void;\n}\nconst options: Options = {\n  onDone: count => {\n    const text: string = count;\n    console.log(text);\n  },\n  onStart(count) {\n    const text: string = count;\n    console.log(text);\n  },\n};\nconst add: (a: number) => (b: number) => string = a => b => a + b;\nconst show: (text: string) => void = text => console.log(text.size);\nconsole.log(options, add, show);\n`,
    errors: ["TS2322", "TS2322", "TS2322", "TS2339"],
  },
  "two declarations of the program differ beside one of Bun's, and fetch is asked of what takes a number": {
    text: `declare global {\n  interface ImportMeta {\n    dirname: string;\n  }\n  interface ImportMeta {\n    dirname: number;\n  }\n}\nconst canned = { ok: true } as unknown as Response;\nasync function answer(input: number): Promise<Response> {\n  return canned;\n}\nasync function load(get: typeof fetch): Promise<boolean> {\n  return (await get("http://localhost/")).ok;\n}\nconsole.log(await load(answer));\nexport {};\n`,
    errors: ["TS2717", "TS2345"],
  },
  "a text for a number": {
    text: `export {};\nconst wrong: number = "text";\nconsole.log(wrong);\n`,
    errors: ["TS2322"],
  },
  "of two errors the one that is the program's own": {
    text: `export {};\nconst odd: number = Bun.version;\nconst wrong: string = 1;\nconsole.log(odd, wrong);\n`,
    errors: ["TS2322"],
  },
  "what a function of the program makes of its own parameter": {
    text: `export {};\nfunction size(list: string[]) {\n  console.log(list);\n  return list.length;\n}\nconst count: string = size(["a"]);\nconsole.log(count);\n`,
    errors: ["TS2322"],
  },
  "a written type between the brought name and the error": {
    text: `export {};\n${ring}function later(run: () => void): string {\n  return String(setTimeout(run, 1));\n}\nconst id: number = later(ring);\nconsole.log(id);\n`,
    errors: ["TS2322"],
  },
  "a field of its own in a class below a class of Node.js": {
    text: `import { EventEmitter } from "node:events";\nclass Bell extends EventEmitter {\n  rings = 1;\n}\nconst rings: string = new Bell().rings;\nconsole.log(rings);\n`,
    errors: ["TS2322"],
  },
  "an unknown that the program has written": {
    text: `export {};\nfunction parse(text: string): unknown {\n  return JSON.parse(text);\n}\nconst parcel = parse("{}");\nconsole.log(parcel.weight);\n`,
    errors: ["TS18046"],
  },
  "a text of the program that is reckoned with": {
    text: `export {};\nconst label: string = "ab";\nconsole.log(label * 2);\n`,
    errors: ["TS2362"],
  },
  "a wrong field beside a timer": {
    text: `export {};\n${ring}interface Job {\n  at: unknown;\n  name: string;\n}\nconst job: Job = { at: setTimeout(ring, 1), name: 3 };\nconsole.log(job.name);\n`,
    errors: ["TS2322"],
  },
  "a member that an object of the program lacks, though a method of it logs": {
    text: `export {};\nconst server = {\n  port: 3000,\n  start() {\n    console.log("up");\n  },\n};\nconsole.log(server.prot);\n`,
    errors: ["TS2339"],
  },
  "what may not be found in a list of the program, and a list for a number, though the callbacks log": {
    text: `export {};\nconst hit = ["ann", "bob"].find(name => {\n  console.log(name);\n  return name === "bob";\n});\nconst lengths: number = ["a", "bb"].map(word => {\n  console.log(word);\n  return word.length;\n});\nconsole.log(hit.length, lengths);\n`,
    errors: ["TS2322", "TS18048"],
  },
  "a result that the library writes between a timer and a number": {
    text: `export {};\n${ring}const id: number = String(setTimeout(ring, 1));\nconsole.log(id);\n`,
    errors: ["TS2322"],
  },
  "a text for a number inside an arrow function that logs": {
    text: `export {};\nconst main = (): void => {\n  const wrong: number = "text";\n  console.log(wrong);\n};\nmain();\n`,
    errors: ["TS2322"],
  },
  "a timer that is used ahead of its declaration": {
    text: `export {};\n${ring}console.log(id);\nconst id = setTimeout(ring, 1);\n`,
    errors: ["TS2448", "TS2454"],
  },
  "a call of Bun's that is stored to": {
    text: `export {};\nBun.nanoseconds() = 1;\n`,
    errors: ["TS2364"],
  },
  "numbers of the program through the variable of a for-of, a parameter that its context types and a let": {
    text: `export {};\nfunction show(text: string): void {\n  console.log(typeof text);\n}\nfor (const size of [1, 2]) show(size);\n[1, 2].forEach(size => show(size));\nlet late;\nlate = 3;\nshow(late);\n`,
    errors: ["TS2345", "TS2345", "TS2345"],
  },
  "what a catch takes": {
    text: `export {};\ntry {\n  console.log("tried");\n} catch (caught) {\n  console.log(caught.message);\n}\n`,
    errors: ["TS18046"],
  },
  "too many arguments for a method of the library on a text of the program, and a case that no text of it is": {
    text: `export {};\nconst label: string = "ab";\nconst kind: "a" | "b" = label === "ab" ? "a" : "b";\nconsole.log(label.toString(36));\nswitch (kind) {\n  case "c":\n    console.log("never");\n}\n`,
    errors: ["TS2554", "TS2678"],
  },
  "a text of the program at the operators: held against a number, ordered with one, taken as one": {
    text: `export {};\nconst label: string = "ab";\nconsole.log(label === 3, label < 3, label as number);\n`,
    errors: ["TS2367", "TS2365", "TS2352"],
  },
  "what a yield answers and what an import() answers, where no name of Bun's stands in them": {
    text: `export {};\nfunction* steps(): Generator<number, void, string> {\n  const taken: number = yield 1;\n  console.log(taken);\n}\nconsole.log(steps().next().value);\nconst loaded: number = import("./main");\nconsole.log(typeof loaded);\n`,
    errors: ["TS2322", "TS2322"],
  },
  "a number of the program's own function for a text, though its argument is Bun's: in a list, at an argument, under a property":
    {
      text: `export {};\nfunction half(n: number): number {\n  return n / 2;\n}\nfunction takesText(text: string): void {\n  console.log(text);\n}\nconst texts: string[] = [half(navigator.hardwareConcurrency)];\ntakesText(navigator.hardwareConcurrency * 2);\nconst box: { text: string } = { text: half(navigator.hardwareConcurrency) };\nconsole.log(texts, box);\n`,
      errors: ["TS2322", "TS2345", "TS2322"],
    },
  "an object of the program behind new": {
    text: `export {};\nconst crate = { weight: 3 };\nconsole.log(new crate());\n`,
    errors: ["TS2351"],
  },
};

// What a number out of another file is made of. Each is held against a text, which tsc refuses.
const madeInAnotherFile: Record<string, string> = {
  "a member of a new object": `export const n = new Box().count;\n`,
  "a member of what a function gives": `function make() {\n  return new Box();\n}\nexport const n = make().count;\n`,
  "a member of a member": `const shelf = { box: new Box() };\nexport const n = shelf.box.count;\n`,
  "a member of an element": `const list = [new Box()];\nexport const n = list[0].count;\n`,
  "a member of an object behind a name": `const box = new Box();\nexport const n = box.count;\n`,
};

const build = (folder: string, ...more: string[]) =>
  spawned(
    [bunExe(), "build", "--compile", "--aot", ...more, ...withoutDebugInformation, "./main.ts", "--outfile", "main"],
    folder,
    env,
  );
const codesOf = (stderr: string) =>
  stderr
    .split("\n")
    .filter(line => line.startsWith("error:"))
    .map(line => line.split(":")[1].trim());

describe.skipIf(!!unsupported)("a project without the types of Bun", () => {
  for (const [name, { files, stdout }] of Object.entries(builds)) {
    test(`builds: ${name}`, () =>
      slot(async () => {
        using dir = tempDir("aot-rests-on-a-brought-declaration", files);
        const folder = String(dir);
        const built = await build(folder);
        expect({ errors: codesOf(built.stderr), exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
        const ran = await spawned([join(folder, isWindows ? "main.exe" : "main")], folder, env);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout, exitCode: 0 });
      }));
  }

  for (const [name, { text, others, errors }] of Object.entries(stops)) {
    test(`stops: ${name}`, () =>
      slot(async () => {
        using dir = tempDir("aot-rests-on-a-brought-declaration", { ...others, "main.ts": text });
        const built = await build(String(dir));
        expect({ errors: codesOf(built.stderr), exitCode: built.exitCode }).toEqual({ errors, exitCode: 1 });
      }));
  }

  for (const [name, made] of Object.entries(madeInAnotherFile)) {
    test(`says the same with one thread and with sixteen: ${name}`, () =>
      slot(async () => {
        using dir = tempDir("aot-rests-on-a-brought-declaration", {
          "other.ts": `class Box {\n  count = 5;\n}\n${made}`,
          "main.ts": `import { n } from "./other";\nconsole.log(n === "five");\n`,
        });
        const said = [];
        for (const threads of [1, 16, 16, 16]) {
          const built = await build(String(dir), `--aot-threads=${threads}`);
          said.push({ errors: codesOf(built.stderr), exitCode: built.exitCode });
        }
        expect(said).toEqual([said[0], said[0], said[0], said[0]]);
      }));
  }
});
