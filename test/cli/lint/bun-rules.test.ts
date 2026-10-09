// The rules of `bun lint` that are Bun's own: `bun/..`. No other linter has them, so what they should report is written here.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

/**
 * `«` and `»` are around what is reported. They are not part of the code. A string is a case with nothing else to say.
 * `file`: where the file lies, below a directory of its own. By default it is `case-N.tsx`.
 * `output`: the code after one pass of the fixes. `suggestions`: the code with each suggestion alone, in the order of the reports.
 */
type Case =
  | string
  | { code: string; file?: string; options?: unknown[]; ids?: string[]; output?: string; suggestions?: string[] };

const count = `import { count } from "./count";\n`;
const countFunction = [{ countFunction: "count" }];
const rowsState = `const [rows, setRows] = useState([]);\n`;

const fromChildProcess = `import { exec, execFile, execFileSync, execSync, spawn, spawnSync } from "node:child_process";\n`;
const fileSystem = `import fs from "node:fs";\n`;
const path = `import path from "node:path";\n`;
const zod = `import { z } from "zod";\n`;
const fastCheck = `import fc from "fast-check";\n`;
const react = `import React from "react";\n`;
const foo = [{ patterns: [{ pattern: "foo" }] }];
const inText = [{ pairs: [{ outer: "Text", inner: "View" }] }];
const component = (body: string) => `function A({ count }) {\n  const saved = useRef(count);\n${body}\n}`;

const joinFrom = `import { join, resolve } from "node:path";\n`;
const http = [{ modules: [{ package: "axios", use: "@/http" }] }];
const mapped = [
  { modules: [{ package: "axios", use: "@/http", default: "http", names: { isCancel: "wasCancelled" } }] },
];
const insideTable = (body: string) => `function Table({ rows }) {\n${body}\n}`;

const axios = `import axios from "axios";\n`;
const ownClient = [{ clients: [{ module: "./http", names: ["http"] }] }];
const processes = `import { fork, spawn } from "node:child_process";\n`;
const files = `import { createReadStream, createWriteStream, watch } from "node:fs";\n`;
const observer = [{ factories: [{ module: "./observer", names: ["observe"] }] }];

const userId = [{ branded: [{ module: "src/ids", type: "UserId", mint: ["toUserId"], mintedIn: ["src/session.ts"] }] }];
const ids = `import type { UserId } from "../ids";\n`;
const inPage = (it: Case): Case => ({
  options: userId,
  file: "src/views/page.ts",
  ...(typeof it === "string" ? { code: it } : it),
});

const rules: Record<string, Case[]> = {
  "no-eager-dynamic-import": [
    `const a = «import("a")»;`,
    `const a = await «import("a")»;`,
    `«import("a")».then(use);`,
    `export const a = «import("a")»;`,
    `export default «import("a")»;`,
    `const a = «import("a", { with: { type: "json" } })»;`,
    `const a = { b: «import("a")» };`,
    `const a = [«import("a")», «import("b")»];`,
    `const a = flag ? «import("a")» : null;`,
    `if (flag) {\n  await «import("a")»;\n}`,
    `for (const name of names) await «import(name)»;`,
    `try {\n  await «import("a")»;\n} catch {}`,
    `switch (kind) {\n  case 1:\n    «import("a")»;\n}`,
    `block: {\n  «import("a")»;\n}`,
    `namespace N {\n  export const a = «import("a")»;\n}`,
    // What is called where it is written.
    `(() => «import("a")»)();`,
    `(function () {\n  return «import("a")»;\n})();`,
    `(async () => {\n  await «import("a")»;\n})();`,
    `(() => {\n  (() => {\n    «import("a")»;\n  })();\n})();`,
    `(function () {\n  «import("a")»;\n}).call(this);`,
    `(function () {\n  «import("a")»;\n}).apply(this, []);`,
    `new (function () {\n  «import("a")»;\n})();`,
    // What runs when a class is defined.
    `class A {\n  static a = «import("a")»;\n}`,
    `class A {\n  static {\n    «import("a")»;\n  }\n}`,
    `class A {\n  [key(«import("a")»)]() {}\n}`,
    `class A {\n  [key(«import("a")»)] = 1;\n}`,
    `@register(«import("a")»)\nclass A {}`,
    `class A extends mixin(«import("a")») {}`,
    `other.mock(«import("a")»);`,
    `vi.fn(«import("a")»);`,
    `vi.mock("a", «import("b")»);`,

    `function load() {\n  return import("a");\n}`,
    `const load = () => import("a");`,
    `const load = async function () {\n  await import("a");\n};`,
    `const a = lazy(() => import("a"));`,
    `names.map(name => import(name));`,
    `function f(a = import("a")) {}`,
    `const a = { load() { return import("a"); } };`,
    `const a = { get b() { return import("a"); } };`,
    `class A {\n  a = import("a");\n}`,
    `class A {\n  #a = import("a");\n}`,
    `class A {\n  constructor() {\n    import("a");\n  }\n}`,
    `class A {\n  load() {\n    return import("a");\n  }\n}`,
    `class A {\n  static load() {\n    return import("a");\n  }\n}`,
    `class A {\n  static load = () => import("a");\n}`,
    `class A {\n  get a() {\n    return import("a");\n  }\n}`,
    `(() => () => import("a"))();`,
    `function f() {\n  (() => import("a"))();\n}`,
    `(function* () {\n  yield import("a");\n})();`,
    `(function () {\n  import("a");\n}).bind(this);`,
    `type A = typeof import("a");`,
    `let a: import("a").B;`,
    `import a from "a";`,
    `vi.mock(import("a"));`,
    `vi.mock(import("a"), () => ({}));`,
    `vi.doMock(import("a"));`,
    `vi.unmock(import("a"));`,
    `vi.doUnmock(import("a"));`,
  ],

  "no-eager-native-addon": [
    `const addon = «require("./addon.node")»;`,
    `const addon = «require("../build/Release/addon.node")»;`,
    "const addon = «require(`./addon.node`)»;",
    `const { a } = «require("./addon.node")»;`,
    `module.exports = «require("./addon.node")»;`,
    `const addon = await «import("./addon.node")»;`,
    `import addon from «"./addon.node"»;`,
    `import * as addon from «"./addon.node"»;`,
    `import { a } from «'./addon.node'»;`,
    `import «"./addon.node"»;`,
    `export { a } from «"./addon.node"»;`,
    `export * from «"./addon.node"»;`,
    `export * as addon from «"./addon.node"»;`,
    `if (process.platform === "linux") {\n  «require("./linux.node")»;\n}`,
    `try {\n  «require("./addon.node")»;\n} catch {}`,
    `(() => {\n  «require("./addon.node")»;\n})();`,
    `class A {\n  static addon = «require("./addon.node")»;\n}`,
    `const require = createRequire(import.meta.url);\nconst addon = «require("./addon.node")»;`,

    `function load() {\n  return require("./addon.node");\n}`,
    `const load = () => require("./addon.node");`,
    `const load = () => import("./addon.node");`,
    `let addon;\nexport const get = () => (addon ??= require("./addon.node"));`,
    `class A {\n  addon = require("./addon.node");\n}`,
    `const a = require("./addon.js");`,
    `const a = require("./addon.node.js");`,
    `const a = require("node");`,
    `const a = require("./node");`,
    `const a = require(name);`,
    "const a = require(`./${name}.node`);",
    `const a = require.resolve("./addon.node");`,
    `const a = load("./addon.node");`,
    `const a = "./addon.node";`,
    `const a = require();`,
    `import a from "./addon.json";`,
    `import type { A } from "./addon.node";`,
    `export type { A } from "./addon.node";`,
    `export type * from "./addon.node";`,
    `export { a };`,
  ],

  "no-env-at-module-scope": [
    { code: `const port = «process.env.PORT»;`, ids: ["variable"] },
    `const port = «process.env["PORT"]»;`,
    `const port = «process.env[name]»;`,
    `const port = Number(«process.env.PORT») || 3000;`,
    `const port = «process.env.PORT» ?? "3000";`,
    `const port = «process.env.PORT»!;`,
    `const port = «process.env.PORT» as string;`,
    `const port = «process.env?.PORT»;`,
    `const port = «process?.env.PORT»;`,
    `const size = «process.env.PORT».length;`,
    "const path = `${«process.env.HOME»}/a`;",
    `const isSet = typeof «process.env.PORT» === "string";`,
    `export const port = «process.env.PORT»;`,
    `const port = «Bun.env.PORT»;`,
    `const port = «import.meta.env.PORT»;`,
    `if («process.env.DEBUG») enable();`,
    `class A {\n  static port = «process.env.PORT»;\n}`,
    `(() => {\n  use(«process.env.PORT»);\n})();`,
    `import process from "node:process";\nconst port = «process.env.PORT»;`,
    `import * as process from "process";\nconst port = «process.env.PORT»;`,
    `import { env } from "node:process";\nconst port = «env.PORT»;`,
    `import { env as variables } from "node:process";\nconst port = «variables.PORT»;`,
    { code: `const { PORT } = «process.env»;`, ids: ["environment"] },
    `const { NODE_ENV, PORT } = «process.env»;`,
    `const { ...all } = «process.env»;`,
    `const { [name]: value } = «process.env»;`,
    `const all = «process.env»;`,
    `const all = { ...«process.env» };`,
    `start("a", { env: «process.env» });`,
    `const has = "PORT" in «process.env»;`,
    `const all = «Bun.env»;`,
    { code: `const mode = «process.env.NODE_ENV»;`, options: [{ allow: [] }] },
    { code: `const mode = «process.env.NODE_ENV»;`, options: [{ allow: ["PORT"] }] },
    { code: `const { PORT, HOST } = «process.env»;`, options: [{ allow: ["PORT"] }] },

    `const mode = process.env.NODE_ENV;`,
    `const mode = process.env["NODE_ENV"];`,
    `const { NODE_ENV } = process.env;`,
    `const { NODE_ENV: mode = "development" } = process.env;`,
    { code: `const port = process.env.PORT;`, options: [{ allow: ["PORT"] }] },
    { code: `const { PORT, HOST } = process.env;`, options: [{ allow: ["PORT", "HOST"] }] },
    `function port() {\n  return process.env.PORT;\n}`,
    `const port = () => process.env.PORT;`,
    `const config = { get port() { return process.env.PORT; } };`,
    `class A {\n  port = process.env.PORT;\n}`,
    `function all() {\n  return { ...process.env };\n}`,
    `process.env.PORT = "3000";`,
    `process.env.PORT ??= "3000";`,
    `delete process.env.PORT;`,
    `const process = { env: {} };\nconst port = process.env.PORT;`,
    `import process from "./process";\nconst port = process.env.PORT;`,
    `const Bun = { env: {} };\nconst port = Bun.env.PORT;`,
    `const env = {};\nconst port = env.PORT;`,
    `import { env } from "./env";\nconst port = env.PORT;`,
    `import { argv } from "node:process";\nconst port = argv.PORT;`,
    `const port = config.env.PORT;`,
    `const port = other.process.env.PORT;`,
    `const args = process.argv;`,
    `type Env = typeof process.env;`,
    `type Port = typeof process.env.PORT;`,
  ],

  "no-literal-temp-dir": [
    `const a = «"/tmp"»;`,
    `const a = «"/tmp/"»;`,
    `const a = «"/tmp/a.txt"»;`,
    `const a = «'/tmp/a/b'»;`,
    "const a = «`/tmp`»;",
    "const a = «`/tmp/a`»;",
    "const a = «`/tmp/${name}`»;",
    "const a = «`/tmp/a-${id}/${name}`»;",
    `const a = «"/var/tmp"»;`,
    `const a = «"/var/tmp/a"»;`,
    `write(«"/tmp/a"», data);`,
    `const a = join(«"/tmp"», name);`,
    `const a = { directory: «"/tmp/a"» };`,
    `const a = «"/tmp/a"» as const;`,
    `const a = <A directory={«"/tmp/a"»} />;`,
    `function f(directory = «"/tmp"») {}`,
    { code: `const a = «"/scratch/a"»;`, options: [{ directories: ["/scratch"] }] },

    { code: `const a = "/tmp/a";`, options: [{ directories: ["/scratch"] }] },
    { code: `const a = "/tmp/a";`, options: [{ directories: [] }] },
    `const a = tmpdir();`,
    `const a = "/tmpfile";`,
    `const a = "/tmp-a";`,
    `const a = "/tmp.txt";`,
    `const a = "/TMP/a";`,
    `const a = "tmp/a";`,
    `const a = "./tmp/a";`,
    `const a = "/home/tmp/a";`,
    `const a = "/var/tmpfs";`,
    `const a = " /tmp/a";`,
    `const a = "file:///tmp/a";`,
    "const a = `/tmp${suffix}`;",
    "const a = `${root}/tmp/a`;",
    `const a = <a href="/tmp/a" />;`,
    `const a = <p>/tmp/a</p>;`,
    `const a = { "/tmp/a": 1 };`,
    `type A = "/tmp/a";`,
  ],

  "no-negative-repeat-count": [
    {
      code: `const a = " ".repeat(«width - text.length»);`,
      suggestions: [`const a = " ".repeat(Math.max(0, width - text.length));`],
    },
    { code: `a.repeat((«b, c - d»));`, suggestions: [`a.repeat(Math.max(0, (b, c - d)));`] },
    { code: `a.repeat(«-b»);`, suggestions: [`a.repeat(Math.max(0, -b));`] },
    ...[
      `a.repeat(«b - c - d»);`,
      `a.repeat(«(b - c) / 2»);`,
      `a.repeat(«(b - c) % 2»);`,
      `a.repeat(«1 + (b - c)»);`,
      `a.repeat(«2 * (b - c)»);`,
      `a.repeat(«+(b - c)»);`,
      `a.repeat(«-1»);`,
      `a.repeat(«1 - 2»);`,
      `a.repeat(«Math.floor((b - c) / 2)»);`,
      `a.repeat(«Math.ceil(b - c)»);`,
      `a.repeat(«Math.round(b - c)»);`,
      `a.repeat(«Math.trunc(b - c)»);`,
      `a.repeat(«Math.min(b - c, 10)»);`,
      `a.repeat(«Math.max(b - c, d - e)»);`,
      `a.repeat(«Math.max(b - c, -1)»);`,
      `a.repeat(«Math.max(b - c, d)»);`,
      `a.repeat(«flag ? b - c : 0»);`,
      `a.repeat(«flag ? 0 : b - c»);`,
      `a.repeat(«b || c - d»);`,
      `a.repeat(«b ?? c - d»);`,
      `a.repeat(«b && c - d»);`,
      `a.repeat(«(b - c) as number»);`,
      `a.repeat(«(b - c)!»);`,
      `a.repeat(«b -= 1»);`,
      `a.repeat(«b = c - d»);`,
      `a["repeat"](«b - c»);`,
      `a?.repeat(«b - c»);`,
      "`-`.repeat(«b - c»);",
    ].map(code => ({ code, suggestions: [code.replace("«", "Math.max(0, ").replace("»", ")")] })),

    `a.repeat(5);`,
    `a.repeat(b);`,
    `a.repeat(b + c);`,
    `a.repeat(b.length);`,
    `a.repeat(5 - 1);`,
    `a.repeat(2 - 2);`,
    `a.repeat(-0);`,
    `a.repeat(Math.max(0, b - c));`,
    `a.repeat(Math.max(b - c, 0));`,
    `a.repeat(Math.max(1, b - c));`,
    `a.repeat(Math.max(0, Math.floor((b - c) / 2)));`,
    `a.repeat(Math.floor(Math.max(0, b - c) / 2));`,
    `a.repeat(Math.abs(b - c));`,
    `a.repeat(clamp(b - c));`,
    `a.repeat(b[c - d]);`,
    `a.repeat(b - c > 0 ? 1 : 0);`,
    `a.repeat(...b);`,
    `a.repeat();`,
    `a.repeat(b - c, d);`,
    `repeat(b - c);`,
    `a.repeated(b - c);`,
    `const Math = { max: () => 1 };\na.repeat(Math.max(b - c));`,
  ],

  "no-redundant-catch-type": [
    { code: `try {} catch (error: «unknown») {}`, output: `try {} catch (error) {}` },
    { code: `try {} catch (error : «unknown» ) {}`, output: `try {} catch (error ) {}` },
    { code: `try {} catch (error: «unknown») {} finally {}`, output: `try {} catch (error) {} finally {}` },
    { code: `try {} catch (error: /* always */ «unknown») {}`, output: `try {} catch (error) {}` },
    {
      code: `function f() {\n  try {\n    g();\n  } catch (error: «unknown») {\n    throw error;\n  }\n}`,
      output: `function f() {\n  try {\n    g();\n  } catch (error) {\n    throw error;\n  }\n}`,
    },

    `try {} catch (error) {}`,
    `try {} catch {}`,
    `try {} finally {}`,
    `try {} catch (error: any) {}`,
    `const error: unknown = 1;`,
    `function f(error: unknown) {}`,
    `promise.catch((error: unknown) => {});`,
  ],

  "no-useless-spread-fallback": [
    { code: `const a = { ...(b ? { c: 1 } : «{}») };`, suggestions: [`const a = { ...(b && { c: 1 }) };`] },
    { code: `const a = { ...(b ? c : «{}») };`, suggestions: [`const a = { ...(b && c) };`] },
    { code: `const a = { ...b ? { c } : «{}» };`, suggestions: [`const a = { ...b && { c } };`] },
    { code: `const a = { ...(b || c ? { d } : «{}») };`, suggestions: [`const a = { ...((b || c) && { d }) };`] },
    { code: `const a = { ...(b ?? c ? { d } : «{}») };`, suggestions: [`const a = { ...((b ?? c) && { d }) };`] },
    { code: `const a = { ...(b && c ? { d } : «{}») };`, suggestions: [`const a = { ...(b && c && { d }) };`] },
    { code: `const a = { ...(b === 1 ? { d } : «{}») };`, suggestions: [`const a = { ...(b === 1 && { d }) };`] },
    { code: `const a = { ...(!b ? { d } : «{}») };`, suggestions: [`const a = { ...(!b && { d }) };`] },
    { code: `const a = { ...(b() ? { d } : «{}») };`, suggestions: [`const a = { ...(b() && { d }) };`] },
    { code: `const a = { ...(await b ? { d } : «{}») };`, suggestions: [`const a = { ...(await b && { d }) };`] },
    {
      code: `const a = { ...(b as boolean ? { d } : «{}») };`,
      suggestions: [`const a = { ...((b as boolean) && { d }) };`],
    },
    { code: `const a = { ...(b ? c || d : «{}») };`, suggestions: [`const a = { ...(b && (c || d)) };`] },
    { code: `const a = { ...(b ? (c ? d : e) : «{}») };`, suggestions: [`const a = { ...(b && (c ? d : e)) };`] },
    { code: `const a = { ...(b ? {} : «{}») };`, suggestions: [`const a = { ...(b && {}) };`] },
    { code: `f({ a: 1, ...(b ? { c } : «{}»), d: 2 });`, suggestions: [`f({ a: 1, ...(b && { c }), d: 2 });`] },
    { code: `const a = <A {...(b ? { c: 1 } : «{}»)} />;`, suggestions: [`const a = <A {...(b && { c: 1 })} />;`] },
    { code: `const a = { ...(b ? «{}» : { c: 1 }) };`, suggestions: [] },
    {
      code: `const a = { ...(other("A") ? { c } : «{}») };`,
      options: [{ ignoreConditionsThatCall: ["feature"] }],
      suggestions: [`const a = { ...(other("A") && { c }) };`],
    },
    {
      code: `const a = { ...(b.feature("A") ? { c } : «{}») };`,
      options: [{ ignoreConditionsThatCall: ["feature"] }],
      suggestions: [`const a = { ...(b.feature("A") && { c }) };`],
    },
    {
      code: `const a = { ...(b ? { c: feature("A") } : «{}») };`,
      options: [{ ignoreConditionsThatCall: ["feature"] }],
      suggestions: [`const a = { ...(b && { c: feature("A") }) };`],
    },

    { code: `const a = { ...(feature("A") ? { c } : {}) };`, options: [{ ignoreConditionsThatCall: ["feature"] }] },
    {
      code: `const a = { ...(b && !feature("A") ? { c } : {}) };`,
      options: [{ ignoreConditionsThatCall: ["feature"] }],
    },
    `const a = { ...(b && { c }) };`,
    `const a = { ...(b ? { c } : null) };`,
    `const a = { ...(b ? { c } : undefined) };`,
    `const a = { ...(b ? { c } : { d }) };`,
    `const a = { ...(b ? { c } : d) };`,
    `const a = { ...(b ? c : d ? e : {}) };`,
    `const a = { ...(b || {}) };`,
    `const a = b ? { c } : {};`,
    `const a = { b: c ? { d } : {} };`,
    `const a = [...(b ? [c] : [])];`,
    `f(...(b ? [c] : []));`,
    `const a = { ...(b ? [c] : []) };`,
  ],

  "no-array-just-to-count": [
    `const a = «b.split(",").length»;`,
    `const a = «b.split(',').length»;`,
    "const a = «b.split(`,`).length»;",
    `const a = «b.split("\\n").length»;`,
    `const a = «b.split("é").length»;`,
    `const a = «b.split("😀").length»;`,
    `const a = «b.split(",").length - 1»;`,
    `const a = «b.split(",").length» - 2;`,
    `const a = 1 - «b.split(",").length»;`,
    `const a = «b["split"](",").length»;`,
    `const a = «b?.split(",").length»;`,
    `const a = «b.split(",")?.length»;`,
    `const a = «b().trim().split(" ").length»;`,
    `if («b.split("\\t").length» > 3) {}`,
    // The function is not in scope, or the result can be `undefined`.
    { code: `const a = «b.split(",").length»;`, options: countFunction },
    { code: `${count}const a = «b?.split(",").length»;`, options: countFunction },
    { code: `${count}const a = «(b, c).split(",").length»;`, options: countFunction },
    ...[
      [`const a = «b.split(",").length»;`, `const a = count(b, ",") + 1;`],
      [`const a = «b.split(",").length - 1»;`, `const a = count(b, ",");`],
      [`const a = («b.split(",").length») - 1;`, `const a = (count(b, ",") + 1) - 1;`],
      [`const a = «b.split(",").length» * 2;`, `const a = (count(b, ",") + 1) * 2;`],
      [`const a = «b.split(",").length» + 2;`, `const a = (count(b, ",") + 1) + 2;`],
      [`const a = "c" + «b.split(",").length»;`, `const a = "c" + (count(b, ",") + 1);`],
      [`const a = -«b.split(",").length»;`, `const a = -(count(b, ",") + 1);`],
      [`const a = «b.split(",").length» > 2;`, `const a = count(b, ",") + 1 > 2;`],
      [`const a = «b.split(",").length» || 1;`, `const a = count(b, ",") + 1 || 1;`],
      [`const a = «b.split(",").length» ? 1 : 2;`, `const a = count(b, ",") + 1 ? 1 : 2;`],
      [`const a = «b.split(",").length».toString();`, `const a = (count(b, ",") + 1).toString();`],
      [`const a = «b.split(",").length» as number;`, `const a = (count(b, ",") + 1) as number;`],
      [`const a = c[«b.split(",").length»];`, `const a = c[count(b, ",") + 1];`],
      [`const a = [«b.split(",").length»];`, `const a = [count(b, ",") + 1];`],
      [`const a = { c: «b.split(",").length» };`, `const a = { c: count(b, ",") + 1 };`],
      [`const a = () => «b.split(",").length»;`, `const a = () => count(b, ",") + 1;`],
      [`f(«b.split(",").length»);`, `f(count(b, ",") + 1);`],
      ['const a = `${«b.split(",").length»}`;', 'const a = `${count(b, ",") + 1}`;'],
      [`const a = «(b + c).split(",").length»;`, `const a = count(b + c, ",") + 1;`],
      [`const a = «b.c().split('\\n').length»;`, `const a = count(b.c(), '\\n') + 1;`],
    ].map(([code, output]) => ({ code: count + code, options: countFunction, output: count + output })),

    `const a = b.split(",");`,
    `const a = b.split(", ").length;`,
    `const a = b.split("").length;`,
    `const a = b.split(/,/).length;`,
    `const a = b.split(c).length;`,
    "const a = b.split(`${c}`).length;",
    `const a = b.split(",", 2).length;`,
    `const a = b.split().length;`,
    `const a = b.split(",").map(f).length;`,
    `const a = b.split(",")[0].length;`,
    `const a = b.split(",").size;`,
    `const a = split(",").length;`,
    `const a = b.splits(",").length;`,
  ],

  "prefer-builtin-sleep": [
    ...[
      [`await «new Promise(done => setTimeout(done, 250))»;`, `await Bun.sleep(250);`],
      [`await «new Promise((done) => { setTimeout(done, ms); })»;`, `await Bun.sleep(ms);`],
      [`await «new Promise(done => { return setTimeout(done, ms); })»;`, `await Bun.sleep(ms);`],
      [`await «new Promise(function (done) { setTimeout(done, ms); })»;`, `await Bun.sleep(ms);`],
      [`await «new Promise(done => setTimeout(() => done(), ms))»;`, `await Bun.sleep(ms);`],
      [`await «new Promise(done => setTimeout(() => { done(); }, ms))»;`, `await Bun.sleep(ms);`],
      [`await «new Promise(done => setTimeout(function () { done(); }, ms))»;`, `await Bun.sleep(ms);`],
      [`await «new Promise<void>(done => setTimeout(done, ms))»;`, `await Bun.sleep(ms);`],
      [`await «new Promise((done: () => void) => setTimeout(done, ms))»;`, `await Bun.sleep(ms);`],
      [`await «new Promise((done, fail) => setTimeout(done, ms))»;`, `await Bun.sleep(ms);`],
      [`await «new Promise(done => setTimeout(done))»;`, `await Bun.sleep(0);`],
      [`await «new Promise(done => setTimeout(done, a + b))»;`, `await Bun.sleep(a + b);`],
      [`await «new Promise(done => setTimeout(done, (a, b)))»;`, `await Bun.sleep((a, b));`],
      [
        `const wait = (ms: number) => «new Promise(done => setTimeout(done, ms))»;`,
        `const wait = (ms: number) => Bun.sleep(ms);`,
      ],
    ].map(([code, suggestion]) => ({ code, suggestions: [suggestion] })),

    `await Bun.sleep(250);`,
    `await new Promise(done => setTimeout(done, ms, value));`,
    `await new Promise(done => setTimeout(done, ...rest));`,
    `await new Promise(done => setTimeout(() => done(value), ms));`,
    `await new Promise(done => setTimeout(() => done?.(), ms));`,
    `await new Promise(done => setTimeout(async () => done(), ms));`,
    `await new Promise(done => setTimeout(a => done(), ms));`,
    `await new Promise(done => setTimeout(() => { log(); done(); }, ms));`,
    `await new Promise(done => setTimeout(other, ms));`,
    `await new Promise((done, fail) => setTimeout(fail, ms));`,
    `await new Promise(done => { setTimeout(done, ms); log(); });`,
    `await new Promise(done => { timer = setTimeout(done, ms); });`,
    `await new Promise(done => setInterval(done, ms));`,
    `await new Promise(done => setImmediate(done));`,
    `await new Promise(done => window.setTimeout(done, ms));`,
    `await new Promise(async done => setTimeout(done, ms));`,
    `await new Promise(({ done }) => setTimeout(done, ms));`,
    `await new Promise((done = other) => setTimeout(done, ms));`,
    `await new Promise((...done) => setTimeout(done, ms));`,
    `await new Promise(() => setTimeout(done, ms));`,
    `await new Promise(done => setTimeout(done, ms), other);`,
    `await new Promise(executor);`,
    `await new Other(done => setTimeout(done, ms));`,
    `await Promise(done => setTimeout(done, ms));`,
    `const setTimeout = fake;\nawait new Promise(done => setTimeout(done, ms));`,
    `class Promise {}\nawait new Promise(done => setTimeout(done, ms));`,
  ],

  "react-prefer-updater-function": [
    `${rowsState}setRows([...«rows», row]);`,
    `${rowsState}setRows([row, ...«rows»]);`,
    `${rowsState}setRows([...«rows»]);`,
    `${rowsState}setRows([...other, ...«rows»]);`,
    `const [form, setForm] = useState({});\nsetForm({ ...«form», name });`,
    `const [form, setForm] = useState({});\nsetForm({ name, ...«form» });`,
    `const [rows, setRows] = React.useState([]);\nsetRows([...«rows», row]);`,
    `const [rows, setRows] = useState<number[]>([]);\nsetRows([...«rows», 1]);`,
    `const [list, update] = useState([]);\nupdate([...«list», 1]);`,
    `function A() {\n  ${rowsState}  return <button onClick={() => setRows([...«rows», 1])} />;\n}`,
    `function A() {\n  ${rowsState}  useEffect(() => {\n    setRows([...«rows», 1]);\n  }, []);\n}`,
    // Where they are not from a `useState()` in the file, the names decide.
    `function A({ rows, setRows }) {\n  setRows([...«rows», 1]);\n}`,
    `function A({ form, setForm }) {\n  setForm({ ...«form», name });\n}`,
    `setRows([...«rows», 1]);`,

    `${rowsState}setRows(previous => [...previous, row]);`,
    `${rowsState}setRows([...other, row]);`,
    `${rowsState}setRows([row]);`,
    `${rowsState}setRows(rows);`,
    `${rowsState}setRows(rows.concat(row));`,
    `${rowsState}setRows([...rows.filter(keep)]);`,
    `${rowsState}setRows([rows]);`,
    `${rowsState}setRows({ rows });`,
    `${rowsState}setRows([...rows], other);`,
    `${rowsState}new setRows([...rows]);`,
    `${rowsState}props.setRows([...rows]);`,
    `${rowsState}const [other, setOther] = useState([]);\nsetOther([...rows]);`,
    `${rowsState}function f(rows) {\n  setRows([...rows]);\n}`,
    `${rowsState}function f(setRows) {\n  setRows([...rows]);\n}`,
    `setRows([...row]);`,
    `setrows([...rows]);`,
    `set([...rows]);`,
    `resetRows([...rows]);`,
  ],

  "no-console-window-flash": [
    ...[
      `«spawn»("a");`,
      `«spawn»("a", ["b"]);`,
      `«spawn»("a", ["b"], {});`,
      `«spawn»("a", { cwd });`,
      `«spawn»("a", [], { stdio: "pipe" });`,
      `«spawn»("a", [], { stdio: ["ignore", "pipe"] });`,
      `«spawnSync»("a");`,
      `«exec»("a");`,
      `«exec»("a", () => {});`,
      `«exec»("a", {}, () => {});`,
      `«execSync»("a");`,
      `«execFile»("a", ["b"], () => {});`,
      `«execFileSync»("a");`,
    ].map(it => fromChildProcess + it),
    `import * as cp from "child_process";\n«cp.spawn»("a");`,
    `import cp from "node:child_process";\n«cp.spawn»("a");`,
    `import { spawn as start } from "node:child_process";\n«start»("a");`,
    `const { spawn } = require("child_process");\n«spawn»("a");`,
    `const cp = require("node:child_process");\n«cp.exec»("a");`,
    `«Bun.spawn»(["a"]);`,
    `«Bun.spawn»(["a"], {});`,
    `«Bun.spawn»({ cmd: ["a"] });`,
    `«Bun.spawnSync»(["a"], { stdout: "pipe" });`,

    ...[
      `spawn("a", [], { windowsHide: true });`,
      `spawn("a", [], { windowsHide: false });`,
      `spawn("a", [], { windowsHide });`,
      `spawn("a", { windowsHide: true });`,
      `exec("a", { windowsHide: true }, () => {});`,
      `spawn("a", [], { stdio: "inherit" });`,
      `spawn("a", [], { stdio: ["ignore", "inherit"] });`,
      `spawn("a", [], options);`,
      `spawn("a", options);`,
      `spawn("a", [], { ...options });`,
      `spawn("a", ...rest);`,
      `exec("a", callback);`,
    ].map(it => fromChildProcess + it),
    `Bun.spawn(["a"], { windowsHide: true });`,
    `Bun.spawn({ cmd: ["a"], windowsHide: true });`,
    `Bun.spawn(["a"], { stdout: "inherit" });`,
    `Bun.spawn(options);`,
    `Bun.spawn(["a"], options);`,
    `const Bun = {};\nBun.spawn(["a"]);`,
    `spawn("a");`,
    `import { spawn } from "./spawn";\nspawn("a");`,
    `import { fork } from "node:child_process";\nfork("a");`,
  ],

  "no-unportable-commands": [
    { code: `${fromChildProcess}spawn(«"npm"», ["install"]);`, ids: ["needsShell"] },
    { code: `${fromChildProcess}spawn(«"ls"», ["-l"]);`, ids: ["posixOnly"] },
    { code: `${fromChildProcess}exec(«"a && b"»);`, ids: ["shellSyntax"] },
    { code: `const a = «"ps -ef"»;`, ids: ["psOptions"] },
    ...[
      `spawnSync(«"npx"», ["a"]);`,
      `execFile(«"yarn"», []);`,
      `execFileSync(«"pnpm"»);`,
      `spawn(«"npm"», [], { shell: false });`,
      `spawn(«"/bin/ls"»);`,
      `spawn(«"ls"», [], { shell: true });`,
      `spawn(«"ls"», [], options);`,
      `spawn(«"ps"», ["-ef"]);`,
      `exec(«"ls -l"»);`,
      `exec(«"cat"»);`,
      `exec(«"ps -ef"»);`,
      `execSync(«"rm -rf a"»);`,
      "exec(«`grep ${pattern} a`»);",
      `exec(«"a | b"»);`,
      `exec(«"a; b"»);`,
      `exec(«"a > b"»);`,
      `exec(«"a $(b)"»);`,
      `spawn(«"a | b"», { shell: true });`,
    ].map(it => fromChildProcess + it),
    `Bun.spawn([«"npm"», "install"]);`,
    `Bun.spawn({ cmd: [«"npx"», "a"] });`,
    `Bun.spawnSync([«"cat"», "a"]);`,
    `const a = «"ps aux"»;`,
    `const a = «"/bin/ps -ef"»;`,
    `const a = «"a | ps ax"»;`,
    `run(«"ps -o pid= -p 1"»);`,
    "const a = «`ps -p ${pid}`»;",
    "const a = «`${prefix} ps -ef`»;",
    { code: `start(«"ls"»);`, options: [{ launchers: ["start"] }] },
    { code: `a.start(«"npm"»);`, options: [{ launchers: ["start"] }] },
    { code: `${fromChildProcess}spawn(«"tsc"»);`, options: [{ scripts: ["tsc"] }] },
    { code: `${fromChildProcess}spawn(«"foo"»);`, options: [{ posixOnly: ["foo"] }] },

    ...[
      `spawn("node", ["a.js"]);`,
      `spawn("git", ["status"]);`,
      `spawn("npm.cmd");`,
      `spawn(process.execPath);`,
      `spawn(command);`,
      `spawn("npm", [], { shell: true });`,
      `spawn("npm", [], options);`,
      "spawn(`npm${suffix}`);",
      "exec(`ls${suffix}`);",
      `exec("npm install");`,
      `exec("echo a");`,
      `spawn("a | b");`,
    ].map(it => fromChildProcess + it),
    { code: `${fromChildProcess}spawn("ls");`, options: [{ posixOnly: [] }] },
    { code: `${fromChildProcess}spawn("npm");`, options: [{ scripts: [] }] },
    `spawn("ls");`,
    `start("ls");`,
    `regex.exec("ls -l");`,
    `Bun.spawn(["bun", "a.ts"]);`,
    `Bun.spawn(command);`,
    `const a = "ps";`,
    `const a = "ps is a tool";`,
    `const a = "steps -a";`,
    `const a = "https -a";`,
    `const a = "a.ps -a";`,
    `const a = <p>ps -ef</p>;`,
  ],

  "no-cwd-dependent-path": [
    ...[
      `fs.readFileSync(«"a.txt"»);`,
      `fs.readFileSync(«"./a.txt"»);`,
      `fs.readFileSync(«"../a.txt"»);`,
      `fs.readFileSync(«"a/b.txt"»);`,
      `fs.readFileSync(«"~/a.txt"»);`,
      "fs.readFileSync(«`a.txt`»);",
      "fs.readFileSync(«`./a/${name}`»);",
      `fs.readFile(«"a"», callback);`,
      `fs.promises.readFile(«"a"»);`,
      `fs.existsSync(«"a"»);`,
      `fs.createReadStream(«"a"»);`,
      `fs.renameSync(«"a"», «"b"»);`,
      `fs.copyFile(«"a"», "/b", callback);`,
      `fs.cpSync("/a", «"b"»);`,
      `fs.symlinkSync("a", «"b"»);`,
    ].map(it => fileSystem + it),
    `import * as fs from "fs";\nfs.statSync(«"a"»);`,
    `import { readFile } from "node:fs/promises";\nawait readFile(«"a"»);`,
    `import { readFileSync as read } from "fs";\nread(«"a"»);`,
    `const fs = require("fs");\nfs.statSync(«"a"»);`,
    `const { statSync } = require("node:fs");\nstatSync(«"a"»);`,
    `${path}path.resolve(«"a"»);`,
    `${path}path.resolve(«"a"», "b");`,
    `import { resolve } from "path";\nresolve(«"./a"»);`,
    `Bun.file(«"a.txt"»);`,
    `Bun.write(«"a.txt"», data);`,
    { code: `readJson(«"a.json"»);`, options: [{ functions: ["readJson"] }] },
    { code: `a.readJson(«"a.json"»);`, options: [{ functions: ["readJson"] }] },

    ...[
      `fs.readFileSync("/a.txt");`,
      `fs.readFileSync("C:\\\\a.txt");`,
      `fs.readFileSync("C:/a.txt");`,
      `fs.readFileSync("\\\\\\\\server\\\\a.txt");`,
      `fs.readFileSync("");`,
      `fs.readFileSync(name);`,
      `fs.readFileSync(import.meta.dirname + "/a.txt");`,
      `fs.readFileSync(new URL("./a.txt", import.meta.url));`,
      "fs.readFileSync(`${root}/a.txt`);",
      `fs.writeSync(fd, "a");`,
      `fs.globSync("a/*.txt");`,
      `fs.promises.glob("a/*.txt");`,
      `fs.symlinkSync("a", "/b");`,
      `fs.renameSync("/a", "/b");`,
      `fs.readFileSync("/a", "utf8");`,
    ].map(it => fileSystem + it),
    `${path}path.resolve(root, "a");`,
    `${path}path.resolve("/a", "b");`,
    `${path}path.resolve("a", root);`,
    `${path}path.resolve("a", "/b");`,
    `${path}path.resolve();`,
    `${path}path.join("a", "b");`,
    `Bun.file("/a.txt");`,
    `Bun.file(name);`,
    `Bun.write(Bun.stdout, "a");`,
    `const Bun = {};\nBun.file("a.txt");`,
    `readFileSync("a");`,
    `other.readFileSync("a");`,
    `import fs from "./fs";\nfs.readFileSync("a");`,
    `readJson("a.json");`,
  ],

  "prefer-lazy-schema": [
    ...[
      `const A = «z.string()»;`,
      `const A = «z.string().min(1).optional()»;`,
      `const A = «z.object({ a: z.string() })»;`,
      `const A = «z.object({ a: z.object({ b: z.string() }) }).strict()»;`,
      `export const A = «z.set(z.number())»;`,
      `const A = { a: «z.string()», b: «z.number()» };`,
      `const A = wrap(«z.string()»);`,
      `class A {\n  static schema = «z.string()»;\n}`,
      `(() => {\n  use(«z.string()»);\n})();`,
    ].map(it => zod + it),
    `import * as z from "zod";\nconst A = «z.string()»;`,
    `const A = «z.string()»;`,
    { code: `const A = «v.string()»;`, options: [{ roots: ["v"] }] },
    { code: `const A = «userSchema()»;`, options: [{ factorySuffix: "Schema" }] },
    { code: `const B = «A.extend({ b: 1 })»;`, options: [{ methods: ["extend"] }] },
    { code: `${zod}const A = «z.string()»;`, ids: ["eagerSchema"] },
    { code: `${zod}const A = «z.string()»;`, options: [{ lazyWrapper: "lazy" }], ids: ["eagerSchemaWithWrapper"] },

    ...[
      `const A = () => z.string();`,
      `function a() {\n  return z.object({});\n}`,
      `const A = lazy(() => z.object({ a: z.string() }));`,
      `const A = z.lazy(() => z.string());`,
      `class A {\n  schema = z.string();\n}`,
      `type A = z.infer<typeof B>;`,
      `const A = z;`,
      `const A = z.version;`,
      `const A = y.string();`,
      `function f(z) {\n  return z.string();\n}`,
    ].map(it => zod + it),
    `const z = {};\nconst A = z.string();`,
    { code: `const A = z.string();`, options: [{ roots: ["v"] }] },
    `const A = userSchema();`,
    `const B = A.extend({ b: 1 });`,
  ],

  "no-side-effects-on-import": [
    { code: `«start()»;`, ids: ["call"] },
    { code: `«a.b = 1»;`, ids: ["assignment"] },
    `«a.b()»;`,
    `«new A()»;`,
    `«import("a")»;`,
    "«tag`a`»;",
    `«(function () {})()»;`,
    `await «start()»;`,
    `void «start()»;`,
    `!«start()»;`,
    `flag && «start()»;`,
    `flag ? «a()» : b();`,
    `«a()», b();`,
    `a, «b()»;`,
    `x = «start()»;`,
    `«a["b"] = 1»;`,
    `«globalThis.a = 1»;`,
    `«A.prototype.b = function () {}»;`,
    `«a.b += 1»;`,
    `«delete a.b»;`,
    `«a.b++»;`,
    `if (flag) {\n  «start()»;\n}`,
    `for (const a of b) {\n  «use(a)»;\n}`,
    `try {\n  «start()»;\n} catch {}`,
    `namespace N {\n  «start()»;\n}`,
    `const module = {};\n«module.exports = 1»;`,
    { code: `«other()»;`, options: [{ allow: ["start"] }] },
    { code: `«a.start()»;`, options: [{ allow: ["start"] }] },
    { code: `«a.b.c()»;`, options: [{ allow: ["a.b"] }] },
    { code: `«describe("a", f)»;`, options: [{ allow: [] }] },
    { code: `«describe("a", f)»;`, options: [{ allow: ["start"] }] },

    { code: `start();`, options: [{ allow: ["start"] }] },
    { code: `console.log(1);`, options: [{ allow: ["console.log"] }] },
    { code: `console.log(1);`, options: [{ allow: ["console"] }] },
    `describe("a", () => {});`,
    `describe.skip("a", () => {});`,
    `test("a", () => {});`,
    `test.each([1])("a", () => {});`,
    `it.only("a", () => {});`,
    `suite("a", () => {});`,
    `before(() => {});\nafter(() => {});`,
    `beforeAll(() => {});\nafterAll(() => {});`,
    `beforeEach(() => {});\nafterEach(() => {});`,
    `expect.extend({});`,
    `vi.mock("a");`,
    `jest.mock("a");`,
    `mock.module("a", () => ({}));`,
    `const a = start();`,
    `export const a = start();`,
    `export default start();`,
    `function f() {\n  start();\n}`,
    `const f = () => {\n  start();\n};`,
    `class A {\n  m() {\n    start();\n  }\n}`,
    `class A {\n  static {\n    start();\n  }\n}`,
    `"use strict";`,
    `a;`,
    `let x;\nx = 1;`,
    `let x = 0;\nx++;`,
    `module.exports = a;`,
    `module.exports.a = a;`,
    `exports.a = a;`,
    `import "a";`,
  ],

  "no-unseeded-random-in-property-test": [
    { code: `${fastCheck}fc.property(fc.integer(), a => «fc.sample(fc.integer(), 1)»);`, ids: ["sample"] },
    { code: `${fastCheck}fc.property(fc.integer(), a => a > «Math.random()»);`, ids: ["random"] },
    `${fastCheck}fc.assert(\n  fc.property(fc.integer(), a => {\n    const [b] = «fc.sample(fc.integer(), 1)»;\n    return a + b === b + a;\n  }),\n);`,
    `${fastCheck}fc.asyncProperty(fc.nat(), async a => «fc.sample(fc.nat())»);`,
    `${fastCheck}fc.property(fc.nat(), function (a) {\n  return [1].map(() => «fc.sample(fc.integer())»);\n});`,
    `import * as fc from "fast-check";\nfc.property(fc.integer(), a => «fc.sample(fc.integer())»);`,
    `import { integer, property, sample } from "fast-check";\nproperty(integer(), a => «sample(integer())»);`,
    `import { integer, property, sample as draw } from "fast-check";\nproperty(integer(), a => «draw(integer())»);`,

    `${fastCheck}fc.sample(fc.integer(), 1);`,
    `${fastCheck}const values = fc.sample(fc.integer());\nfc.property(fc.integer(), a => values.includes(a));`,
    `${fastCheck}const a = Math.random();`,
    `${fastCheck}fc.property(make(() => fc.sample(fc.integer())), a => a);`,
    `${fastCheck}other.property(fc.integer(), a => fc.sample(fc.integer()));`,
    `${fastCheck}fc.property(fc.integer(), a => other.sample(a));`,
    `${fastCheck}fc.property(fc.integer(), a => fc.integer());`,
    `${fastCheck}const Math = {};\nfc.property(fc.integer(), a => Math.random());`,
    `import fc from "./fc";\nfc.property(fc.integer(), a => fc.sample(fc.integer()));`,
  ],

  "react-no-namespace-hooks": [
    ...[
      [`${react}«React.useState»(0);`, `import React, { useState } from "react";\nuseState(0);`],
      [`${react}«React.useState»<number>(0);`, `import React, { useState } from "react";\nuseState<number>(0);`],
      [`${react}«React.use»(promise);`, `import React, { use } from "react";\nuse(promise);`],
      [`import R from "react";\n«R.useId»();`, `import R, { useId } from "react";\nuseId();`],
      [
        `import * as React from "react";\n«React.useState»(0);`,
        `import * as React from "react";\nimport { useState } from "react";\nuseState(0);`,
      ],
      [
        `import * as React from 'react';\n«React.useId»();`,
        `import * as React from 'react';\nimport { useId } from 'react';\nuseId();`,
      ],
      [
        `import React, { useState } from "react";\n«React.useState»(0);`,
        `import React, { useState } from "react";\nuseState(0);`,
      ],
      [
        `import React, { useRef } from "react";\n«React.useState»(0);`,
        `import React, { useRef, useState } from "react";\nuseState(0);`,
      ],
      [
        `${react}import { useRef } from "react";\n«React.useState»(0);`,
        `${react}import { useRef, useState } from "react";\nuseState(0);`,
      ],
      [
        `import React, { useState as useS } from "react";\n«React.useState»(0);`,
        `import React, { useState as useS } from "react";\nuseS(0);`,
      ],
      // All that is missing is imported with the first fix. The others are for the next pass.
      [
        `${react}«React.useState»(0);\n«React.useEffect»(f);`,
        `import React, { useEffect, useState } from "react";\nuseState(0);\nReact.useEffect(f);`,
      ],
      [
        `import React, { useEffect, useState } from "react";\n«React.useState»(0);\n«React.useEffect»(f);`,
        `import React, { useEffect, useState } from "react";\nuseState(0);\nuseEffect(f);`,
      ],
    ].map(([code, output]) => ({ code, output })),
    `${react}const useState = 1;\n«React.useState»(0);`,
    `${react}function f(useState) {\n  «React.useState»(0);\n}`,
    `import React, { useState } from "react";\nfunction f(useState) {\n  «React.useState»(0);\n}`,
    `import React, {} from "react";\n«React.useState»(0);`,

    `import { useState } from "react";\nuseState(0);`,
    `${react}React.createElement("a");`,
    `${react}React.memo(A);`,
    `${react}React.user;`,
    `${react}type A = typeof React.useState;`,
    `${react}function f(React) {\n  React.useState(0);\n}`,
    `import type React from "react";\ntype A = typeof React.useState;`,
    `import React from "./react";\nReact.useState(0);`,
    `React.useState(0);`,
  ],

  "react-no-latest-value-ref": [
    { code: component(`  «saved.current = count»;`), ids: ["duringRender"] },
    { code: component(`  useEffect(() => {\n    «saved.current = count»;\n  });`), ids: ["inEffect"] },
    `function A({ count }) {\n  const saved = React.useRef(count);\n  «saved.current = count»;\n}`,
    `const A = ({ count }) => {\n  const saved = useRef(count);\n  «saved.current = count»;\n  return null;\n};`,
    `function useCurrent(count) {\n  const ref = useRef<number>(count);\n  «ref.current = count»;\n  return ref;\n}`,
    component(`  useEffect(() => {\n    «saved.current = count»;\n  }, [count]);`),
    component(`  useLayoutEffect(() => {\n    «saved.current = count»;\n  });`),
    component(`  useInsertionEffect(() => {\n    «saved.current = count»;\n  });`),
    component(`  React.useEffect(() => {\n    «saved.current = count»;\n  });`),
    component(`  useEffect(function () {\n    «saved.current = count»;\n  });`),
    component(`  useEffect(() => («saved.current = count»));`),
    component(
      `  const other = useRef(0);\n  useEffect(() => {\n    «saved.current = count»;\n    «other.current = 1»;\n  });`,
    ),

    component(`  if (saved.current === null) {\n    saved.current = create();\n  }`),
    component(`  const onClick = () => {\n    saved.current = count;\n  };`),
    component(`  useEffect(() => {\n    saved.current = count;\n    subscribe();\n  });`),
    component(`  useEffect(() => {\n    saved.current = count;\n    return () => {};\n  });`),
    component(`  useEffect(() => {\n    if (count) {\n      saved.current = count;\n    }\n  });`),
    component(`  useEffect(() => {});`),
    component(`  useOther(() => {\n    saved.current = count;\n  });`),
    component(`  saved.current += 1;`),
    component(`  saved.other = count;`),
    component(`  use(saved.current);`),
    `function A({ count }) {\n  const saved = { current: count };\n  saved.current = count;\n}`,
    `function A({ saved, count }) {\n  saved.current = count;\n}`,
    `const saved = createRef();\nfunction A({ count }) {\n  useRef();\n  saved.current = count;\n}`,
  ],

  "jsx-no-forbidden-nesting": [
    `const x = <a><«a» /></a>;`,
    `const x = <a><span><«a» href="b" /></span></a>;`,
    `const x = <a><«a»>b</a></a>;`,
    `const x = <a><«button» /></a>;`,
    `const x = <button><«a» /></button>;`,
    `const x = <button><«button» /></button>;`,
    `const x = <form><div><«form» /></div></form>;`,
    `const x = <label><«label» /></label>;`,
    `const x = <a>{items.map(it => <«a» key={it} />)}</a>;`,
    `const x = <a>{flag && <«a» />}</a>;`,
    `const x = <a title={<«a» />} />;`,
    `const x = <a><«a»><«a» /></a></a>;`,
    `const x = <a><«button»><«button» /></button></a>;`,
    { code: `const x = <Text><«View» /></Text>;`, options: inText },
    { code: `const x = <A.B><«C.D» /></A.B>;`, options: [{ pairs: [{ outer: "A.B", inner: "C.D" }] }] },

    `const x = <a><b /></a>;`,
    `const x = <div><a /><a /></div>;`,
    `const x = <><a /><a /></>;`,
    `const x = <A><a /></A>;`,
    `const x = <a><A /></a>;`,
    `const x = <form><input /></form>;`,
    `const x = [<a />, <a />];`,
    { code: `const x = <a><a /></a>;`, options: [{ pairs: [] }] },
    { code: `const x = <a><a /></a>;`, options: inText },
    { code: `const x = <View><Text /></View>;`, options: inText },
  ],

  "consistent-directive-prefix": [
    ...[
      [`// «oxlint»-disable-next-line no-debugger\ndebugger;`, `// eslint-disable-next-line no-debugger\ndebugger;`],
      [`debugger; // «oxlint»-disable-line no-debugger`, `debugger; // eslint-disable-line no-debugger`],
      [`debugger; // «oxlint»-disable-line`, `debugger; // eslint-disable-line`],
      [`debugger; //«oxlint»-disable-line a`, `debugger; //eslint-disable-line a`],
      [`/* «oxlint»-disable a */`, `/* eslint-disable a */`],
      [`/*   «oxlint»-disable a, b */\n/* «oxlint»-enable a */`, `/*   eslint-disable a, b */\n/* eslint-enable a */`],
      [`/*\n «oxlint»-disable a\n*/`, `/*\n eslint-disable a\n*/`],
    ].map(([code, output]) => ({ code, output })),
    {
      code: `a; // «eslint»-disable-line no-undef`,
      options: [{ prefix: "oxlint" }],
      output: `a; // oxlint-disable-line no-undef`,
    },
    { code: `a; // «oxlint»-disable-line b`, options: [{ prefix: "eslint" }], output: `a; // eslint-disable-line b` },

    `a; // eslint-disable-line no-undef`,
    `/* eslint-disable no-undef */`,
    `// oxlint is a linter`,
    `// oxlint-disabled`,
    `// oxlint-config`,
    `// see oxlint-disable`,
    `const a = "oxlint-disable";`,
    { code: `a; // oxlint-disable-line b`, options: [{ prefix: "oxlint" }] },
    { code: `// eslint is a linter`, options: [{ prefix: "oxlint" }] },
  ],

  "no-restricted-text": [
    ...[
      `const a = "a «foo» b";`,
      `const a = '«foo»';`,
      `const a = "«foo» «foo»";`,
      "const a = `«foo» ${b} «foo»`;",
      "const a = tag`«foo»`;",
      `const a = <p>a «foo»</p>;`,
      `const a = <a b="«foo»" />;`,
      `// a «foo»`,
      `/* «foo» */`,
      `const a = /«foo»/;`,
      `import a from "«foo»";`,
      `const a = { "«foo»": 1 };`,
      `type A = "«foo»";`,
    ].map(code => ({ code, options: foo, ids: Array(code.split("«").length - 1).fill("restricted") })),
    { code: `const a = "«FOO»";`, options: [{ patterns: [{ pattern: "foo", flags: "i" }] }] },
    { code: `const a = "«foo» food";`, options: [{ patterns: [{ pattern: "\\bfoo\\b" }] }] },
    { code: `const a = "«foo» «bar»";`, options: [{ patterns: [{ pattern: "foo" }, { pattern: "bar" }] }] },
    {
      code: `const a = "«foo»";`,
      options: [{ patterns: [{ pattern: "foo", message: "No." }] }],
      ids: ["restrictedWithMessage"],
    },
    { code: `const a = "foo"; // «foo»`, options: [{ patterns: [{ pattern: "foo", in: ["comments"] }] }] },
    { code: 'const a = `foo` + "«foo»";', options: [{ patterns: [{ pattern: "foo", in: ["strings"] }] }] },
    { code: `const a = <p title="foo">«foo»</p>;`, options: [{ patterns: [{ pattern: "foo", in: ["jsxText"] }] }] },
    {
      code: `const a = "foo".match(/«foo»/);`,
      options: [{ patterns: [{ pattern: "foo", in: ["regularExpressions"] }] }],
    },
    { code: 'const a = "foo" + `«foo»`;', options: [{ patterns: [{ pattern: "foo", in: ["templates"] }] }] },

    ...[
      `const foo = 1;`,
      `foo();`,
      `const a = "bar";`,
      "const a = `${foo}`;",
      `const a = <foo />;`,
      `const a = "fo" + "o";`,
    ].map(code => ({ code, options: foo })),
    { code: `const a = "foo";`, options: [{ patterns: [] }] },
    { code: `const a = "foo";`, options: [{ patterns: [{ pattern: "foo", in: [] }] }] },
    { code: `const a = "foo";`, options: [{ patterns: [{ pattern: "" }] }] },
    `const a = "foo";`,
  ],

  "prefer-timeout-signal": [
    `const controller = «new AbortController()»;\nsetTimeout(() => controller.abort(), 2000);\nawait fetch(address, { signal: controller.signal });`,
    `const controller = «new AbortController()»;\nsetTimeout(() => {\n  controller.abort();\n}, ms);\nuse(controller.signal);`,
    `const controller = «new AbortController()»;\nsetTimeout(function () {\n  controller.abort();\n}, ms);\nuse(controller.signal);`,
    `const controller = «new AbortController()»;\nconst timer = setTimeout(() => controller.abort(), ms);\nuse(controller.signal);\nclearTimeout(timer);`,
    `const c = «new AbortController()»;\nsetTimeout(() => c.abort(), ms);\nuse(c.signal, c.signal);`,
    `function f() {\n  const c = «new AbortController()»;\n  setTimeout(() => c.abort(), ms);\n  return c.signal;\n}`,
    `let c = «new AbortController()»;\nsetTimeout(() => c.abort(), ms);\nuse(c.signal);`,
    {
      code: `const c = «makeController()»;\nsetTimeout(() => c.abort(), ms);\nuse(c.signal);`,
      options: [{ factories: ["makeController"] }],
    },

    `const signal = AbortSignal.timeout(ms);`,
    `const c = new AbortController();\nuse(c.signal);`,
    `const c = new AbortController();\nsetTimeout(() => c.abort(), ms);`,
    `const c = new AbortController();\nsetTimeout(() => c.abort(), ms);\nuse(c);`,
    `const c = new AbortController();\nsetTimeout(() => c.abort(), ms);\nuse(c.signal);\nbutton.onclick = () => c.abort();`,
    `const c = new AbortController();\nsetTimeout(() => c.abort(), ms);\nsetTimeout(() => c.abort(), other);\nuse(c.signal);`,
    `const c = new AbortController();\nsetTimeout(() => c.abort(reason), ms);\nuse(c.signal);`,
    `const c = new AbortController();\nsetTimeout(() => {\n  log();\n  c.abort();\n}, ms);\nuse(c.signal);`,
    `const c = new AbortController();\nsetTimeout(a => c.abort(), ms);\nuse(c.signal);`,
    `const c = new AbortController();\nsetInterval(() => c.abort(), ms);\nuse(c.signal);`,
    `const c = new AbortController();\nlater(() => c.abort(), ms);\nuse(c.signal);`,
    `const c = new AbortController();\nsetTimeout(ms, () => c.abort());\nuse(c.signal);`,
    `const c = new AbortController();\nc.abort();\nsetTimeout(f, ms);\nuse(c.signal);`,
    `const { signal, abort } = new AbortController();\nsetTimeout(() => abort(), ms);\nuse(signal);`,
    `const setTimeout = fake;\nconst c = new AbortController();\nsetTimeout(() => c.abort(), ms);\nuse(c.signal);`,
    `class AbortController {}\nconst c = new AbortController();\nsetTimeout(() => c.abort(), ms);\nuse(c.signal);`,
    `const c = makeController();\nsetTimeout(() => c.abort(), ms);\nuse(c.signal);`,
  ],

  "prefer-url-for-sibling-files": [
    ...[
      `const a = «join(import.meta.dirname, "a.txt")»;`,
      `const a = «join(import.meta.dir, "a.txt")»;`,
      `const a = «join(__dirname, "a.txt")»;`,
      `const a = «join(__dirname, "..", "a", "b.txt")»;`,
      `const a = «resolve(import.meta.dirname, "./a.txt")»;`,
      "const a = «join(import.meta.dirname, `a.txt`)»;",
      `const a = «join(dirname(fileURLToPath(import.meta.url)), "a.txt")»;`,
      `const a = «join(dirname(import.meta.filename), "a.txt")»;`,
      `const a = «join(dirname(import.meta.path), "a.txt")»;`,
      `const a = «join(dirname(__filename), "a.txt")»;`,
      `const folder = import.meta.dirname;\nconst a = «join(folder, "a.txt")»;`,
      `const folder = dirname(fileURLToPath(import.meta.url));\nconst a = «join(folder, "a.txt")»;`,
    ].map(it => joinFrom + it),
    `import path from "node:path";\nconst a = «path.join(import.meta.dirname, "a.txt")»;`,
    `import * as path from "path";\nconst a = «path.resolve(path.dirname(import.meta.filename), "a.txt")»;`,
    "const a = «`${import.meta.dirname}/a.txt`»;",
    "const a = «`${__dirname}/a/b.txt`»;",
    `const a = «import.meta.dirname + "/a.txt"»;`,
    `const a = «__dirname + "/a.txt"»;`,
    `const folder = import.meta.dir;\nconst a = «folder + "/a.txt"»;`,

    `const a = new URL("./a.txt", import.meta.url);`,
    ...[
      `const a = join(import.meta.dirname, name);`,
      `const a = join(import.meta.dirname, "a", name);`,
      `const a = join(import.meta.dirname);`,
      `const a = join(import.meta.dirname, "..");`,
      `const a = join(import.meta.dirname, "..", "..");`,
      `const a = join(import.meta.dirname, "../..");`,
      `const a = join(import.meta.dirname, ".");`,
      `const a = join(import.meta.dirname, "a/");`,
      `const a = join(import.meta.dirname, "");`,
      `const a = join(root, "a.txt");`,
      `const a = join("a", import.meta.dirname);`,
      `const a = join(process.cwd(), "a.txt");`,
      `const a = join(dirname(other), "a.txt");`,
      `const a = join(import.meta.url, "a.txt");`,
      `let folder = import.meta.dirname;\nconst a = join(folder, "a.txt");`,
      `const __dirname = "/a";\nconst a = join(__dirname, "a.txt");`,
    ].map(it => joinFrom + it),
    `const a = join(import.meta.dirname, "a.txt");`,
    `import { join } from "./path";\nconst a = join(import.meta.dirname, "a.txt");`,
    "const a = `${import.meta.dirname}/${name}`;",
    "const a = `${import.meta.dirname}a.txt`;",
    "const a = `a${import.meta.dirname}/a.txt`;",
    "const a = `${root}/a.txt`;",
    `const a = import.meta.dirname + name;`,
    `const a = import.meta.dirname + "a.txt";`,
    `const a = import.meta.dirname + "/..";`,
    `const a = import.meta.dirname + "/";`,
    "const a = `${import.meta.dirname}/../..`;",
    `const a = "/a.txt" + import.meta.dirname;`,
  ],

  "react-no-local-render-helpers": [
    insideTable(`  const «renderCell» = row => <tr key={row.id} />;\n  return <table>{rows.map(renderCell)}</table>;`),
    insideTable(`  const «renderHead» = () => <thead />;\n  return <table>{renderHead()}</table>;`),
    insideTable(`  function «renderHead»() {\n    return <thead />;\n  }\n  return <table>{renderHead()}</table>;`),
    insideTable(
      `  const «renderHead» = function () {\n    return <thead />;\n  };\n  return <table>{renderHead()}</table>;`,
    ),
    insideTable(`  const «renderCell» = row => <tr />;\n  return <table>{rows.map(row => renderCell(row))}</table>;`),
    insideTable(`  const «renderHead» = () => <thead />;\n  return <table head={renderHead()} />;`),
    `const Table = ({ rows }) => {\n  const «renderHead» = () => <thead />;\n  return <table>{renderHead()}</table>;\n};`,
    {
      code: insideTable(`  const «drawHead» = () => <thead />;\n  return <table>{drawHead()}</table>;`),
      options: [{ pattern: "^draw" }],
    },

    `const renderHead = () => <thead />;\nfunction Table() {\n  return <table>{renderHead()}</table>;\n}`,
    insideTable(`  const renderHead = () => <thead />;\n  const head = renderHead();\n  return <table>{head}</table>;`),
    insideTable(`  const renderHead = () => <thead />;\n  return <table head={renderHead} />;`),
    insideTable(`  const renderHead = () => <thead />;\n  return <table />;`),
    insideTable(`  const makeHead = () => <thead />;\n  return <table>{makeHead()}</table>;`),
    insideTable(`  const rendering = () => <thead />;\n  return <table>{rendering()}</table>;`),
    insideTable(`  const render = () => <thead />;\n  return <table>{render()}</table>;`),
    insideTable(`  const renderHead = <thead />;\n  return <table>{renderHead}</table>;`),
    `function Table({ renderHead }) {\n  return <table>{renderHead()}</table>;\n}`,
    {
      code: insideTable(`  const renderHead = () => <thead />;\n  return <table>{renderHead()}</table>;`),
      options: [{ pattern: "^draw" }],
    },
  ],

  "prefer-local-module": [
    ...[
      [`import axios from «"axios"»;`, `import axios from "@/http";`],
      [`import axios from «'axios'»;`, `import axios from '@/http';`],
      [`import { isCancel } from «"axios"»;`, `import { isCancel } from "@/http";`],
      [`import * as axios from «"axios"»;`, `import * as axios from "@/http";`],
      [`import type { Reply } from «"axios"»;`, `import type { Reply } from "@/http";`],
      [`import «"axios"»;`, `import "@/http";`],
      [`export { isCancel } from «"axios"»;`, `export { isCancel } from "@/http";`],
      [`export * from «"axios"»;`, `export * from "@/http";`],
      [`const axios = require(«"axios"»);`, `const axios = require("@/http");`],
      [`const axios = await import(«"axios"»);`, `const axios = await import("@/http");`],
    ].map(([code, output]) => ({ code, options: http, output })),
    ...[
      [`import axios from «"axios"»;`, `import { http as axios } from "@/http";`],
      [`import http from «"axios"»;`, `import { http } from "@/http";`],
      [`import { isCancel } from «"axios"»;`, `import { wasCancelled as isCancel } from "@/http";`],
      [`import { isCancel as wasCancelled } from «"axios"»;`, `import { wasCancelled } from "@/http";`],
      [`import { isCancel as a, other } from «"axios"»;`, `import { wasCancelled as a, other } from "@/http";`],
      [
        `import axios, { isCancel, type Other } from «"axios"»;`,
        `import { http as axios, wasCancelled as isCancel, type Other } from "@/http";`,
      ],
      [`import «"axios"»;`, `import "@/http";`],
    ].map(([code, output]) => ({ code, options: mapped, output })),
    {
      code: `import axios, { isCancel } from «"axios"»;`,
      options: [{ modules: [{ package: "axios", use: "@/http", names: { isCancel: "wasCancelled" } }] }],
      output: `import axios, { wasCancelled as isCancel } from "@/http";`,
    },
    {
      code: `import axios from «"axios"»;`,
      options: [{ modules: [{ package: "axios", use: "@/http", names: { isCancel: "wasCancelled" } }] }],
      output: `import axios from "@/http";`,
    },
    // What cannot be written anew is only reported.
    { code: `import * as axios from «"axios"»;`, options: mapped },
    { code: `import type { Reply } from «"axios"»;`, options: mapped },
    { code: `export { isCancel } from «"axios"»;`, options: mapped },
    { code: `const axios = require(«"axios"»);`, options: mapped },
    {
      code: `import axios from «"axios"»;`,
      options: [{ ...http[0], exemptFiles: ["other.tsx"] }],
      output: `import axios from "@/http";`,
    },

    { code: `import http from "@/http";`, options: http },
    { code: `import axios from "axios/lib";`, options: http },
    { code: `import axios from "./axios";`, options: http },
    { code: `const axios = require(name);`, options: http },
    { code: `const axios = load("axios");`, options: http },
    { code: `const a = "axios";`, options: http },
    { code: `import axios from "axios";`, options: [{ modules: [] }] },
    `import axios from "axios";`,
  ],

  "no-unbounded-requests": [
    `${axios}«axios.get»("/a");`,
    `${axios}await «axios.get»("/a");`,
    `${axios}«axios.get»("/a", {});`,
    `${axios}«axios.get»("/a", { params: { page: 2 } });`,
    `${axios}«axios.delete»("/a");`,
    `${axios}«axios.head»("/a");`,
    `${axios}«axios.options»("/a");`,
    `${axios}«axios.post»("/a");`,
    `${axios}«axios.post»("/a", body);`,
    `${axios}«axios.post»("/a", body, { headers });`,
    // The second argument of `post()` is what is sent.
    `${axios}«axios.post»("/a", { timeout: 3000 });`,
    `${axios}«axios.put»("/a", body);`,
    `${axios}«axios.patch»("/a", body);`,
    `${axios}«axios.postForm»("/a", body);`,
    `${axios}«axios.putForm»("/a", body);`,
    `${axios}«axios.patchForm»("/a", body);`,
    `${axios}«axios.request»({ url: "/a" });`,
    `${axios}«axios»("/a");`,
    `${axios}«axios»(\`/a/\${id}\`);`,
    `${axios}«axios»("/a", { method: "post" });`,
    `${axios}«axios»({ url: "/a" });`,
    `${axios}«axios»(address, { method: "post" });`,
    `${axios}const api = «axios.create»();`,
    `${axios}const api = «axios.create»({ baseURL: "https://example.com" });`,
    `${axios}«axios.get»<Row[]>("/a");`,
    `${axios}«axios.get»("/a", { params } as const);`,
    `${axios}«axios.get»("/a", { params } satisfies Config);`,
    `${axios}«axios.get»("/a", { "time-out": 3000 });`,
    `${axios}const { get } = axios;\n«get»("/a");`,
    `${axios}const client = axios;\n«client.get»("/a");`,
    `import * as axios from "axios";\n«axios.get»("/a");`,
    `import client from "axios";\n«client.get»("/a");`,
    `import { default as client } from "axios";\n«client.get»("/a");`,
    `const axios = require("axios");\n«axios.get»("/a");`,
    `const { get } = require("axios");\n«get»("/a");`,
    `«require("axios").get»("/a");`,
    `${axios}function load() {\n  return «axios.get»("/a");\n}`,
    `${axios}«axios.get»("/a");\n«axios.get»("/b");`,
    { code: `${axios}axios.get("/a", { timeout: «0» });`, ids: ["noLimit"] },
    { code: `${axios}axios.get("/a", { timeout: «Infinity» });`, ids: ["noLimit"] },
    { code: `${axios}axios.get("/a", { timeout: «1e999» });`, ids: ["noLimit"] },
    { code: `${axios}axios.get("/a", { "timeout": «0» });`, ids: ["noLimit"] },
    { code: `${axios}axios.create({ timeout: «0» });`, ids: ["noLimit"] },
    { code: `${axios}axios({ url: "/a", timeout: «0» });`, ids: ["noLimit"] },
    { code: `import { http } from "./http";\n«http.get»("/a");`, options: ownClient },
    { code: `import { http } from "./http";\n«http»("/a");`, options: ownClient },
    { code: `import { http as client } from "./http";\n«client.post»("/a", body);`, options: ownClient },
    { code: `const { http } = require("./http");\n«http.get»("/a");`, options: ownClient },
    { code: `import http from "./http";\n«http.get»("/a");`, options: [{ clients: [{ module: "./http" }] }] },
    { code: `${axios}import { http } from "./http";\n«axios.get»("/a");\n«http.get»("/b");`, options: ownClient },

    `${axios}axios.get("/a", { timeout: 3000 });`,
    `${axios}axios.get("/a", { timeout: 0.5 });`,
    `${axios}axios.get("/a", { timeout });`,
    `${axios}axios.get("/a", { timeout: limit });`,
    `${axios}axios.get("/a", { timeout: seconds * 3000 });`,
    `${axios}axios.get("/a", { "timeout": 3000 });`,
    `${axios}axios.get("/a", { signal });`,
    `${axios}axios.get("/a", { signal: controller.signal });`,
    `${axios}axios.get("/a", { signal: AbortSignal.timeout(limit) });`,
    `${axios}axios.get("/a", { signal, timeout: 0 });`,
    `${axios}axios.get("/a", { cancelToken });`,
    `${axios}axios.post("/a", body, { timeout: 3000 });`,
    `${axios}axios.request({ url: "/a", timeout: 3000 });`,
    `${axios}axios({ url: "/a", timeout: 3000 });`,
    `${axios}axios("/a", { timeout: 3000 });`,
    `${axios}const api = axios.create({ timeout: 3000 });`,
    `${axios}function f(Infinity) {\n  axios.get("/a", { timeout: Infinity });\n}`,
    // What the configuration has is not to be seen.
    `${axios}axios.get("/a", config);`,
    `${axios}axios.get("/a", { ...config });`,
    `${axios}axios.get("/a", { params, ...config });`,
    `${axios}axios.get("/a", makeConfig());`,
    `${axios}axios.get(...parameters);`,
    `${axios}axios.get("/a", ...rest);`,
    `${axios}axios.request(config);`,
    `${axios}axios(config);`,
    `${axios}axios.create(config);`,
    // "Config Defaults"
    `${axios}axios.defaults.timeout = 3000;\naxios.get("/a");`,
    `${axios}const api = axios.create();\napi.defaults.timeout = 3000;`,
    // What takes no configuration, or makes no request.
    `${axios}axios.isAxiosError(error);`,
    `${axios}axios.isCancel(error);`,
    `${axios}axios.all([a, b]);`,
    `${axios}axios.interceptors.request.use(log);`,
    `${axios}new axios.Axios({});`,
    // Another `axios`.
    `axios.get("/a");`,
    `import axios from "./axios";\naxios.get("/a");`,
    `${axios}function f(axios) {\n  axios.get("/a");\n}`,
    `import type axios from "axios";`,
    `import { http } from "./http";\nhttp.get("/a");`,
    { code: `import { other } from "./http";\nother.get("/a");`, options: ownClient },
    { code: `import { http } from "./other";\nhttp.get("/a");`, options: ownClient },
    { code: `import { http } from "./http";\nhttp.get("/a", { timeout: 3000 });`, options: ownClient },
    // An instance: what it was made with is checked where it is made.
    `${axios}const api = axios.create({ timeout: 3000 });\napi.get("/a");`,
  ],

  "no-unhandled-emitter-errors": [
    // Nothing is done with it.
    `${processes}«spawn»("a");`,
    `${processes}«fork»("./a.js");`,
    `${files}«createReadStream»("a");`,
    `${files}«createWriteStream»("a");`,
    `${files}«watch»("a", listener);`,
    `import cluster from "node:cluster";\n«cluster.fork»();`,
    `import http from "node:http";\n«http.get»(address, use);`,
    `import http from "node:http";\n«http.request»(address, use).end();`,
    `import https from "node:https";\n«https.get»(address, use);`,
    `import { connect } from "node:http2";\n«connect»(address);`,
    `import net from "node:net";\n«net.connect»(80);`,
    `import net from "node:net";\n«net.createConnection»(80);`,
    `import tls from "node:tls";\n«tls.connect»(443);`,
    `import { spawn } from "child_process";\n«spawn»("a");`,
    `import fs from "fs";\n«fs.watch»("a");`,
    `import * as fs from "node:fs";\n«fs.createReadStream»("a");`,
    `import { spawn as start } from "node:child_process";\n«start»("a");`,
    `const { spawn } = require("node:child_process");\n«spawn»("a");`,
    `const fs = require("fs");\n«fs.createWriteStream»("a");`,
    `«require("node:net").connect»(80);`,
    // Other events, other methods, properties.
    `${processes}«spawn»("a").on("exit", done);`,
    `${processes}«spawn»("a").on("exit", done).once("spawn", go);`,
    `${processes}«spawn»("a").on(name, done);`,
    `${processes}«spawn»("a").on("errors", fail);`,
    `${processes}«spawn»("a").emit("error", problem);`,
    `${processes}«spawn»("a").off("error", fail);`,
    `${processes}«spawn»("a").unref();`,
    `${processes}«spawn»("a").stdout.on("data", use);`,
    `${processes}«spawn»("a").stdout.on("error", fail);`,
    `${processes}const id = «spawn»("a").pid;`,
    `${processes}const { stdout } = «spawn»("a");`,
    `${processes}«spawn»("a")!.on("exit", done);`,
    // The listener is on the other stream.
    `${files}«createReadStream»("a").pipe(target);`,
    `${files}«createReadStream»("a").pipe(target).on("error", fail);`,
    // A variable.
    `${processes}const child = «spawn»("a");`,
    `${processes}const child = «spawn»("a");\nchild.on("exit", done);`,
    `${processes}const child = «spawn»("a");\nchild.stdout.on("data", use);\nchild.kill();`,
    `${processes}const child = «spawn»("a").on("exit", done);\nchild.unref();`,
    `${processes}let child;\nchild = «spawn»("a");\nchild.on("exit", done);`,
    `${processes}const child = «spawn»("a") as ChildProcess;\nchild.on("exit", done);`,
    `${processes}const child = «spawn»("a");\nchild;`,
    `${processes}const child = «spawn»("a");\nfunction f(child) {\n  child.on("error", fail);\n}`,
    `${files}const source = «createReadStream»("a");\nsource.pipe(target);`,
    `${processes}function run() {\n  const child = «spawn»("a");\n  child.on("exit", done);\n}`,
    `${processes}«spawn»("a");\n«spawn»("b");`,
    { code: `import { observe } from "./observer";\n«observe»("a");`, options: observer },
    { code: `import observer from "./observer";\n«observer.observe»("a").on("change", use);`, options: observer },
    { code: `import open from "./open";\n«open»("a");`, options: [{ factories: [{ module: "./open" }] }] },

    `${processes}spawn("a").on("error", fail);`,
    `${processes}spawn("a").once("error", fail);`,
    `${processes}spawn("a").addListener("error", fail);`,
    `${processes}spawn("a").prependListener("error", fail);`,
    `${processes}spawn("a").prependOnceListener("error", fail);`,
    `${processes}spawn("a").on(\`error\`, fail);`,
    `${processes}spawn("a").on("exit", done).on("error", fail);`,
    `${processes}spawn("a").on("error", fail).on("exit", done);`,
    `${processes}spawn("a")!.on("error", fail);`,
    `${processes}(spawn("a") as ChildProcess).on("error", fail);`,
    `${processes}(spawn("a")).on("error", fail);`,
    `${files}createReadStream("a").setEncoding("utf8").on("error", fail);`,
    `${files}createReadStream("a").on("error", fail).pipe(target);`,
    `import http from "node:http";\nhttp.get(address, use).on("error", fail);`,
    `${processes}const child = spawn("a");\nchild.on("error", fail);`,
    `${processes}const child = spawn("a");\nchild.on("exit", done);\nchild.once("error", fail);`,
    `${processes}const child = spawn("a");\nchild.on("exit", done).on("error", fail);`,
    `${processes}const child = spawn("a").on("exit", done);\nchild.on("error", fail);`,
    `${processes}let child;\nchild = spawn("a");\nchild.on("error", fail);`,
    `${processes}const child = spawn("a");\nfunction watch() {\n  child.on("error", fail);\n}`,
    `${processes}const child = spawn("a") as ChildProcess;\nchild.on("error", fail);`,
    // It goes where it cannot be followed.
    `${processes}function run() {\n  return spawn("a");\n}`,
    `${processes}const run = () => spawn("a");`,
    `${processes}track(spawn("a"));`,
    `${processes}new Task(spawn("a"));`,
    `${processes}const all = [spawn("a")];`,
    `${processes}const task = { child: spawn("a") };`,
    `${processes}this.child = spawn("a");`,
    `${processes}class Task {\n  child = spawn("a");\n}`,
    `${processes}const child = flag ? spawn("a") : null;`,
    `${processes}function* f() {\n  yield spawn("a");\n}`,
    `${processes}const child = spawn("a");\ntrack(child);`,
    `${processes}const child = spawn("a");\nawait once(child, "exit");`,
    `${processes}function run() {\n  const child = spawn("a");\n  return child;\n}`,
    `${processes}const child = spawn("a");\nconst task = { child };`,
    `${processes}const child = spawn("a");\nconst other = child;`,
    `${processes}const child = spawn("a");\nthis.child = child;`,
    `${processes}const child = spawn("a");\nexport { child };`,
    `${files}await pipeline(createReadStream("a"), createWriteStream("b"));`,
    `${files}const source = createReadStream("a");\nfinished(source, done);`,
    `${files}const source = createReadStream("a");\nfor await (const piece of source) use(piece);`,
    `${files}for await (const piece of createReadStream("a")) use(piece);`,
    `${files}other.pipe(createWriteStream("a"));`,
    `${files}createReadStream("a").on("error", fail).pipe(createWriteStream("b"));`,
    // What a method returns that is not known to return the emitter.
    `${files}const source = createReadStream("a").setEncoding("utf8");`,
    // They take the error themselves and hand it to the callback.
    `import { exec, execFile } from "node:child_process";\nexec("a");\nexecFile("a");`,
    // They begin nothing yet.
    `import net from "node:net";\nnet.createServer(use).listen(80);`,
    `import dgram from "node:dgram";\ndgram.createSocket("udp4");`,
    // No emitters.
    `import { spawnSync } from "node:child_process";\nspawnSync("a");`,
    `import { watch } from "node:fs/promises";\nwatch("a");`,
    `import fs from "node:fs";\nfs.promises.watch("a");`,
    `import fs from "node:fs";\nfs.readFile("a", use);`,
    `Bun.spawn(["a"]);`,
    // Others of the same name.
    `spawn("a");`,
    `import { spawn } from "./spawn";\nspawn("a");`,
    `${processes}function f(spawn) {\n  spawn("a");\n}`,
    `import { observe } from "./observer";\nobserve("a");`,
    { code: `import { observe } from "./observer";\nobserve("a").on("error", fail);`, options: observer },
    { code: `import { other } from "./observer";\nother("a");`, options: observer },
  ],

  "no-cast-to-brand": [
    `${ids}const a = text as «UserId»;`,
    `${ids}const a = <«UserId»>text;`,
    `${ids}const a = text as unknown as «UserId»;`,
    `${ids}const a = text as any as «UserId»;`,
    `${ids}use(text as «UserId»);`,
    `${ids}const a = (text as «UserId»).length;`,
    `${ids}function f() {\n  return text as «UserId»;\n}`,
    `import { UserId } from "../ids";\nconst a = text as «UserId»;`,
    `import { type UserId } from "../ids";\nconst a = text as «UserId»;`,
    `import type { UserId } from "../ids.js";\nconst a = text as «UserId»;`,
    `import type { UserId } from "../ids.ts";\nconst a = text as «UserId»;`,
    `import type { UserId } from "./../ids";\nconst a = text as «UserId»;`,
    `import type { UserId } from "../../src/ids";\nconst a = text as «UserId»;`,
    `import type { UserId } from "@app/src/ids";\nconst a = text as «UserId»;`,
    `import type { UserId } from "src/ids";\nconst a = text as «UserId»;`,
    // What has it as an element.
    `${ids}const a = texts as «UserId[]»;`,
    `${ids}const a = texts as «UserId[][]»;`,
    `${ids}const a = texts as «readonly UserId[]»;`,
    `${ids}const a = texts as «Array<UserId>»;`,
    `${ids}const a = texts as «ReadonlyArray<UserId>»;`,
    `${ids}const a = texts as «Array<Array<UserId>>»;`,
    `${ids}const a = pair as «[UserId, number]»;`,
    `${ids}const a = pair as «[number, UserId]»;`,
    `${ids}const a = pair as «readonly [UserId]»;`,
    `${ids}const a = pair as «[id: UserId, n?: number]»;`,
    `${ids}const a = pair as «[number, ...UserId[]]»;`,
    `${ids}const a = text as «UserId | undefined»;`,
    `${ids}const a = text as «null | UserId»;`,
    // Under another name.
    `import type { UserId as Id } from "../ids";\nconst a = text as «Id»;`,
    `import type * as ids from "../ids";\nconst a = text as «ids.UserId»;`,
    `import * as ids from "../ids";\nconst a = texts as «ids.UserId[]»;`,
    `${ids}type Id = UserId;\nconst a = text as «Id»;`,
    `${ids}type Id = UserId;\ntype Key = Id;\nconst a = text as «Key»;`,
    `${ids}type Ids = UserId[];\nconst a = texts as «Ids»;`,
    `${ids}type Ids = readonly UserId[];\nconst a = [texts] as «Ids[]»;`,
    `${ids}const a = text as «Id»;\ntype Id = UserId;`,
    `${ids}function f() {\n  type Id = UserId;\n  return text as «Id»;\n}`,
    `${ids}const a = text as «UserId»;\nconst b = text as «UserId»;`,
    // What mints it.
    { code: `import { «toUserId» } from "../ids";`, ids: ["mint"] },
    { code: `import { «toUserId as mint» } from "../ids";`, ids: ["mint"] },
    { code: `import { other, «toUserId» } from "../ids";`, ids: ["mint"] },
    { code: `import { «toUserId» } from "../ids.js";`, ids: ["mint"] },
    { code: `import * as ids from "../ids";\n«ids.toUserId»(text);`, ids: ["mint"] },
    { code: `import * as ids from "../ids";\nconst mint = «ids.toUserId»;`, ids: ["mint"] },
    { code: `export { «toUserId» } from "../ids";`, ids: ["mint"] },
    { code: `export { «toUserId as mint» } from "../ids";`, ids: ["mint"] },
    { code: `import { type UserId, «toUserId» } from "../ids";\nconst a = text as «UserId»;`, ids: ["mint", "cast"] },
    { code: `import type { UserId } from "./ids";\nconst a = text as «UserId»;`, file: "src/session.ts" },
    { code: `import type { UserId } from "./ids";\nconst a = text as «UserId»;`, file: "src/ids.test.ts" },
    { code: `import type { UserId } from "../ids";\nconst a = text as «UserId»;`, file: "src/ids/page.ts" },

    `${ids}const a: UserId = make(text);`,
    `${ids}function f(a: UserId): UserId {\n  return a;\n}`,
    `${ids}const a = value satisfies UserId;`,
    `${ids}const a = text as string;`,
    `${ids}const a = id as string;\nlet b: UserId;`,
    `${ids}const a = [] as const;`,
    `${ids}const a = text!;`,
    // What only mentions it.
    `${ids}const a = map as Map<UserId, string>;`,
    `${ids}const a = set as Set<UserId>;`,
    `${ids}const a = row as { id: UserId };`,
    `${ids}const a = f as (id: UserId) => void;`,
    `${ids}const a = key as keyof UserId;`,
    `${ids}const a = promise as Promise<UserId>;`,
    // Others of that name.
    `const a = text as UserId;`,
    `type UserId = string;\nconst a = text as UserId;`,
    `interface UserId {}\nconst a = value as UserId;`,
    `import type { UserId } from "../other";\nconst a = text as UserId;`,
    `import type { UserId } from "../my-ids";\nconst a = text as UserId;`,
    `import type { UserId } from "./ids";\nconst a = text as UserId;`,
    `import type { UserId } from "ids";\nconst a = text as UserId;`,
    `import type { Other as UserId } from "../ids";\nconst a = text as UserId;`,
    `import type { Other } from "../ids";\nconst a = text as Other;`,
    `import type * as ids from "../ids";\nconst a = text as ids.Other;`,
    `import type * as ids from "../ids";\nconst a = text as ids.inner.UserId;`,
    `${ids}function f<UserId>(a: unknown) {\n  return a as UserId;\n}`,
    `${ids}class Array<T> {}\nconst a = texts as Array<UserId>;`,
    `type A = B;\ntype B = A;\nconst a = text as A;`,
    `type A = A[];\nconst a = text as A;`,
    // The module itself.
    {
      code: `export type UserId = string & { readonly brand: unique symbol };\nexport const toUserId = (text: string) => text as UserId;`,
      file: "src/ids.ts",
    },
    { code: `import type { UserId } from "./ids";\nconst a = text as UserId;`, file: "src/ids.ts" },
    {
      code: `export type UserId = string & { readonly brand: unique symbol };\nconst a = text as UserId;`,
      file: "src/ids/index.ts",
    },
    // Where it may be minted.
    { code: `import { toUserId } from "./ids";`, file: "src/session.ts" },
    { code: `import * as ids from "./ids";\nids.toUserId(text);`, file: "src/session.ts" },
    { code: `export { toUserId } from "./ids";`, file: "src/session.ts" },
    `import { other } from "../ids";`,
    `import { toUserId } from "../other";`,
    `import type { toUserId } from "../ids";`,
    `import { type toUserId } from "../ids";`,
    `import * as ids from "../ids";\nids.other(text);`,
    `import * as ids from "../other";\nids.toUserId(text);`,
    `export { other } from "../ids";`,
    `export type { toUserId } from "../ids";`,
    `const toUserId = 1;\nexport { toUserId };`,
    { code: `import type { UserId } from "../ids";\nconst a = text as UserId;`, options: [] },
    { code: `import { toUserId } from "../ids";`, options: [{ branded: [] }] },
  ].map(inPage),
};

type Message = {
  ruleId: string;
  messageId: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fix?: Fix;
  suggestions?: { fix: Fix }[];
};
type Fix = { range: [number, number]; text: string };

const applied = (code: string, fixes: Fix[]) =>
  fixes
    .toSorted((a, b) => b.range[0] - a.range[0])
    .reduce((text, { range, text: by }) => text.slice(0, range[0]) + by + text.slice(range[1]), code);

/** One pass of `--fix`: of fixes that overlap the first is applied. */
function fixedOnce(code: string, fixes: Fix[]) {
  let end = -1;
  return applied(
    code,
    fixes
      .toSorted((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1])
      .filter(({ range }) => {
        if (range[0] <= end) return false;
        end = range[1];
        return true;
      }),
  );
}

/** `code` with `«` and `»` around what `messages` are about. */
function marked(code: string, messages: Message[]) {
  const lines = code.split("\n");
  const offset = (line: number, column: number) =>
    lines.slice(0, line - 1).reduce((sum, it) => sum + it.length + 1, 0) + column - 1;
  const marks = messages.flatMap(it => [
    { range: [offset(it.line, it.column), offset(it.line, it.column)], text: "«" },
    { range: [offset(it.endLine, it.endColumn), offset(it.endLine, it.endColumn)], text: "»" },
  ]) as Fix[];
  // Of two marks at one place the `»` comes first.
  return applied(
    code,
    marks.toSorted((a, b) => a.text.localeCompare(b.text)),
  );
}

describe.concurrent("bun/", () => {
  for (const [rule, table] of Object.entries(rules)) {
    test(rule, async () => {
      const cases = table.map(it => (typeof it === "string" ? { code: it } : it));
      const name = (index: number) => (cases[index].file ? `case-${index}/${cases[index].file}` : `case-${index}.tsx`);
      const code = (index: number) => cases[index].code.replace(/[«»]/g, "");
      const objects = cases.map((it, index) => ({
        files: [name(index)],
        rules: { [`bun/${rule}`]: ["error", ...(it.options ?? [])] },
      }));
      using dir = tempDir("bun-rules", {
        "eslint.config.mjs": `export default [
          {
            files: ["**/*.tsx", "**/*.ts"],
            languageOptions: {
              parser: { meta: { name: "typescript-eslint/parser" } },
              parserOptions: { ecmaFeatures: { jsx: true } },
              globals: { require: "readonly" },
            },
            linterOptions: { reportUnusedDisableDirectives: "off" },
          },
          ...${JSON.stringify(objects)},
        ];`,
        ...Object.fromEntries(cases.map((_, index) => [name(index), code(index)])),
      });
      await using proc = spawn({
        cmd: [bunExe(), "lint", "-f", "json", "."],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 1) console.error(stderr);
      const results: { filePath: string; messages: Message[] }[] = JSON.parse(stdout);
      const messagesOf = (index: number) =>
        results.find(it => it.filePath.replaceAll("\\", "/").endsWith(`/${name(index)}`))?.messages ?? [];
      const found = cases.map((it, index) => {
        const messages = messagesOf(index);
        const fixes = messages.flatMap(it => it.fix ?? []);
        return {
          code: marked(code(index), messages),
          rules: [...new Set(messages.map(it => it.ruleId))],
          ids: it.ids && messages.map(it => it.messageId),
          output: fixes.length > 0 ? fixedOnce(code(index), fixes) : undefined,
          suggestions: messages.flatMap(it => it.suggestions ?? []).map(it => applied(code(index), [it.fix])),
        };
      });
      const expected = cases.map(it => ({
        code: it.code,
        rules: it.code.includes("«") ? [`bun/${rule}`] : [],
        ids: it.ids,
        output: it.output,
        suggestions: it.suggestions ?? [],
      }));
      expect(found).toEqual(expected);
      expect(exitCode).toBe(1);
    });
  }
});

async function lint(files: Record<string, string>, args: string[]) {
  using dir = tempDir("bun-rules", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** What ESLint's `json` has: the names of the rules that report, by line. */
const reported = (stdout: string, file = "a.js") =>
  (JSON.parse(stdout) as { filePath: string; messages: (Message & { message: string })[] }[])
    .filter(it => basename(it.filePath) === file)
    .flatMap(it => it.messages.map(it => `${it.line} ${it.ruleId}`));

describe.concurrent("the plugin bun", () => {
  const name = "bun/no-eager-dynamic-import";
  const flat = (rules: unknown) => `export default [{ rules: ${JSON.stringify(rules)} }];\n`;
  const eager = `import("a");\n`;

  test("no configuration file has to name it", async () => {
    const legacy = {
      root: true,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { [name]: "error" },
    };
    const [eslint, eslintrc, oxlint, withoutPlugins] = await Promise.all([
      lint({ "eslint.config.mjs": flat({ [name]: "error" }), "a.js": eager }, ["-f", "json", "a.js"]),
      lint({ ".eslintrc.json": JSON.stringify(legacy), "a.js": eager }, ["-f", "json", "a.js"]),
      lint({ ".oxlintrc.json": JSON.stringify({ rules: { [name]: "error" } }), "a.js": eager }, ["-f", "json", "a.js"]),
      lint({ ".oxlintrc.json": JSON.stringify({ plugins: [], rules: { [name]: "error" } }), "a.js": eager }, [
        "-f",
        "json",
        "a.js",
      ]),
    ]);
    expect(reported(eslint.stdout)).toEqual([`1 ${name}`]);
    expect(reported(eslintrc.stdout)).toEqual([`1 ${name}`]);
    for (const { stdout } of [oxlint, withoutPlugins]) {
      const found = JSON.parse(stdout).diagnostics.filter((it: { code: string }) => it.code.startsWith("bun"));
      // There is no page about it at oxc.rs.
      expect(found.map((it: object) => Object.keys(it).filter(key => key === "code" || key === "url"))).toEqual([
        ["code"],
      ]);
      expect(found.map((it: { code: string }) => it.code)).toEqual(["bun(no-eager-dynamic-import)"]);
    }
    expect([eslint, eslintrc, oxlint, withoutPlugins].map(it => it.exitCode)).toEqual([1, 1, 1, 1]);
  });

  test("the command line and comments can turn a rule on", async () => {
    const [byFlag, byComment, byDeny] = await Promise.all([
      lint({ "a.js": eager }, ["--no-config-lookup", "--rule", `${name}: error`, "-f", "json", "a.js"]),
      lint({ "eslint.config.mjs": flat({}), "a.js": `/* eslint ${name}: 2 */\n${eager}` }, ["-f", "json", "a.js"]),
      lint({ ".oxlintrc.json": "{}", "a.js": eager }, ["-D", name, "-f", "unix", "a.js"]),
    ]);
    expect(reported(byFlag.stdout)).toEqual([`1 ${name}`]);
    expect(reported(byComment.stdout)).toEqual([`2 ${name}`]);
    expect(byDeny.stdout).toContain("bun(no-eager-dynamic-import)");
  });

  test("comments can turn a rule off", async () => {
    const code = (prefix: string) =>
      `import("a"); // ${prefix}-disable-line ${name}\n// ${prefix}-disable-next-line ${name}\nimport("b");\nimport("c");\n`;
    const [eslint, oxlint, oxlintAsEslint] = await Promise.all([
      lint({ "eslint.config.mjs": flat({ [name]: "error" }), "a.js": code("eslint") }, ["-f", "json", "a.js"]),
      lint({ ".oxlintrc.json": JSON.stringify({ rules: { [name]: "error" } }), "a.js": code("oxlint") }, [
        "-f",
        "unix",
        "a.js",
      ]),
      lint({ ".oxlintrc.json": JSON.stringify({ rules: { [name]: "error" } }), "a.js": code("eslint") }, [
        "-f",
        "unix",
        "a.js",
      ]),
    ]);
    expect(reported(eslint.stdout)).toEqual([`4 ${name}`]);
    for (const { stdout } of [oxlint, oxlintAsEslint]) {
      expect(
        stdout
          .split("\n")
          .filter(it => it.includes("bun("))
          .map(it => it.split(":").slice(0, 2).join(":")),
      ).toEqual(["a.js:4"]);
    }
  });

  test("nothing turns a rule on by itself", async () => {
    const all = ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"];
    const categories = Object.fromEntries(all.map(it => [it, "error"]));
    const [plain, everything] = await Promise.all([
      lint({ "a.js": eager }, ["-f", "json", "a.js"]),
      lint({ ".oxlintrc.json": JSON.stringify({ categories }), "a.js": eager }, ["-f", "json", "a.js"]),
    ]);
    expect(plain.stdout).not.toContain("no-eager-dynamic-import");
    expect(everything.stdout).not.toContain("no-eager-dynamic-import");
  });

  test("--print-config has the rule and no plugin", async () => {
    const [eslint, oxlint] = await Promise.all([
      lint({ "eslint.config.mjs": flat({ [name]: "error" }), "a.js": eager }, ["--print-config", "a.js"]),
      lint({ ".oxlintrc.json": JSON.stringify({ plugins: [], rules: { [name]: "error" } }), "a.js": eager }, [
        "--print-config",
      ]),
    ]);
    expect(JSON.parse(eslint.stdout).rules).toEqual({ [name]: [2] });
    expect(JSON.parse(eslint.stdout).plugins).toEqual(["@"]);
    expect(JSON.parse(oxlint.stdout).rules[name]).toBe("deny");
    expect(JSON.parse(oxlint.stdout).plugins).toEqual([]);
  });

  test("a plugin of the project that is called bun hides it", async () => {
    const config = `
      const rule = { create: context => ({ Program: node => context.report({ node, message: "theirs" }) }) };
      export default [{ plugins: { bun: { rules: { "no-eager-dynamic-import": rule } } }, rules: { "${name}": "error" } }];`;
    const { stdout } = await lint({ "eslint.config.mjs": config, "a.js": `\n${eager}` }, ["-f", "json", "a.js"]);
    expect(JSON.parse(stdout)[0].messages.map((it: { message: string }) => it.message)).toEqual(["theirs"]);
  });

  test("an .oxlintrc.json cannot name it among its plugins", async () => {
    const { stdout, exitCode } = await lint({ ".oxlintrc.json": JSON.stringify({ plugins: ["bun"] }), "a.js": eager }, [
      "a.js",
    ]);
    // On stdout, where oxlint says it.
    expect(stdout).toContain("Unknown plugin: 'bun'.");
    expect(exitCode).toBe(1);
  });

  test("--rules lists them, without a category and without a page", async () => {
    const { stdout } = await lint({ ".oxlintrc.json": "{}" }, ["--rules", "-f", "json"]);
    const listed = (JSON.parse(stdout) as Record<string, unknown>[]).filter(it => it.scope === "bun");
    expect(listed.map(it => it.value)).toEqual(Object.keys(rules).toSorted());
    expect([...new Set(listed.map(it => JSON.stringify([it.category, it.default, it.docs_url])))]).toEqual([
      "[null,false,null]",
    ]);
  });

  test("options that a rule does not have are refused", async () => {
    const rule = "bun/no-env-at-module-scope";
    const [unknown, wrong, tooMany] = await Promise.all([
      lint({ "eslint.config.mjs": flat({ [rule]: ["error", { nope: 1 }] }), "a.js": eager }, ["a.js"]),
      lint({ "eslint.config.mjs": flat({ [rule]: ["error", { allow: "PORT" }] }), "a.js": eager }, ["a.js"]),
      lint({ "eslint.config.mjs": flat({ [name]: ["error", {}] }), "a.js": eager }, ["a.js"]),
    ]);
    for (const [{ stderr }, id] of [
      [unknown, rule],
      [wrong, rule],
      [tooMany, name],
    ] as const) {
      expect(stderr).toContain(`Key "rules": Key "${id}":`);
    }
    expect([unknown, wrong, tooMany].map(it => it.exitCode)).toEqual([2, 2, 2]);
  });

  test("a pattern that is no regular expression is refused", async () => {
    const options = { patterns: [{ pattern: "(" }] };
    const files = { "eslint.config.mjs": flat({ "bun/no-restricted-text": ["error", options] }), "a.js": eager };
    const { stderr, exitCode } = await lint(files, ["a.js"]);
    expect(stderr).toContain(`The pattern "(" is not a regular expression`);
    expect(exitCode).toBe(2);
  });

  test("bun/prefer-local-module leaves the files in exemptFiles alone", async () => {
    const options = { modules: [{ package: "axios", use: "@/http" }], exemptFiles: ["src/http.js"] };
    const code = `import axios from "axios";\n`;
    const files = {
      "eslint.config.mjs": flat({ "bun/prefer-local-module": ["error", options] }),
      "src/http.js": code,
      "src/a.js": code,
      "src/other-http.js": code,
      "http.js": code,
    };
    const { stdout } = await lint(files, ["-f", "json", "."]);
    const found = (JSON.parse(stdout) as { filePath: string; messages: unknown[] }[]).filter(
      it => it.messages.length > 0,
    );
    expect(found.map(it => basename(it.filePath)).toSorted()).toEqual(["a.js", "http.js", "other-http.js"]);
  });
});
