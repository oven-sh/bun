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
  "classes without a constructor below classes of the web that take a type": {
    files: {
      "main.ts": `export {};\nclass Told extends CustomEvent {}\nclass Sent extends MessageEvent {}\nclass Pipe extends ReadableStream {}\nconsole.log(new Told("e", { detail: 1 }).detail, new Sent("m", { data: 2 }).data, new Pipe({}).locked);\n`,
    },
    stdout: "1 2 false\n",
  },
};

// `code x count`, as the build prints them.
const stops: Record<string, { text: string; errors: string[] }> = {
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
  "an object of the program behind new": {
    text: `export {};\nconst crate = { weight: 3 };\nconsole.log(new crate());\n`,
    errors: ["TS2351"],
  },
};

const build = (folder: string) =>
  spawned(
    [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, "./main.ts", "--outfile", "main"],
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

  for (const [name, { text, errors }] of Object.entries(stops)) {
    test(`stops: ${name}`, () =>
      slot(async () => {
        using dir = tempDir("aot-rests-on-a-brought-declaration", { "main.ts": text });
        const built = await build(String(dir));
        expect({ errors: codesOf(built.stderr), exitCode: built.exitCode }).toEqual({ errors, exitCode: 1 });
      }));
  }
});
