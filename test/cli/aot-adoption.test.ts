import { afterAll, describe, expect, test } from "bun:test";
import { unsupported } from "../aot/run-programs";
import { readFileSync, rmSync } from "fs";
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

const folders: string[] = [];
afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));
function project(name: string, files: Record<string, string>) {
  const folder = String(tempDir(name, { "tsconfig.json": tsconfig, "package.json": JSON.stringify({ name: "app", type: "module" }), ...files }));
  folders.push(folder);
  return folder;
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

const compiles = !unsupported;

describe.concurrent("bun --aot-audit", () => {
  test("the program runs as usual, and every difference is reported", async () => {
    const dir = project("aot-audit-run", { "app.ts": app });
    const plain = await bun(dir, "app.ts");
    const audited = await bun(dir, "--aot-audit", "app.ts");
    expect(plain).toEqual({ stdout: "6\n31\n", stderr: "", exitCode: 0 });
    expect(audited.stdout).toBe(plain.stdout);
    expect(brief(lines(audited.stderr, "type-error"))).toEqual(["read-property app.ts:6:20 would-throw", "as-convert app.ts:7:14 would-convert"]);
    expect(audited.exitCode).toBe(0);
  });

  test.skipIf(!compiles)("a false cast among the program's own types is named where the executable throws; what the executable accepts has no line", async () => {
    const types = `interface Circle { kind: "circle"; radius: number }
interface Square { kind: "square"; side: number }
interface Label { kind: "label"; text: string }
type Shape = Circle | Square;
function make(kind: string): Circle | Square | Label {
  if (kind === "circle") return { kind: "circle", radius: 1 };
  if (kind === "square") return { kind: "square", side: 2 };
  return { kind: "label", text: "three" };
}
function kindOf(shape: Shape): string { return shape.kind; }
`;
    const dir = project("aot-audit-false-cast", {
      "false.ts": types + `for (const kind of ["circle", "square", "label"]) { const shape = make(kind) as Shape; console.log(kindOf(shape)); }\n`,
      "any.ts": types + `for (const kind of ["circle", "square", "label"]) { const shape: any = make(kind); console.log(kindOf(shape)); }\n`,
      "true.ts": types + `for (const kind of ["circle", "square", "circle"]) { const shape = make(kind) as Shape; console.log(kindOf(shape)); }\n`,
    });
    const audited = await bun(dir, "--aot-audit", "false.ts");
    expect(audited.stdout).toBe("circle\nsquare\nlabel\n");
    const named = lines(audited.stderr, "type-error");
    expect(named.map(line => line.action)).toEqual(["would-throw"]);
    expect(named[0].text).toContain(", got Label;");
    expect((await bun(dir, "build", "--compile", "--aot", "false.ts", "--outfile", "false.exe")).exitCode).toBe(0);
    const run = await spawned([join(dir, "false.exe")], dir, { BUN_AOT_TYPE_ERROR_LOG: "stderr" });
    expect(run.stdout).toBe("circle\nsquare\n");
    const thrown = lines(run.stderr, "type-error").filter(line => !line.text.endsWith("; total"));
    expect(thrown.map(line => line.place)).toEqual([named[0].place]);
    expect(await bun(dir, "--aot-audit", "any.ts")).toEqual({ stdout: "circle\nsquare\nlabel\n", stderr: "", exitCode: 0 });
    expect((await bun(dir, "build", "--compile", "--aot", "any.ts", "--outfile", "any.exe")).exitCode).toBe(0);
    expect((await spawned([join(dir, "any.exe")], dir)).stdout).toBe("circle\nsquare\nlabel\n");
    expect(await bun(dir, "--aot-audit", "true.ts")).toEqual({ stdout: "circle\nsquare\ncircle\n", stderr: "", exitCode: 0 });
  }, 240_000);

  test("a program that respects its types logs nothing", async () => {
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

  test("a log line never contains a value from the program", async () => {
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

  test("each location logs its 1st, 10th and 100th failure", async () => {
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
    expect(lines(mocked.stderr, "type-error").map(line => `${line.place.replace(/:\d+$/, "")} ${line.action}`)).toEqual(["mocked.test.ts:5 would-throw"]);
    expect(mocked.stderr).toContain("1 pass");
  });

  test("a value converted by `as` passes later checks", async () => {
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

  test("a file that calls eval() directly is not audited, and Bun reports that", async () => {
    const dir = project("aot-audit-eval", { "app.ts": `const local = 3;\nconst n: number = JSON.parse('"y"');\nconsole.log(eval("local"), n);\n` });
    const { stdout, stderr } = await bun(dir, "--aot-audit", "app.ts");
    expect(stdout).toBe("3 y\n");
    expect(stderr).toStartWith("[aot] note: app.ts is not audited: ");
    expect(stderr.trimEnd().split("\n")).toHaveLength(1);
  });

  test("the program's own function source text and stack traces are unchanged", async () => {
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

  test("a check that always fails is an error", async () => {
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

  test("--aot-explain=throws lists the checks that can fail, with counts and causes", async () => {
    const dir = project("aot-check-throws", { "app.ts": app });
    const { stderr, exitCode } = await bun(dir, "check", "--aot", "--aot-explain=throws", "app.ts");
    const said = stderr.split("\n").filter(line => line.startsWith("[aot]") || line.startsWith("aot:"));
    expect(brief(lines(stderr, "type-check"))).toEqual(["read-property app.ts:6:20 warning", "as-late-use app.ts:7:13 warning", "as-convert app.ts:7:14 warning"]);
    expect(said.slice(3)).toEqual([
      "[aot] type-check summary: 3 checks can fail when the program runs, 0 always fail",
      "[aot] type-check summary: those that can fail: 1 at an `as`, 1 where a value that an `as` let through is used, 1 on an `any`",
    ]);
    expect(said[0]).toContain("; value from JSON.parse(..) at app.ts:5:24; fix: ");
    expect(exitCode).toBe(0);
  });

  test("--aot-explain=throws-json prints one object per line on stdout", async () => {
    const dir = project("aot-check-json", { "app.ts": app });
    const { stdout } = await bun(dir, "check", "--aot", "--aot-explain=throws-json", "app.ts");
    const objects = stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    expect(objects.map(it => [it.aot, it.kind, it.file, it.line, it.col, it.action, it.category, it.cause])).toEqual([
      ["type-check", "read-property", "app.ts", 6, 20, "warning", "untyped-input", "any"],
      ["type-check", "as-late-use", "app.ts", 7, 13, "warning", "untyped-input", "after-as"],
      ["type-check", "as-convert", "app.ts", 7, 14, "warning", "untyped-input", "as"],
    ]);
  });
});

describe.concurrent.skipIf(!compiles)("bun build --compile --aot", () => {
  test("a check that always fails stops the build", async () => {
    const dir = project("aot-build-errors", { "wrong.ts": `function double(n: number) { return n * 2; }\nconsole.log(double("4" as any));\n` });
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", "--aot", "wrong.ts", "--outfile", "wrong");
    expect(stdout + stderr).toContain("TS100013");
    expect(exitCode).toBe(1);
  }, 120_000);

  test("Bun.build: a check that always fails is in logs", async () => {
    const dir = project("aot-build-api-errors", {
      "wrong.ts": `function double(n: number) { return n * 2; }\nconsole.log(double("4" as any));\n`,
      "build.ts": `const result = await Bun.build({ entrypoints: ["./wrong.ts"], throw: false, compile: { outfile: "./wrong", aot: true } });
console.log(result.success, result.logs.filter(log => String(log.message).includes("TS100013")).length);
`,
    });
    expect((await bun(dir, "build.ts")).stdout).toBe("false 1\n");
  }, 120_000);

  test("a build prints no report unless asked", async () => {
    const dir = project("aot-build-quiet", { "app.ts": app });
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", "--aot", "app.ts", "--outfile", "app");
    expect(stdout + stderr).not.toContain("type-check");
    expect(exitCode).toBe(0);
  }, 120_000);

  test("an unknown report name is an error that lists the valid names", async () => {
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
    expect(JSON.parse(stdout)).toEqual(Array(5).fill("[aot] type-check"));
    expect(exitCode).toBe(0);
  }, 120_000);

  test("Bun.build rejects aotTypeErrors and aotExplain without aot", async () => {
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

    test("it reports no type error that the default build does not report", async () => {
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

    test("the executable logs a line and continues", async () => {
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

    test("the reason logged at a function entry never contains a value from the program", async () => {
      const dir = await built(
        "aot-log-reason-entry",
        `const handler: any = show;
function show({ n }: { n: number }): string { return "n=" + n; }
console.log(handler({ n: "hunter2" }));
`,
      );
      const { stdout, stderr } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe("n=hunter2\n");
      expect(stderr).toContain("; reason property 'n': expected number, got string;");
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

    test("an object that does not match its type is logged, and the program continues as in plain Bun", async () => {
      const dir = await built("aot-log-object", roads);
      const plain = await bun(dir, "app.ts");
      expect(plain.stdout).toBe("a\n1 y undefined\n2 y\n3 y undefined\n4 y\n5 2\n");
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      expect(brief(lines(stderr, "type-error").filter(line => !line.text.endsWith("; total")))).toEqual([
        "enter-return app.ts:8:51 continued",
        "enter-field app.ts:9:72 continued",
        "read-element app.ts:10:72 continued",
        "enter-argument app.ts:11:92 continued",
      ]);
      expect(stderr).toContain("; reason property 'type' is missing in untyped object but required in Session");
      expect(exitCode).toBe(0);
      expect((await bun(dir, "build", "--compile", "--aot", "app.ts", "--outfile", "throws")).exitCode).toBe(0);
      expect((await spawned([join(dir, "throws")], dir)).stdout).toBe("a\n1 y undefined\n2 thrown\n3 thrown\n4 thrown\n5 thrown\n");
    }, 240_000);

    test("the report says where this build continues", async () => {
      const dir = project("aot-log-report", { "app.ts": roads });
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      const report = lines(build.stdout + build.stderr, "type-check").map(line => line.text);
      expect(report.filter(text => text.includes("; this log build continues here")).length).toBe(6);
      expect(report.filter(text => text.includes("; this log build throws here")).map(text => /expected ([^,]+),/.exec(text)![1])).toEqual(["string", "string", "string", "string", "Session[]", "string", "number"]);
      expect(build.stdout + build.stderr).toContain("this build continues at 6, converts at 0 and still throws at 7");
      const other = await bun(dir, "build", "--compile", "--aot", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(other.stdout + other.stderr).not.toContain("log build");
    }, 240_000);

    test("an argument whose number property is missing", async () => {
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

    test("a typical server: a handler defined in one file, registered in another, called indirectly", async () => {
      const dir = project("aot-log-server", {
        "handlers.ts": `export function forJavaScript(n: number): string { return "n=" + n; }
export function forTypeScript(n: number): string { return "n=" + n; }
export function inAMap(n: number): string { return "n=" + n; }
export function forAnEmitter(n: number): void { console.log("emitter " + n); }
export async function later(n: number): Promise<string> { await null; return "n=" + n; }
export const routes: Record<string, (n: number) => string> = { "/a": function routeA(n: number): string { return "n=" + n; }, "/b": (n: number): string => "n=" + n };
`,
        "untyped.js": `export function callsFromJavaScript(f) { return f("wrong"); }\n`,
        "untyped.d.ts": `export function callsFromJavaScript(f: (n: number) => string): string;\n`,
        "events.d.ts": `declare module "node:events" { export class EventEmitter { on(name: string, listener: (...args: any[]) => void): this; emit(name: string, ...args: any[]): boolean; } }\n`,
        "app.ts": `import { EventEmitter } from "node:events";
import { callsFromJavaScript } from "./untyped.js";
import { forAnEmitter, forJavaScript, forTypeScript, inAMap, later, routes } from "./handlers";
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
const body: any = JSON.parse('{"n":"wrong","path":"/a","other":"/b"}');
function dispatch(handler: (n: number) => string, from: any): string { return handler(from.n); }
const byName = new Map<string, (n: number) => string>([["h", inAMap]]);
row(1, () => callsFromJavaScript(forJavaScript));
row(2, () => dispatch(forTypeScript, body));
row(3, () => byName.get("h")!(body.n));
row(4, () => { const e = new EventEmitter(); e.on("x", forAnEmitter); return e.emit("x", body.n); });
row(5, () => routes[body.path](body.n));
row(6, () => routes[body.other](body.n));
try { console.log(7, await later(body.n)); } catch { console.log(7, "thrown"); }
`,
      });
      const plain = await bun(dir, "app.ts");
      expect(plain.stdout).toBe("1 n=wrong\n2 n=wrong\n3 n=wrong\nemitter wrong\n4 true\n5 n=wrong\n6 n=wrong\n7 n=wrong\n");
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.map(line => line.action)).toEqual(Array(7).fill("continued"));
      const foretold = lines(build.stdout + build.stderr, "type-check").filter(line => line.text.includes("; this log build continues here"));
      const ids = new Set(foretold.flatMap(line => [line.id, line.call]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(exitCode).toBe(0);
      const other = await bun(dir, "build", "--compile", "--aot", "--aot-explain=throws", "app.ts", "--outfile", "throws");
      expect(other.exitCode).toBe(0);
      expect((await spawned([join(dir, "throws")], dir)).stdout).toBe("1 thrown\n2 thrown\n3 thrown\n4 thrown\n5 thrown\n6 thrown\n7 thrown\n");
      const named = lines(other.stdout + other.stderr, "type-check").filter(line => line.kind === "enter-function");
      expect(named.map(line => line.place)).toEqual(["1:1", "2:1", "3:1", "4:1", "6:70", "6:133"].map(place => "handlers.ts:" + place));
    }, 240_000);

    test("a class-based server: arrows in a method, a class field, a static field", async () => {
      const dir = await built(
        "aot-log-class",
        `const body: any = JSON.parse('{"n":"wrong","five":5}');
class Router { routes = new Map<string, (n: number) => string>(); get(path: string, handler: (n: number) => string): void { this.routes.set(path, handler); } run(path: string, from: any): string { return this.routes.get(path)!(from); } }
class App {
  prefix = "p"; count = 0; router = new Router();
  field = (n: number): string => this.prefix + " field " + n + " " + ++this.count;
  static shared = "S";
  static fixed = (n: number): string => App.shared + " static " + n + " " + (this === App);
  register(): void { this.router.get("/m", (n: number) => this.prefix + " method " + n + " " + ++this.count); this.router.get("/f", this.field); this.router.get("/s", App.fixed); }
}
const app = new App(); app.register();
for (const path of ["/m", "/f", "/s"]) console.log(app.router.run(path, body.n), "|", app.router.run(path, body.five));
console.log(app.count);
`,
      );
      const plain = await bun(dir, "app.ts");
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      expect(stdout).toBe("p method wrong 1 | p method 5 2\np field wrong 3 | p field 5 4\nS static wrong true | S static 5 true\n4\n");
      expect(lines(stderr, "type-error").filter(line => !line.text.endsWith("; total")).map(line => line.action)).toEqual(["continued", "continued", "continued"]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("methods of an object literal: registered, through any, a setter, a trap of a Proxy, toJSON, async", async () => {
      const dir = project("aot-log-literal", {
        "app.ts": `const body: any = JSON.parse('{"n":"wrong","five":5}');
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
type Handlers = { message(n: number): string };
const registered: Handlers[] = [];
function register(handlers: Handlers): void { registered.push(handlers); }
register({ message(n: number): string { return "registered " + n; } });
const counter = { total: 0, add(n: number): string { return "add " + n + " " + ++this.total; }, set limit(n: number) { this.total = n === 0 ? 0 : 10; }, set ignored(n: number) { this.total = 11; } };
const nested = { websocket: { async message(n: number): Promise<string> { await null; return "nested " + n; } } };
const proxy: any = new Proxy({}, { get(target: object, key: string): string { return "get " + String(key); } });
const json = { toJSON(key: number): string { return "key " + key; } };
const untyped: any = counter;
row(1, () => registered[0].message(body.n));
row(2, () => untyped.add(body.n) + " | " + untyped.add(body.five));
row(3, () => { untyped.limit = body.n; return counter.total; });
row(4, () => proxy[Symbol.iterator]);
row(5, () => JSON.stringify([json]));
try { console.log(6, await (nested as any).websocket.message(body.n)); } catch { console.log(6, "thrown"); }
row(7, () => { untyped.ignored = body.n; return counter.total; });
`,
      });
      const plain = await bun(dir, "app.ts");
      expect(plain.stdout).toBe('1 registered wrong\n2 add wrong 1 | add 5 2\n3 10\n4 get Symbol(Symbol.iterator)\n5 ["key 0"]\n6 nested wrong\n7 11\n');
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(brief(logged)).toEqual(["6:12", "7:29", "7:97", "10:16", "8:31"].map(place => `enter-function app.ts:${place} continued`));
      const foretold = lines(build.stdout + build.stderr, "type-check").filter(line => line.text.includes("; this log build continues here"));
      const ids = new Set(foretold.flatMap(line => [line.id, line.call]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(lines(build.stdout + build.stderr, "type-check").filter(line => line.text.includes("ignored"))).toEqual([]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("a class that extends another: arrows in its constructor, and in a method that calls super", async () => {
      const dir = await built(
        "aot-log-derived",
        `const body: any = JSON.parse('{"n":"wrong","five":5}');
class Router { routes = new Map<string, (n: number) => string>(); get(path: string, handler: (n: number) => string): void { this.routes.set(path, handler); } run(path: string, from: any): string { return this.routes.get(path)!(from); } }
class Base { router = new Router(); constructor(public name: string) {} describe(): string { return "base " + this.name; } }
class App extends Base {
  count = 0;
  constructor() { super("app"); this.router.get("/c", (n: number) => this.name + " constructor " + n + " " + ++this.count); }
  register(): void { const described = super.describe(); this.router.get("/m", (n: number) => described + " method " + n + " " + ++this.count); }
}
const app = new App(); app.register();
for (const path of ["/c", "/m"]) console.log(app.router.run(path, body.n), "|", app.router.run(path, body.five));
console.log(app.count);
`,
      );
      const plain = await bun(dir, "app.ts");
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      expect(stdout).toBe("app constructor wrong 1 | app constructor 5 2\nbase app method wrong 3 | base app method 5 4\n4\n");
      expect(brief(lines(stderr, "type-error").filter(line => !line.text.endsWith("; total")))).toEqual(["enter-function app.ts:6:55 continued", "enter-function app.ts:7:80 continued"]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("functions that escape typed code anonymously: returned, aliased, stored in a table of any, read as members by name", async () => {
      const dir = project("aot-log-roads", {
        "app.ts": `const body: any = JSON.parse('{"n":"wrong","five":5}');
const untyped = (x: unknown) => x as any;
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
function returnsArrow() { return (a: number, b: number, c: number): string => "arrow " + a + b + c; }
function aliased(a: number, b: string, c: number): string { return "aliased " + a + b + c; }
const alias = aliased;
function inATable(a: number, b: number, c: string): string { return "table " + a + b + c; }
const table: Record<string, any> = { t: inATable };
class Service {
  prefix = "s";
  field = (a: string, b: number, c: string): string => this.prefix + " field " + a + b + c;
  makes() { return (a: string, b: number, c: number): string => this.prefix + " made " + a + b + c; }
}
const literal = { taken(a: number, b: string, c: string): string { return "taken " + a + b + c; } };
row(1, () => untyped(returnsArrow())(body.n, 1, 2));
row(2, () => untyped(alias)(body.n, "b", 2));
row(3, () => table.t(body.n, 1, "c"));
row(4, () => untyped(new Service()).field(body.five, 1, "c"));
row(5, () => untyped(new Service().makes())(body.five, 1, 2));
row(6, () => untyped(literal.taken)(body.n, "b", "c"));
row(7, () => (function (a: boolean, b: number, c: number): string { return "stands " + a + b + c; })(body.n, 1, 2));
`,
      });
      const plain = await bun(dir, "app.ts");
      expect(plain.stdout).toBe("1 arrow wrong12\n2 aliased wrongb2\n3 table wrong1c\n4 s field 51c\n5 s made 512\n6 taken wrongbc\n7 stands wrong12\n");
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.map(line => line.action)).toEqual(Array(7).fill("continued"));
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").flatMap(line => [line.id, line.call]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("every TypeError in a run gets its own line that says threw, even if an earlier line for that location says continued", async () => {
      const dir = project("aot-log-back", {
        "app.ts": `interface Req { path: string; n: number }
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
const parse = (text: string): any => JSON.parse(text);
function makes(n: number): Req { return { path: "/typed", n }; }
const h = (r: Req): string => "h:" + r.path + r.n;
function back(r: Req): Req { return r; }
const table: { h: (r: Req) => string; back: (r: Req) => Req }[] = [{ h, back }];
console.log(0, h(back(makes(1))));
row(1, () => table[0].h(table[0].back(parse('"s"'))));
row(2, () => h(table[0].back(parse('"s"'))));
row(3, () => table[0].h(back(parse('"s"'))));
row(4, () => h(back(parse('"s"'))));
row(5, () => { const r: Req = back(parse('"s"')); return typeof r; });
row(6, () => String(back(parse('"s"')).path));
row(7, () => h(back(parse('{"path":"/p","n":1}'))));
`,
      });
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toStartWith("0 h:/typed1\n");
      expect(stdout).toEndWith("7 h:/p1\n");
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.filter(line => line.action === "threw").length).toBe(stdout.split("thrown").length - 1);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("a string or a number passed where a parameter expects an object: called by name, from a table, as a typed parameter", async () => {
      const dir = project("aot-log-objects", {
        "app.ts": `interface Req { path: string; n: number }
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
const parse = (text: string): any => JSON.parse(text);
function makes(n: number): Req { return { path: "/typed", n }; }
const handler = (r: Req): string => "h:" + r.path + r.n;
function declared(r: Req): string { return "d:" + r.path + r.n; }
const table: { h: (r: Req) => string }[] = [{ h: handler }, { h: declared }];
function calls(f: (r: Req) => string, v: any): string { return f(v); }
console.log(0, handler(makes(1)), declared(makes(2)));
for (const text of ['{"path":"/p","n":1}', '"no object"', "7"]) {
  row(1, () => handler(parse(text)) + " " + declared(parse(text)));
  row(2, () => table[0].h(parse(text)) + " " + table[1].h(parse(text)));
  row(3, () => calls(handler, parse(text)) + " " + calls(declared, parse(text)));
}
`,
      });
      const plain = await bun(dir, "app.ts");
      const wrong = "1 h:undefinedundefined d:undefinedundefined\n2 h:undefinedundefined d:undefinedundefined\n3 h:undefinedundefined d:undefinedundefined\n";
      expect(plain.stdout).toBe("0 h:/typed1 d:/typed2\n1 h:/p1 d:/p1\n2 h:/p1 d:/p1\n3 h:/p1 d:/p1\n" + wrong + wrong);
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.filter(line => line.action !== "continued").map(line => line.text)).toEqual([]);
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").flatMap(line => [line.id, line.call]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("closures that escape typed code inside another value keep running: array, generator, field, function argument, tuple, method, async function", async () => {
      const dir = project("aot-log-closures", {
        "app.ts": `const body: any = JSON.parse('{"n":"wrong"}');
interface Mark { only: "here" }
const sink: unknown[] = [];
const letOut = (value: unknown): any => { sink.push(value); return sink[sink.length - 1]; };
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
function inAnArray() { const all: ((n: number, m?: Mark) => string)[] = []; for (let i = 0; i < 2; i++) all.push((n: number, m?: Mark) => i + ":" + n); return all; }
async function resolved(k: number) { await null; return (n: number, k2: number, m?: Mark) => "resolved " + k + n; }
function* yielded(k: number) { yield (n: number, a: string, m?: Mark) => "yielded " + k + n; }
class Keeps { kept: (n: number, b: boolean, m?: Mark) => string; constructor() { this.kept = (n: number, b: boolean, m?: Mark) => "kept " + n; } }
function passes(f: (n: number, m: Mark | null) => string) { return f; }
function inATuple(k: number) { const f = (n: number, m: Mark | undefined, z?: Mark) => "tuple " + k + n; return [f, f] as const; }
class Makes { base = "b"; make(k: number) { return (n: number, m?: Mark | string) => this.base + k + n; } }
row(1, () => letOut(inAnArray()).map((f: any) => f(body.n)).join());
row(2, () => letOut(yielded(1).next().value)(body.n, "a"));
row(3, () => letOut(new Keeps().kept)(body.n, true));
row(4, () => letOut(passes((n: number, m: Mark | null) => "passed " + n))(body.n, null));
row(5, () => letOut(inATuple(1))[1](body.n));
row(6, () => letOut(new Makes().make(1))(body.n));
try { console.log(7, letOut(await resolved(1))(body.n, 2)); } catch { console.log(7, "thrown"); }
`,
      });
      const plain = await bun(dir, "app.ts");
      expect(plain.stdout).toBe("1 0:wrong,1:wrong\n2 yielded 1wrong\n3 kept wrong\n4 passed wrong\n5 tuple 1wrong\n6 b1wrong\n7 resolved 1wrong\n");
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe(plain.stdout);
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.map(line => line.action)).toEqual(Array(7).fill("continued"));
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").flatMap(line => [line.id, line.call]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("the build continues where the report says it does: a closure captures a method parameter and another class has a method of the same name with no parameters", async () => {
      const dir = project("aot-log-capture", {
        "app.ts": `const body: any = JSON.parse('{"n":"wrong"}');
const sink: unknown[] = [];
const letOut = (value: unknown): any => { sink.push(value); return sink[sink.length - 1]; };
class Other { make() { return "none"; } }
class Makes { base = "b"; make(k: number) { return (n: number) => this.base + k + n; } }
console.log(new Other().make());
console.log(letOut(new Makes().make(1))(body.n));
`,
      });
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const row = lines(build.stdout + build.stderr, "type-check").find(line => line.place === "app.ts:5:52")!;
      expect(row.text).toContain("; this log build continues here;");
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe("none\nb1wrong\n");
      expect(lines(stderr, "type-error").filter(line => !line.text.endsWith("; total")).map(line => `${line.id} ${line.action}`)).toEqual([row.id + " continued"]);
      expect(exitCode).toBe(0);
    }, 120_000);

    test("every logged line is in the report: stores to a variable, a property and a static property from a call that runs as plain JavaScript", async () => {
      const dir = project("aot-log-stores", {
        "app.ts": `const body: any = JSON.parse('{"n":"wrong"}');
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
let kept: number = 0;
const box: { n: number } = { n: 0 };
class Holder { n = 0; static total: number = 0; }
const holder = new Holder();
function inAVariable(p: number): string { kept = p; return "kept " + kept; }
function inARecord(p: number): string { box.n = p; return "box " + box.n; }
function inAnObject(p: number): string { holder.n = p; return "holder " + holder.n; }
function inAStatic(p: number): string { Holder.total = p; return "static " + Holder.total; }
const loose = (value: unknown) => value as any;
row(1, () => loose(inAVariable)(body.n));
row(2, () => loose(inARecord)(body.n));
row(3, () => loose(inAnObject)(body.n));
row(4, () => loose(inAStatic)(body.n));
`,
      });
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stderr } = await spawned([join(dir, "app")], dir);
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.map(line => line.action)).toEqual(["continued", "threw", "continued", "threw", "continued", "threw", "continued", "threw"]);
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").flatMap(line => [line.id, line.call, /; logged as ([0-9a-f]{12})/.exec(line.text)?.[1]]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
    }, 120_000);

    test("a valid program logs nothing: whatever the default build accepts, this build accepts silently", async () => {
      const dir = await built(
        "aot-log-valid",
        `interface Ctx { cwd: string }
interface A { type: "s"; id: string; ctx: Ctx }
interface B { type: "s"; id: string; ctx: Ctx }
interface Holds { name: string; a: A }
class K { type = "s" as const; id = "k"; ctx: Ctx = { cwd: "/" }; more = 1; }
function makeB(id: string): B { return { type: "s", id, ctx: { cwd: "/" } }; }
function makeA(id: string): A { return { type: "s", id, ctx: { cwd: "/" } }; }
function show(a: A): string { return a.type + a.id + a.ctx.cwd; }
function showHolds(h: Holds): string { return h.name + show(h.a); }
function holds(): Holds { return { name: "h", a: makeA("i") }; }
const any = (x: unknown) => x as any;
const parse = (text: string): any => JSON.parse(text);
const fromOutside: A = parse('{"type":"s","id":"o","ctx":{"cwd":"/"}}');
console.log(show(fromOutside), show(makeA("a")), showHolds(holds()));
console.log(show(any(makeB("b"))), show(any(new K())));
const built = parse('{"name":"u"}'); built.a = makeB("c"); console.log(showHolds(built));
const other = parse('{"name":"w"}'); other.a = new K(); console.log(showHolds(other));
`,
      );
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe("so/ sa/ hsi/\nsb/ sk/\nusc/\nwsk/\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }, 120_000);

    test("undefined that the default build accepts is not logged: an uninitialized field as an argument, a missing element passed to a callback", async () => {
      const dir = await built(
        "aot-log-undefined",
        `const sink: any[] = [];
function plusOne(n: number): number { return n + 1; }
class Promised { count!: number; }
function first<T>(list: readonly T[], test: (x: T, index: number) => boolean, from: number): boolean { return test(list[from], from); }
const isEven = (x: number) => (x & 1) === 0;
const isOdd = (x: number) => (x & 1) === 1;
sink.push(plusOne, isEven, isOdd);
console.log(plusOne(new Promised().count), first([1, 2], isEven, 5), first([1, 2], isOdd, 5));
`,
      );
      const { stdout, stderr, exitCode } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe("NaN true false\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }, 120_000);

    test("every logged line is in the report: a wrong value returned by an indirectly called function", async () => {
      const dir = project("aot-log-result", {
        "app.ts": `interface Req { path: string; n: number }
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
const parse = (text: string): any => JSON.parse(text);
function back(r: Req): Req { return r; }
const table: { back: (r: Req) => Req }[] = [{ back }];
const t = table[Number("0")];
row(1, () => { const r = t.back(parse('"s"')); return typeof r; });
row(2, () => { const r: Req = t.back(parse('"s"')); return typeof r; });
row(3, () => String(t.back(parse('"s"')).path));
row(4, () => t.back(parse('{"path":"/p","n":1}')).path);
`,
      });
      const build = await bun(dir, "build", "--compile", "--aot", "--aot-type-errors=log", "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr } = await spawned([join(dir, "app")], dir);
      expect(stdout).toBe("1 thrown\n2 thrown\n3 thrown\n4 /p\n");
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.filter(line => line.action === "threw").map(line => line.kind)).toEqual(["call-result", "enter-variable", "call-result"]);
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").flatMap(line => [line.id, line.call]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
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

  test("every line logged at run time is in the build's report: methods, a constructor, a setter, a static method, a function typed as any", async () => {
    const dir = project("aot-report-members", {
      "app.ts": `const body: any = JSON.parse('{"n":"wrong"}');
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
class Account {
  total = 0;
  constructor(public opening: number = 0) {}
  add(n: number): string { return "add " + n; }
  both(label: string, n: number): string { return label + n; }
  set limit(n: number) { this.total = n === 0 ? 0 : 1; }
  set ignored(n: number) { this.total = 2; }
  static parse(n: number): string { return "parse " + n; }
}
function declared(n: number): string { return "declared " + n; }
const held: any = declared;
const account = new Account(1);
row(1, () => account.add(body.n));
row(2, () => account.both("b", body.n));
row(3, () => new Account(body.n).total);
row(4, () => { account.limit = body.n; return account.total; });
row(5, () => Account.parse(body.n));
row(6, () => held(body.n));
row(7, () => { account.ignored = body.n; return account.total; });
`,
    });
    for (const mode of ["throw", "log"]) {
      const build = await bun(dir, "build", "--compile", "--aot", `--aot-type-errors=${mode}`, "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stderr } = await spawned([join(dir, "app")], dir, { BUN_AOT_TYPE_ERROR_LOG: "stderr" });
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.length).toBe(6);
      const report = lines(build.stdout + build.stderr, "type-check");
      expect(report.filter(line => line.text.includes("ignored"))).toEqual([]);
      const ids = new Set(report.flatMap(line => [line.id, line.call, /; logged as ([0-9a-f]{12})/.exec(line.text)?.[1]]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
    }
  }, 240_000);

  test("a wrong argument is logged at the function whether or not the compiler resolves the call: helper, call(), new, static setter, static method, abstract method", async () => {
    const dir = project("aot-report-one-id", {
      "app.ts": `const body: any = JSON.parse('{"n":"wrong"}');
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
const loose = (value: unknown) => value as any;
function declared(n: number): string { return "declared " + n; }
function makes() { return (n: number): string => "made " + n; }
function usesThis(this: { k: number }, n: number): string { return "this " + n + this.k; }
function* steps(n: number): Generator<string> { yield "step " + n; }
class Account {
  static rate = 0;
  constructor(public opening: number) {}
  static set level(n: number) { Account.rate = n === 0 ? 0 : 1; }
  static set ignored(n: number) { Account.rate = 2; }
  static parse(n: number): string { return "parse " + n; }
  static scale(n: number): string { return "scale " + n; }
}
abstract class Shape { abstract area(n: number): string; describe(n: any): string { return this.area(n); } }
class Square extends Shape { area(n: number): string { return "area " + n; } }
row(1, () => loose(declared)(body.n));
row(2, () => loose(declared)("text"));
row(3, () => loose(makes())(body.n));
row(4, () => loose(declared).call(undefined, body.n));
row(5, () => loose(usesThis).call({ k: 1 }, body.n));
row(6, () => [...loose(steps)(body.n)].join());
row(7, () => new (loose(Account))(body.n).opening);
row(8, () => { Account.level = body.n; return Account.rate; });
row(9, () => { loose(Account).level = body.n; return Account.rate; });
row(10, () => loose(Account.parse)(body.n));
row(11, () => loose(Account).scale(body.n));
row(12, () => new Square().describe(body.n));
row(13, () => { loose(Account).ignored = body.n; return Account.rate; });
`,
    });
    for (const mode of ["throw", "log"]) {
      const build = await bun(dir, "build", "--compile", "--aot", `--aot-type-errors=${mode}`, "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stderr } = await spawned([join(dir, "app")], dir, { BUN_AOT_TYPE_ERROR_LOG: "stderr" });
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.map(line => `${line.kind} ${/\((.*?)\)/.exec(line.text)![1]}`)).toEqual(["declared", "anonymous", "usesThis", "steps", "Account", "level", "parse", "scale", "area"].map(name => "enter-function " + name));
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").map(line => line.id));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(lines(build.stdout + build.stderr, "type-check").filter(line => line.text.includes("ignored"))).toEqual([]);
    }
  }, 240_000);

  test("a setter assigned through any is in the report, unless it ignores its parameter", async () => {
    const dir = project("aot-report-setter", {
      "app.ts": `const body: any = JSON.parse('{"n":"wrong","list":[]}');
const row = (n: number, f: () => unknown) => { try { console.log(n, String(f())); } catch { console.log(n, "thrown"); } };
class Gauge { level = 0; set size(n: number) { this.level = n === 0 ? 0 : 1; } set ignored(n: number) { this.level = 2; } }
const gauge = new Gauge(), loose: any = gauge;
row(1, () => (Reflect.construct(Gauge, body.list) as Gauge).level);
row(2, () => { loose.size = body.n; return gauge.level; });
row(3, () => { loose.ignored = body.n; return gauge.level; });
`,
    });
    for (const mode of ["throw", "log"]) {
      const build = await bun(dir, "build", "--compile", "--aot", `--aot-type-errors=${mode}`, "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr } = await spawned([join(dir, "app")], dir, { BUN_AOT_TYPE_ERROR_LOG: "stderr" });
      expect(stdout).toBe("1 0\n2 thrown\n3 2\n");
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.map(line => `${line.kind} ${/\((.*?)\)/.exec(line.text)![1]}`)).toEqual(["enter-function size"]);
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").map(line => line.id));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(lines(build.stdout + build.stderr, "type-check").filter(line => line.text.includes("ignored"))).toEqual([]);
    }
  }, 240_000);

  test("a check behind an `as` is in the report when the cast value goes straight to an annotated parameter", async () => {
    const dir = project("aot-report-behind-as", {
      "app.ts": `interface Circle { kind: "circle"; radius: number }
interface Square { kind: "square"; side: number }
interface Label { kind: "label"; text: string }
type Shape = Circle | Square;
function make(kind: string): Circle | Square | Label {
  if (kind === "circle") return { kind: "circle", radius: 1 };
  if (kind === "square") return { kind: "square", side: 2 };
  return { kind: "label", text: "three" };
}
function kindOf(shape: Shape): string { return shape.kind; }
for (const kind of ["circle", "square", "label"]) {
  try { const shape = make(kind) as Shape; console.log(kindOf(shape)); } catch { console.log("thrown"); }
}
`,
    });
    for (const mode of ["throw", "log"]) {
      const build = await bun(dir, "build", "--compile", "--aot", `--aot-type-errors=${mode}`, "--aot-explain=throws", "app.ts", "--outfile", "app");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr } = await spawned([join(dir, "app")], dir, { BUN_AOT_TYPE_ERROR_LOG: "stderr" });
      expect(stdout).toBe("circle\nsquare\nthrown\n");
      const logged = lines(stderr, "type-error").filter(line => !line.text.endsWith("; total"));
      expect(logged.map(line => line.place)).toEqual(["app.ts:12:63"]);
      const ids = new Set(lines(build.stdout + build.stderr, "type-check").flatMap(line => [line.id, line.call, /; logged as ([0-9a-f]{12})/.exec(line.text)?.[1]]));
      expect(logged.filter(line => !ids.has(line.id)).map(line => line.text)).toEqual([]);
      expect(build.stdout + build.stderr).toContain("those that can fail: 1 where a value that an `as` let through is used");
    }
  }, 240_000);

  test("a location has the same id in the audit, the report and the executable", async () => {
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
    expect((await bun(dir, "build", "--compile", "--aot", "app.ts", "--outfile", "throws")).exitCode).toBe(0);
    const thrown = lines((await spawned([join(dir, "throws")], dir, { BUN_AOT_TYPE_ERROR_LOG: "stderr" })).stderr, "type-error");
    expect(brief(thrown.filter(line => !line.text.endsWith("; total")))).toEqual(["type-mismatch app.ts:6:20 threw"]);
    expect(at(report, "app.ts:6:20").text).toContain("; logged as " + at(thrown, "app.ts:6:20").id + ";");
  }, 240_000);
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
