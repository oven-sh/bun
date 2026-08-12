import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// bun-types merges into NodeJS.Process to add Bun's own members. Members that a
// merged declaration adds sit next to the ones @types/node declares on Process
// itself, but they replace anything Process only inherits, and how much of the
// EventEmitter surface Process inherits varies by @types/node version: `off` and
// `removeListener` on <= 24, every event method on 25.0.x (Process extends
// InternalEventEmitter<ProcessEventMap> there), nothing on 25.1+. #32594 declared
// on()/once()/off()/... overloads for "memoryPressure" on Process and thereby
// made process.off("SIGINT", fn) a type error on <= 24 and process.on("exit", fn)
// a type error on 25.0.x. Which of those a typecheck catches depends on which
// @types/node it happens to load, so the rule is enforced structurally here:
// bun-types never declares an EventEmitter member on Process. A Bun process
// event is declared by augmenting process.ProcessEventMap instead (see
// overrides.d.ts), which both the inherited and the redeclared method sets
// key off.

const EVENT_EMITTER_MEMBERS = new Set([
  "addListener",
  "emit",
  "eventNames",
  "getMaxListeners",
  "listenerCount",
  "listeners",
  "off",
  "on",
  "once",
  "prependListener",
  "prependOnceListener",
  "rawListeners",
  "removeAllListeners",
  "removeListener",
  "setMaxListeners",
]);

/**
 * Blank out comments and string/template literal contents so the brace walk
 * below only sees structural braces. Newlines are kept so line numbers in the
 * reports stay right.
 */
function blankCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  const blank = (end: number) => {
    out += source.slice(i, end).replace(/[^\n]/g, " ");
    i = end;
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      blank(end === -1 ? source.length : end);
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      blank(end === -1 ? source.length : end + 2);
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let end = i + 1;
      while (end < source.length && source[end] !== quote) end += source[end] === "\\" ? 2 : 1;
      blank(Math.min(end + 1, source.length));
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

interface ProcessMerge {
  line: number;
  /** Names of the members declared directly on the interface. */
  members: string[];
}

/** Every `interface Process { ... }` declaration in a .d.ts source and the member names it declares. */
function processMerges(source: string): ProcessMerge[] {
  const text = blankCommentsAndStrings(source);
  const merges: ProcessMerge[] = [];
  for (const match of text.matchAll(/\binterface\s+Process\b[^{;]*\{/g)) {
    const line = text.slice(0, match.index).split("\n").length;
    const members: string[] = [];
    let member = "";
    const finish = () => {
      const name = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*[(<:]/.exec(member)?.[1];
      if (name !== undefined) members.push(name);
      member = "";
    };
    let depth = 1;
    for (let i = match.index + match[0].length; i < text.length; i++) {
      const c = text[i];
      if (c === "{") {
        depth++;
      } else if (c === "}") {
        if (--depth === 0) break;
      } else if (depth === 1) {
        // Anything deeper is inside a nested object type (binding()'s return
        // type, an inline parameter type) and is not a member of Process.
        if (c === ";") finish();
        else member += c;
      }
    }
    finish();
    merges.push({ line, members });
  }
  return merges;
}

const bunTypesDir = path.resolve(import.meta.dir, "..", "..", "..", "packages", "bun-types");
// Everything the package publishes (including vendor/); node_modules holds
// @types/node itself.
const files = [...new Glob("**/*.d.ts").scanSync({ cwd: bunTypesDir })]
  .map(rel => rel.replaceAll("\\", "/"))
  .filter(rel => !rel.split("/").includes("node_modules"))
  .sort();

const merges: string[] = [];
const offenders: string[] = [];
for (const rel of files) {
  for (const merge of processMerges(readFileSync(path.join(bunTypesDir, rel), "utf8"))) {
    merges.push(`${rel}:${merge.line}`);
    for (const member of merge.members) {
      if (EVENT_EMITTER_MEMBERS.has(member)) offenders.push(`${rel}:${merge.line}: ${member}`);
    }
  }
}

test("scans bun-types and finds its NodeJS.Process merges", () => {
  // Both guard against the ban below passing vacuously: the package must be
  // where this test thinks it is, and it must still merge into Process at all.
  expect(files.length).toBeGreaterThan(0);
  expect(merges.length).toBeGreaterThan(0);
});

test("the scanner sees the members it claims to and nothing nested or commented out", () => {
  const sample = `
declare global {
  namespace NodeJS {
    interface Process {
      /** Doc comment with {@link braces} and on(event: "x") inside; */
      isBun: true;
      readonly revision: string;
      noDeprecation?: boolean | undefined;
      reallyExit(code?: number): never;
      dlopen(module: { exports: any; on(): void }, filename: string): void;
      on(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      emit(event: "memoryPressure", level: "warning" | "critical"): boolean;
      off: (event: "memoryPressure", listener: () => void) => this;
      binding(m: "uv"): {
        errname(code: number): string;
        once(event: string): void;
      };
      binding(m: "{"): object;
    }
    interface ProcessVersions { bun: string }
  }
}
declare namespace NodeJS {
  interface Process extends Something {
    assert(value: unknown): asserts value;
    // once(event: "commented-out"): this;
  }
}
`;
  expect(processMerges(sample)).toEqual([
    {
      line: 4,
      members: [
        "isBun",
        "revision",
        "noDeprecation",
        "reallyExit",
        "dlopen",
        "on",
        "emit",
        "off",
        "binding",
        "binding",
      ],
    },
    { line: 24, members: ["assert"] },
  ]);
  expect(
    processMerges(`declare module "node:process" { interface ProcessEventMap { memoryPressure: [level: string] } }`),
  ).toEqual([]);
});

test("bun-types declares no EventEmitter members on NodeJS.Process", () => {
  expect(offenders).toEqual([]);
});
