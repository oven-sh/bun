import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], lib: ["esnext", "dom"] },
});
const app = `function double(n: number): number {
  return n * 2;
}

const body: any = JSON.parse('{"visits":"3"}');
console.log(double(body.visits));
console.log((body.visits as number) + 1);
`;

function project(name: string, files: Record<string, string>) {
  return String(tempDir(name, { "tsconfig.json": tsconfig, "package.json": JSON.stringify({ name: "app", type: "module" }), ...files }));
}
async function spawned(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NO_COLOR: "1", ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const bun = (cwd: string, ...args: string[]) => spawned([bunExe(), ...args], cwd);

interface Line {
  word: string;
  id: string;
  kind: string;
  place: string;
  action: string;
  call?: string;
  text: string;
}
function lines(text: string, word: "type-error" | "type-check"): Line[] {
  const found: Line[] = [];
  for (const line of text.split("\n")) {
    const match = /^\[aot\] (type-error|type-check) ([0-9a-f]{12}) ([a-z0-9-]+) (\S+:\d+:\d+) \(.*?\): (.*)$/.exec(line);
    if (!match || match[1] !== word) continue;
    const rest = match[5].split("; ");
    found.push({
      word: match[1],
      id: match[2],
      kind: match[3],
      place: match[4],
      action: rest.find(part => /^(would-[a-z]+|continued|converted|threw|dropped|copied|warning|error)$/.test(part)) ?? "",
      call: rest.find(part => part.startsWith("call "))?.slice(5),
      text: line,
    });
  }
  return found;
}
const brief = (found: Line[]) => found.map(line => `${line.kind} ${line.place} ${line.action}`);

const compiles = (isMacOS && isArm64) || (isLinux && !isArm64);

describe.concurrent("bun --aot-audit", () => {
  test("the program runs as usual, and each difference is named", async () => {
    const dir = project("aot-audit-run", { "app.ts": app });
    const plain = await bun(dir, "app.ts");
    const audited = await bun(dir, "--aot-audit", "app.ts");
    expect(plain).toEqual({ stdout: "6\n31\n", stderr: "", exitCode: 0 });
    expect(audited.stdout).toBe(plain.stdout);
    expect(brief(lines(audited.stderr, "type-error"))).toEqual(["read-property app.ts:6:20 would-throw", "as-convert app.ts:7:14 would-convert"]);
    expect(audited.exitCode).toBe(0);
  });

  test("a program that keeps to its types has no line", async () => {
    const dir = project("aot-audit-clean", {
      "app.ts": `interface User { name: string; age: number }
const users: User[] = [{ name: "Ada", age: 36 }];
let total = 0;
for (const user of users) total += user.age;
console.log(total, users.map(user => user.name).join());
`,
    });
    expect(await bun(dir, "--aot-audit", "app.ts")).toEqual({ stdout: "36 Ada\n", stderr: "", exitCode: 0 });
  });

  test("a line never holds a value", async () => {
    const dir = project("aot-audit-values", {
      "app.ts": `const secret: any = JSON.parse('"hunter2"');\nconst n: number = secret;\nconsole.log(typeof n);\n`,
    });
    const { stdout, stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(stdout).toBe("string\n");
    expect(lines(stderr, "type-error")).toHaveLength(1);
    expect(stderr).not.toContain("hunter2");
  });

  test("x!, a parameter reached through any, a loop variable, a constructor", async () => {
    const dir = project("aot-audit-kinds", {
      "app.ts": `const raw: any = JSON.parse('{"list":[1,"2"],"none":null}');
const none: string | null = raw.none;
try { none!.length; } catch {}
function twice(n: number) { return n * 2; }
const loose: any = twice;
loose("4");
const list: number[] = raw.list;
let sum = 0;
for (const item of list) sum += item;
class Point { constructor(public x: number) {} }
new (Point as any)("1");
`,
    });
    const { stderr, exitCode } = await bun(dir, "--aot-audit", "app.ts");
    expect(brief(lines(stderr, "type-error"))).toEqual([
      "non-null app.ts:3:7 would-throw",
      "enter-function app.ts:4:1 would-throw",
      "iterate-value app.ts:9:12 would-throw",
      "enter-function app.ts:10:15 would-throw",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a write to a built-in object", async () => {
    const dir = project("aot-audit-builtins", { "app.ts": `(Math as any).ceil = () => 1;\nconsole.log(Math.ceil(1.5));\n` });
    const { stdout, stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(stdout).toBe("1\n");
    expect(brief(lines(stderr, "type-error"))).toEqual(["builtin-member-replace app.ts:1:2 would-refuse"]);
  });

  test("a place writes its 1st, 10th and 100th failure", async () => {
    const dir = project("aot-audit-counts", {
      "app.ts": `const raw: any = JSON.parse('"x"');\nfunction take(n: number) { return n; }\nconst loose: any = take;\nfor (let i = 0; i < 150; i++) loose(raw);\n`,
    });
    const { stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(lines(stderr, "type-error").map(line => /count (\d+)/.exec(line.text)![1])).toEqual(["1", "10", "100"]);
  });

  test("bun test", async () => {
    const dir = project("aot-audit-test", {
      "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, run: () => void): void;\n  export function expect(value: unknown): { toBe(expected: unknown): void };\n}\n`,
      "a.test.ts": `import { expect, test } from "bun:test";
const raw: any = JSON.parse('{"n":"8"}');
test("half", () => {
  const n: number = raw.n;
  expect(n as unknown).toBe("8");
});
`,
    });
    const { stderr, exitCode } = await bun(dir, "test", "--aot-audit", "a.test.ts");
    expect(brief(lines(stderr, "type-error"))).toEqual(["read-property a.test.ts:4:21 would-throw"]);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("bun test: a wrong argument for an imported function", async () => {
    const declared = `declare module "bun:test" {\n  export function test(name: string, run: () => void): void;\n  export function expect(value: unknown): { toBe(expected: unknown): void };\n  export const mock: { module(path: string, make: () => object): void };\n}\n`;
    const dir = project("aot-audit-test-imported", {
      "bun-test.d.ts": declared,
      "lib.ts": `export function half(n: number) { return n / 2; }\n`,
      "a.test.ts": `import { expect, test } from "bun:test";
import { half } from "./lib";
test("half", () => {
  expect(half(JSON.parse('"8"'))).toBe(4);
});
`,
      "mocked.test.ts": `import { expect, mock, test } from "bun:test";
import { half } from "./lib";
mock.module("./lib", () => ({ half: () => 1 }));
test("half", () => {
  expect(half(JSON.parse('"8"'))).toBe(1);
});
`,
    });
    const plain = await bun(dir, "test", "--aot-audit", "a.test.ts");
    expect(lines(plain.stderr, "type-error").map(line => `${line.place.replace(/:\d+$/, "")} ${line.action}`)).toEqual(["a.test.ts:4 would-throw"]);
    const mocked = await bun(dir, "test", "--aot-audit", "mocked.test.ts");
    expect(lines(mocked.stderr, "type-error")).toEqual([]);
    expect(mocked.stderr).toContain("1 pass");
  });

  test("a value that `as` converts fails no later check", async () => {
    const dir = project("aot-audit-converted", {
      "app.ts": `function double(n: number): number { return n * 2; }
class Box { constructor(public n: number) {} }
const query: any = { page: "2", size: "3" };
const page = query.page as number;
console.log(double(page));
console.log(double([query.page as number][0]));
console.log(double(new Box(query.page as number).n));
console.log(double((() => query.page as number)()));
console.log(double(query.size));
`,
    });
    const { stdout, stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(stdout).toBe("4\n4\n4\n4\n6\n");
    expect(lines(stderr, "type-error").map(line => `${line.place.replace(/:\d+$/, "")} ${line.action}`)).toEqual([
      "app.ts:4 would-convert",
      "app.ts:6 would-convert",
      "app.ts:7 would-convert",
      "app.ts:8 would-convert",
      "app.ts:9 would-throw",
    ]);
  });

  test("BUN_AOT_TYPE_ERROR_LOG: a file, json, off", async () => {
    const dir = project("aot-audit-log", { "app.ts": app });
    const audit = (env: Record<string, string>) => spawned([bunExe(), "--aot-audit", "app.ts"], dir, env);
    const toFile = await audit({ BUN_AOT_TYPE_ERROR_LOG: join(dir, "audit.jsonl") });
    expect(toFile.stderr).toBe("");
    expect(toFile.stdout).toBe("6\n31\n");
    const written = readFileSync(join(dir, "audit.jsonl"), "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ aot: "type-error", kind: "read-property", file: "app.ts", line: 6, col: 20, fn: "module", got: "string", action: "would-throw", count: 1 });
    expect(written[0].callId).toMatch(/^[0-9a-f]{12}$/);
    expect(written[1]).toMatchObject({ kind: "as-convert", line: 7, col: 14, action: "would-convert" });
    expect((await audit({ BUN_AOT_TYPE_ERROR_LOG_FORMAT: "json" })).stderr.split("\n")[0]).toStartWith('{"aot":"type-error"');
    expect((await audit({ BUN_AOT_TYPE_ERROR_LOG: "off" })).stderr).toBe("");
  });

  test("a preload that calls another file's function", async () => {
    const dir = project("aot-audit-preload", {
      "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, run: () => void): void;\n  export function expect(value: unknown): { toBe(expected: unknown): void };\n}\n`,
      "util.ts": `export function half(n: number): number { return n / 2; }\n`,
      "setup.ts": `import { half } from "./util";\nconsole.log("preloaded", half(8));\n`,
      "a.test.ts": `import { expect, test } from "bun:test";\ntest("one", () => { expect(1).toBe(1); });\n`,
    });
    const { stdout, stderr, exitCode } = await bun(dir, "test", "--aot-audit", "--preload", "./setup.ts", "a.test.ts");
    expect(stdout).toContain("preloaded 4");
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("a loop over a Set, a generator, a Map", async () => {
    const dir = project("aot-audit-collections", {
      "app.ts": `const set = new Set<number>(JSON.parse('["4"]'));
let n = 0;
for (const x of set) n += x;
const map = new Map<string, number>(JSON.parse('[[1, "6"]]'));
for (const [k, v] of map) console.log(String(k).length, v + 1);
console.log(n);
`,
    });
    const { stdout, stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(stdout).toBe("1 61\n04\n");
    expect([...new Set(lines(stderr, "type-error").map(line => `${line.place.replace(/:\d+$/, "")} ${line.action}`))]).toEqual(["app.ts:3 would-throw", "app.ts:5 would-throw"]);
  });

  test("type errors come first", async () => {
    const dir = project("aot-audit-errors", { "app.ts": `const n: number = "x";\nconst m: number = JSON.parse('"y"');\nconsole.log(n, m);\n` });
    const { stdout, stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(stdout).toBe("x y\n");
    expect(stderr).toContain("TS2322");
    expect(stderr).toContain("[aot] note: fix these type errors first");
    expect(lines(stderr, "type-error")).toEqual([]);
  });

  test("a file that calls eval() directly is not audited, and Bun says so", async () => {
    const dir = project("aot-audit-eval", { "app.ts": `const local = 3;\nconst n: number = JSON.parse('"y"');\nconsole.log(eval("local"), n);\n` });
    const { stdout, stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(stdout).toBe("3 y\n");
    expect(stderr).toStartWith("[aot] note: app.ts is not audited: ");
    expect(stderr.trimEnd().split("\n")).toHaveLength(1);
  });

  test("what the program prints of its own functions and stacks is unchanged", async () => {
    const dir = project("aot-audit-text", {
      "app.ts": `const f = (x: any) => (x as any) ? ((x as number), (x as number)) : (x as string);
function where(n: number) { return new Error("here").stack!.split("\\n").length; }
console.log(String(f), where(1));
`,
    });
    const plain = await bun(dir, "app.ts");
    expect(await bun(dir, "--aot-audit", "app.ts")).toEqual(plain);
  });
});

describe.concurrent("bun check --aot", () => {
  const wrong = `function double(n: number): number {
  return n * 2;
}

console.log(double("4" as any));
const five = "5" as unknown as number;
(Array.prototype as any).last = function () {};
let later!: number;
console.log(five, later);
`;

  test("what always fails is an error", async () => {
    const dir = project("aot-check-errors", { "wrong.ts": wrong });
    const { stdout, stderr, exitCode } = await bun(dir, "check", "--aot", "wrong.ts");
    const codes = [...(stdout + stderr).matchAll(/TS1000\d\d/g)].map(match => match[0]);
    expect(codes).toEqual(["TS100013", "TS100017", "TS100014", "TS100012"]);
    expect(stdout + stderr).toContain("argument 1 of `double` expects 'number' and always gets \"4\"");
    expect(exitCode).toBe(1);
  });

  test("without --aot the same file has no error", async () => {
    const dir = project("aot-check-plain", { "wrong.ts": wrong });
    expect((await bun(dir, "check", "wrong.ts")).exitCode).toBe(0);
  });

  test("--aot-explain=throws lists what can fail, and one summary line", async () => {
    const dir = project("aot-check-throws", { "app.ts": app });
    const { stderr, exitCode } = await bun(dir, "check", "--aot", "--aot-explain=throws", "app.ts");
    const said = stderr.split("\n").filter(line => line.startsWith("[aot]") || line.startsWith("aot:"));
    expect(brief(lines(stderr, "type-check"))).toEqual(["read-property app.ts:6:20 warning", "as-late-use app.ts:7:13 warning", "as-convert app.ts:7:14 warning"]);
    expect(said.slice(3)).toEqual(["[aot] type-check summary: 3 checks can fail when the program runs, 0 always fail"]);
    expect(said[0]).toContain("; value from JSON.parse(..) at app.ts:5:24; fix: ");
    expect(exitCode).toBe(0);
  });

  test("--aot-explain=throws-json prints one object per line on stdout", async () => {
    const dir = project("aot-check-json", { "app.ts": app });
    const { stdout } = await bun(dir, "check", "--aot", "--aot-explain=throws-json", "app.ts");
    const objects = stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    expect(objects.map(it => [it.aot, it.kind, it.file, it.line, it.col, it.action, it.category])).toEqual([
      ["type-check", "read-property", "app.ts", 6, 20, "warning", "untyped-input"],
      ["type-check", "as-late-use", "app.ts", 7, 13, "warning", "untyped-input"],
      ["type-check", "as-convert", "app.ts", 7, 14, "warning", "untyped-input"],
    ]);
  });
});

describe.concurrent.skipIf(!compiles)("bun build --compile --aot", () => {
  test("what always fails stops the build", async () => {
    const dir = project("aot-build-errors", { "wrong.ts": `function double(n: number) { return n * 2; }\nconsole.log(double("4" as any));\n` });
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", "--aot", "wrong.ts", "--outfile", "wrong");
    expect(stdout + stderr).toContain("TS100013");
    expect(exitCode).toBe(1);
  }, 120_000);

  test("Bun.build: what always fails is in logs", async () => {
    const dir = project("aot-build-api-errors", {
      "wrong.ts": `function double(n: number) { return n * 2; }\nconsole.log(double("4" as any));\n`,
      "build.ts": `const result = await Bun.build({ entrypoints: ["./wrong.ts"], throw: false, compile: { outfile: "./wrong", aot: true } });
console.log(result.success, result.logs.filter(log => String(log.message).includes("TS100013")).length);
`,
    });
    expect((await bun(dir, "build.ts")).stdout).toBe("false 1\n");
  }, 120_000);

  test("a build that does not ask for a report prints none", async () => {
    const dir = project("aot-build-quiet", { "app.ts": app });
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", "--aot", "app.ts", "--outfile", "app");
    expect(stdout + stderr).not.toContain("type-check");
    expect(exitCode).toBe(0);
  }, 120_000);

  test("an unknown report is an error that names the reports", async () => {
    const dir = project("aot-build-unknown", { "app.ts": app });
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", "--aot", "--aot-explain=nonsense", "app.ts", "--outfile", "app");
    expect(stdout + stderr).toContain("it is one of throws, throws-all, throws-json, throws-all-json");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("Bun.build: aotExplain adds the report to logs", async () => {
    const dir = project("aot-build-api", {
      "app.ts": app,
      "build.ts": `const result = await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./app", aot: true, aotExplain: "throws" } });
console.log(JSON.stringify(result.logs.filter(log => log.level === "verbose").map(log => String(log.message).split(" ").slice(0, 2).join(" "))));
`,
    });
    const { stdout, exitCode } = await bun(dir, "build.ts");
    expect(JSON.parse(stdout)).toEqual(["[aot] type-check", "[aot] type-check", "[aot] type-check", "[aot] type-check"]);
    expect(exitCode).toBe(0);
  }, 120_000);

  test("Bun.build refuses aotTypeErrors and aotExplain without aot", async () => {
    const dir = project("aot-build-refused", {
      "app.ts": app,
      "build.ts": `for (const compile of [{ aotTypeErrors: "log" }, { aotExplain: "throws" }] as const) {
  try {
    await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./app", ...compile } });
    console.log("built");
  } catch (error) {
    console.log((error as Error).message);
  }
}
`,
    });
    expect((await spawned([bunExe(), "build.ts"], dir)).stdout).toBe(
      "compile.aotTypeErrors requires compile.aot: true\ncompile.aotExplain requires compile.aot: true\n",
    );
  }, 120_000);

  test("the default throws", async () => {
    const dir = project("aot-build-throw", { "app.ts": app });
    expect((await bun(dir, "build", "--compile", "--aot", "app.ts", "--outfile", "app")).exitCode).toBe(0);
    const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
    expect(stdout).toBe("");
    expect(stderr).toContain("TypeError: expected number");
    expect(stderr).toContain("app.ts:6:20");
    expect(exitCode).toBe(1);
  }, 120_000);

  describe("--aot-type-errors=log", () => {
    async function built(name: string, text = app) {
      const dir = project(name, { "app.ts": text });
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "app.ts", "--outfile", "app");
      expect(build.stderr).not.toContain("error");
      expect(build.exitCode).toBe(0);
      return dir;
    }

    test("it has no type error that the default build does not have", async () => {
      const dir = project("aot-log-same-errors", {
        "app.ts": `import { last } from "./retry";\nfunction twice(n: number) { return n * 2; }\nconsole.log(twice(4), last());\n`,
        "retry.ts": `import { Client, refresh } from "./client";
export function last(): number {
  let client: Client | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (client === null || attempt > 1) {
      refresh(client?.token);
      client = new Client(attempt);
    }
  }
  return client ? client.id : 0;
}
`,
        "client.ts": `export class Client { token?: string; constructor(public id: number) {} }
export function refresh(token?: string): void { if (token) console.log(token.length); }
`,
      });
      for (const mode of ["throw", "log"]) {
        const build = await bun(dir, "build", "--compile", "--aot", `--aot-type-errors=${mode}`, "app.ts", "--outfile", "app");
        expect(build.stdout + build.stderr).not.toContain("error");
        expect(build.exitCode).toBe(0);
        expect((await spawned([join(dir, "app")], dir)).stdout).toBe("8 3\n");
      }
    }, 240_000);

    test("the executable writes a line and goes on", async () => {
      const dir = await built("aot-log-run");
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe("6\n4\n");
      expect(brief(lines(stderr, "type-error").filter(line => !line.text.endsWith("; total")))).toEqual([
        "enter-argument app.ts:6:13 continued",
        "as-convert app.ts:7:14 converted",
      ]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("BUN_AOT_TYPE_ERROR_LOG: a file, json, off", async () => {
      const dir = await built("aot-log-file");
      const toFile = await spawned([join(dir, "app")], dir, { BUN_AOT_TYPE_ERROR_LOG: join(dir, "errors.log"), BUN_AOT_TYPE_ERROR_LOG_FORMAT: "json" });
      expect(toFile.stderr).toBe("");
      const first = JSON.parse(readFileSync(join(dir, "errors.log"), "utf8").split("\n")[0]);
      expect(first).toMatchObject({ aot: "type-error", kind: "enter-argument", file: "app.ts", line: 6, col: 13, got: "string", action: "continued", count: 1 });
      expect((await spawned([join(dir, "app")], dir, { BUN_AOT_TYPE_ERROR_LOG: "off" })).stderr).toBe("");
    }, 120_000);

    test("counts and a total at exit; never a value", async () => {
      const dir = await built(
        "aot-log-counts",
        `function take(n: number) { return n; }\nconst inputs: any[] = JSON.parse('["hunter2"]');\nfor (let i = 0; i < 12; i++) take(inputs[0]);\n`,
      );
      const { stderr } = await spawned([join(dir, "app")], dir);
      expect(lines(stderr, "type-error").map(line => /count (\d+(; total)?)/.exec(line.text)![1])).toEqual(["1", "10", "12; total"]);
      expect(stderr).not.toContain("hunter2");
    }, 120_000);

    test("the reason, without values", async () => {
      const dir = await built(
        "aot-log-reason",
        `interface Inner { n: number }
interface Outer { name: string; inner: Inner }
function make(): Outer { return { name: "a", inner: { n: 1 } }; }
function unwrap(data: unknown): Outer { return data as Outer; }
console.log(make().name);
try { unwrap(JSON.parse('{"name":"b","inner":{"n":"hunter2"}}')); } catch {}
`,
      );
      const { stderr } = await spawned([join(dir, "app")], dir);
      expect(stderr).toContain("; reason property 'inner.n': expected number, got string;");
      expect(stderr).not.toContain("hunter2");
    }, 120_000);

    const roads = `interface Ctx { cwd: string }
interface Session { type: "session"; id: string; ctx: Ctx }
function fresh(id: string): Session { return { type: "session", id, ctx: { cwd: "/" } }; }
const parse = (text: string): any => JSON.parse(text);
const show = (n: number, f: () => unknown[]) => { try { console.log(n, ...f()); } catch { console.log(n, "thrown"); } };
console.log(fresh("a").id);
show(1, () => { const s: Session = parse('{"id":"y"}'); return [s.id, s.ctx]; });
show(2, () => { function give(): Session { return parse('{"id":"y"}'); } return [give().id]; });
show(3, () => { const box: { s: Session } = { s: fresh("b") }; box.s = parse('{"id":"y"}'); return [box.s.id, box.s.type]; });
show(4, () => { const list: Session[] = parse('[{"id":"y"}]'); return [list[0].id]; });
show(5, () => { function idOf(s: Session): number { return s.id.length + 1; } return [idOf(parse('{"id":"y"}'))]; });
`;

    test("an object that does not match its type: a line, and the program goes on as plain Bun does", async () => {
      const dir = await built("aot-log-object", roads);
      const plain = await bun(dir, "app.ts");
      expect(plain.stdout).toBe("a\n1 y undefined\n2 y\n3 y undefined\n4 y\n5 2\n");
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      expect(brief(lines(stderr, "type-error").filter(line => !line.text.endsWith("; total")))).toEqual([
        "enter-variable app.ts:7:36 continued",
        "enter-return app.ts:8:51 continued",
        "enter-field app.ts:9:72 continued",
        "read-element app.ts:10:72 continued",
        "enter-argument app.ts:11:92 continued",
      ]);
      expect(stderr).toContain("; reason property 'type' is missing in untyped object but required in Session");
      expect(exitCode).toBe(0);
      expect((await bun(dir, "build", "--compile", "--aot", "app.ts", "--outfile", "throws")).exitCode).toBe(0);
      expect((await spawned([join(dir, "throws")], dir)).stdout).toBe("a\n1 thrown\n2 thrown\n3 thrown\n4 thrown\n5 thrown\n");
    }, 240_000);

    test("the report says where this build goes on", async () => {
      const dir = project("aot-log-report", { "app.ts": roads });
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      const report = lines(build.stdout + build.stderr, "type-check").map(line => line.text);
      expect(report.filter(text => text.includes("; this log build continues here")).length).toBe(4);
      expect(report.filter(text => text.includes("; this log build throws here")).map(text => /expected ([^,]+),/.exec(text)![1])).toEqual(["Session[]", "number"]);
      expect(build.stdout + build.stderr).toContain("this build continues at 4, converts at 0 and still throws at 2");
      const other = await bun(dir, "build", "--compile", "--aot", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(other.stdout + other.stderr).not.toContain("log build");
    }, 240_000);

    test("a record without its number, as an argument", async () => {
      const dir = await built(
        "aot-log-flat",
        `interface Row { id: string; n: number }
function fresh(): Row { return { id: "a", n: 1 }; }
function next(row: Row): string { return row.id + " " + (row.n + 1); }
const parse = (text: string): any => JSON.parse(text);
console.log(next(fresh()));
console.log(next(parse('{"id":"y"}')));
console.log(next(parse('{"id":"z","n":3}')));
`,
      );
      const { stdout, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe("a 2\ny NaN\nz 4\n");
      expect(exitCode).toBe(0);
    }, 120_000);

    test("Bun.build: aotTypeErrors", async () => {
      const dir = project("aot-log-api", {
        "app.ts": app,
        "build.ts": `const result = await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./app", aot: true, aotTypeErrors: "log" } });\nconsole.log(result.success);\n`,
      });
      expect((await bun(dir, "build.ts")).stdout).toBe("true\n");
      expect((await spawned([join(dir, "app")], dir)).stdout).toBe("6\n4\n");
    }, 120_000);
  });

  test("one place has one id in the audit, the report and the executable", async () => {
    const dir = project("aot-one-story", { "app.ts": app });
    const audit = lines((await bun(dir, "--aot-audit", "app.ts")).stderr, "type-error");
    const report = lines((await bun(dir, "check", "--aot", "--aot-explain=throws", "app.ts")).stderr, "type-check");
    expect((await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "app.ts", "--outfile", "app")).exitCode).toBe(0);
    const log = lines((await spawned([join(dir, "app")], dir)).stderr, "type-error");
    const at = (found: Line[], place: string) => found.find(line => line.place === place)!;
    expect(at(report, "app.ts:6:20").id).toBe(at(audit, "app.ts:6:20").id);
    expect(at(report, "app.ts:6:20").call).toBe(at(audit, "app.ts:6:20").call);
    expect(at(log, "app.ts:6:13").id).toBe(at(audit, "app.ts:6:20").call!);
    expect(at(report, "app.ts:7:14").id).toBe(at(audit, "app.ts:7:14").id);
    expect(at(log, "app.ts:7:14").id).toBe(at(audit, "app.ts:7:14").id);
  }, 120_000);
});

describe.concurrent("--help", () => {
  test.each([
    [[], ["--aot ", "--aot-audit", "--aot-type-errors"]],
    [["run"], ["--aot ", "--aot-audit", "--aot-type-errors"]],
    [["test"], ["--aot-audit", "--aot<"]],
    [["build"], ["--aot ", "--aot-explain", "--aot-type-errors"]],
    [["check"], ["--aot ", "--aot-explain"]],
  ] as [string[], string[]][])("bun %p", async (command, flags) => {
    const dir = project("aot-help", {});
    const { stdout, stderr } = await bun(dir, ...command, "--help");
    const help = (stdout + stderr).replaceAll("\n", "<\n");
    for (const flag of flags) expect(help).toContain(flag);
    expect(help).not.toContain("--aot-graph-fd");
  });
});
