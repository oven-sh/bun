// The rules of `bun lint` that are Bun's own: `bun/..` and `bun:test/..`. No other linter has them, so what they should report is
// written here.
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

  "zod-prefer-lazy-schema": [
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
    // `lazySchema` itself ends with the factory suffix.
    {
      code: `${zod}const A = lazySchema(() => z.object({ a: userSchema() }));`,
      options: [{ factorySuffix: "Schema", lazyWrapper: "lazySchema" }],
    },
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
    `module.exports = require("a");`,
    `require("a");`,
    `import "a";`,
  ],

  "fast-check-no-unseeded-random": [
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

  "axios-no-unbounded-requests": [
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
    `${processes}export const child = spawn("a");`,
    `${processes}export let child;\nchild = spawn("a");`,
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

// The rules of `bun:test/..` are those that oxlint has for Jest and Vitest, whose cases are in conformance/. Here is what is Bun's own.
const bunTest = `import { describe, expect, expectTypeOf, it, jest, mock, setDefaultTimeout, test, vi, xdescribe, xit, xtest } from "bun:test";\n`;
const inBunTest = (it: Case): Case => {
  const { code, output, suggestions, ...rest } = typeof it === "string" ? { code: it } : it;
  return {
    code: bunTest + code,
    output: output === undefined ? undefined : bunTest + output,
    suggestions: suggestions?.map(it => bunTest + it),
    ...rest,
  };
};
const focused = (code: string): Case => ({ code, suggestions: [code.replace(/\.«only»|\[«"only"»\]/, "")] });
const inTest = (code: string) => `test("a", async () => {\n  ${code}\n});`;

const testRules: Record<string, Case[]> = {
  "no-focused-tests": [
    focused(`test.«only»("a", () => {});`),
    focused(`it.«only»("a", () => {});`),
    focused(`describe.«only»("a", () => {});`),
    focused(`test[«"only"»]("a", () => {});`),
    focused(`test.«only».each([1])("a", () => {});`),
    focused(`test.each([1]).«only»("a", () => {});`),
    focused(`test.concurrent.«only»("a", () => {});`),
    focused(`test.serial.«only»("a", () => {});`),
    focused(`test.failing.«only»("a", () => {});`),
    focused(`test.«only».if(a)("b", () => {});`),
    focused(`test.skipIf(a).«only»("b", () => {});`),
    focused(`describe.«only».skipIf(a)("b", () => {});`),

    `test("a", () => {});`,
    `test.if(a)("b", () => {});`,
    `test.only;`,
    `other.only("a", () => {});`,
    // Bun has none of these.
    `fit("a", () => {});`,
    `fdescribe("a", () => {});`,
    `test.sequential.only("a", () => {});`,
    `suite.only("a", () => {});`,
  ].map(inBunTest),

  "no-disabled-tests": [
    `«test.skip»("a", () => {});`,
    `«it.skip»("a", () => {});`,
    `«describe.skip»("a", () => {});`,
    `«xtest»("a", () => {});`,
    `«xit»("a", () => {});`,
    `«xdescribe»("a", () => {});`,
    `«test.skip.each([1])»("a", () => {});`,
    `«test.concurrent.skip»("a", () => {});`,
    `«test.skipIf(a).skip»("b", () => {});`,
    `«test("a")»;`,
    `«test.failing("a")»;`,
    `«test.skipIf(a)("b")»;`,
    `«test()»;`,

    // A test needs no title.
    `test(() => {});`,
    `test(async () => {});`,
    `test(function () {});`,
    `test(() => {}, 1000);`,
    `test(callback);`,
    `test(callback, 1000);`,
    `test(callback, { timeout: 1000 });`,
    `test.each([1])(callback, 1000);`,
    // What depends on a condition is not disabled.
    `test.skipIf(a)("b", () => {});`,
    `test.if(a)("b", () => {});`,
    `test.todoIf(a)("b", () => {});`,
    `test.todoIf(a)("b");`,
    `describe.skipIf(a)("b", () => {});`,
    `test.skipIf(a).each([1])("b", () => {});`,
    `const onLinux = test.skipIf(a);`,
    `const onLinux = test.concurrent.if(a);`,
    `test.todo("a");`,
    `test.failing("a", () => {});`,
    `test.failingIf(a)("b", () => {});`,
    `test.concurrent("a", () => {});`,
    `test.concurrentIf(a)("b", () => {});`,
    `test.serial("a", () => {});`,
    `test.serialIf(a)("b", () => {});`,
    `pending();`,
  ].map(inBunTest),

  "warn-todo": [`test.«todo»("a");`, `describe.«todo»("a");`, `test.todoIf(a)("b");`].map(inBunTest),

  "valid-describe-callback": [
    `describe(«"a"»);`,
    `«describe()»;`,
    `describe("a", «"b"»);`,
    `describe("a", «{}»);`,
    `describe("a", «b => {}»);`,
    `describe("a", {}, «b => {}»);`,
    `describe(«b => {}»);`,

    `describe("a", () => {});`,
    `describe("a", async () => {});`,
    `describe("a", () => {\n  return 1;\n});`,
    `describe("a", () => tests());`,
    `describe("a", callback);`,
    `describe(callback);`,
    // What is no function is no callback, so the name before or after it is.
    `describe(callback, 1000);`,
    `describe(callback, { timeout: 1000 });`,
    `describe("a", { timeout: 1000 }, callback);`,
    `describe("a", callback, 1000);`,
    `describe("a", callback, options);`,
    `describe(() => {});`,
    `describe(() => {}, 1000);`,
    `describe("a", () => {}, 1000);`,
    `describe("a", () => {}, { timeout: 1000 });`,
    `describe("a", { timeout: 1000 }, () => {});`,
    `describe.todo("a");`,
    `describe.skip("a");`,
    `describe.each([1])("a", b => {});`,
    `describe.skipIf(a)("b", () => {});`,
  ].map(inBunTest),

  "valid-expect": [
    inTest(`«expect(1)»;`),
    inTest(`«expect(1).toBe»;`),
    inTest(`(«expect(1)»);`),
    inTest(`await «expect(1)»;`),
    inTest(`«expect(1).never.toBe(1)»;`),
    inTest(`expect(a).toEqual({ b: «expect.resolvesSo.stringContaining("c")» });`),
    inTest(`«expect()».toBe(1);`),
    inTest(`«expect(1, 2, 3)».toBe(1);`),
    { code: inTest(`«expect(a).resolves.toBe(1)»;`), suggestions: [inTest(`await expect(a).resolves.toBe(1);`)] },

    inTest(`expect(1).toBe(1);`),
    inTest(`expect(1, "why").toBe(1);`),
    inTest(`expect(1, why).toBe(1);`),
    inTest(`expect().pass();`),
    inTest(`expect().fail();`),
    inTest(`expect.unreachable();`),
    inTest(`expect(1)[matcher]();`),
    // The matcher can be called elsewhere.
    inTest(`(expect(1) as any).toBeOne();`),
    inTest(`expect(1)!.toBe(1);`),
    inTest(`const one = expect(1);\n  one.toBe(1);`),
    inTest(`return expect(1);`),
    inTest(`check(expect(1).toBe);`),
    // So can the promise be awaited.
    inTest(`const later = expect(a).resolves.toBe(1);\n  await later;`),
    inTest(`all.push(expect(a).resolves.toBe(1));`),
    inTest(`await expect(a).resolves.not.toBe(1);`),
    inTest(`await expect(a).not.resolves.toBe(1);`),
    inTest(`expect(1).not.not.toBe(1);`),
    // Of `expect` itself, wherever a value can be.
    inTest(`expect(a).toEqual({ b: expect.resolvesTo.stringContaining("c") });`),
    inTest(`expect(a).toEqual({ b: expect.rejectsTo.stringContaining("c") });`),
    inTest(`expect(a).toEqual([expect.rejectsTo.anything()]);`),
    inTest(`expect(a).toEqual(expect.resolvesTo.any(Number));`),
    inTest(`const b = expect.rejectsTo.stringContaining("c");`),
    inTest(`expect(a).toEqual({ b: expect.not.resolvesTo.stringContaining("c") });`),
    inTest(`expect(a).toEqual({ b: expect.resolvesTo.not.stringContaining("c") });`),
    inTest(`expect(a).toEqual({ b: expect.not.stringContaining("c") });`),
  ].map(inBunTest),

  "valid-title": [
    `test(«""», () => {});`,
    `describe(«""», () => {});`,
    { code: `test(«" a"», () => {});`, output: `test("a", () => {});` },
    `test(«" a"», () => {\n  expect(1).toMatchSnapshot();\n});`,
    `test(«a», () => {});`,
    { code: `describe(«add», () => {});`, options: [{ ignoreTypeOfDescribeName: false }] },
    { code: `test(«"adds"», () => {});`, options: [{ mustMatch: "/^ADDS/" }] },
    { code: `test(«"Adds"», () => {});`, options: [{ mustNotMatch: "/^adds/i" }] },
    { code: `it(«"adds"», () => {});\ntest("adds", () => {});`, options: [{ mustMatch: { it: "^should " } }] },

    { code: `test("adds", () => {});`, options: [{ mustMatch: "/^ADDS/i" }] },
    { code: `it("should add", () => {});`, options: [{ mustMatch: { it: "^should " } }] },
    `test("a", () => {});`,
    `test(() => {});`,
    `test(callback);`,
    `test(callback, 1000);`,
    `describe(() => {});`,
    `describe(add, () => {});`,
    `describe(Adder, () => {});`,
    `describe(1, () => {});`,
    { code: `test(a, () => {});`, options: [{ ignoreTypeOfTestName: true }] },
  ].map(inBunTest),

  "expect-expect": [
    `«test»("a", () => {});`,
    `«test.failing»("a", () => {});`,
    `«test.skipIf(a)»("b", () => {});`,
    // Vitest's.
    `«test»("a", () => {\n  assert(1);\n});`,

    `test("a", () => {\n  expect(1).toBe(1);\n});`,
    `test("a", () => {\n  expectTypeOf(1).toBeNumber();\n});`,
    `test.skip("a", () => {});`,
    `test.todo("a", () => {});`,
    `test.todoIf(a)("b");`,
    `own("a", () => {});`,
    // `**` also matches zero segments, and `*` matches any character of a name.
    ...[
      `test("a", () => {\n  request(b).expect(200);\n});`,
      `test("a", () => {\n  request(b).get("/").set("c").expect(200);\n});`,
      `test("a", () => {\n  check_all$(b);\n});`,
      `test("a", () => {\n  b.c.verify();\n});`,
      `test("a", () => {\n  verify();\n});`,
      `test("a", () => {\n  $assert(b);\n});`,
      `«test»("a", () => {\n  request(b).get("/");\n});`,
      `«test»("a", () => {\n  requests.expect(200);\n});`,
      `«test»("a", () => {\n  recheck(b);\n});`,
      `«test»("a", () => {\n  assert(b);\n});`,
    ].map(code => ({
      code,
      options: [{ assertFunctionNames: ["request.**.expect", "check*", "**.verify", "$ass*"] }],
    })),
    // A custom wrapper, a method and a hook.
    ...[
      `«own»("a", () => {});`,
      `«helpers.own»("a", () => {});`,
      `«beforeAll»(() => {});`,
      `own("a", () => {\n  expect(1).toBe(1);\n});`,
      `other("a", () => {});`,
      `own.skip("a", () => {});`,
      `own;`,
    ].map(code => ({ code, options: [{ additionalTestBlockFunctions: ["own", "helpers.own", "beforeAll"] }] })),
  ].map(inBunTest),

  "no-done-callback": [
    `test("a", «done» => {});`,
    `test(«done» => {});`,
    `test("a", «done» => {}, 1000);`,
    `test("a", { retry: 1 }, «done» => {});`,
    `test(«done» => {}, 1000);`,
    `beforeAll(«done» => {}, 1000);`,
    `test("a", () => {});`,
    `test.each([1])("a", b => {});`,
    `test.each([1]).if(c)("a", b => {});`,
  ].map(inBunTest),

  "valid-expect-in-promise": [
    `test("a", () => {\n  «b.then(c => {\n    expect(c).toBe(1);\n  });»\n});`,
    `test(() => {\n  «b.then(c => {\n    expect(c).toBe(1);\n  });»\n});`,
    `test("a", { retry: 1 }, () => {\n  «b.then(c => {\n    expect(c).toBe(1);\n  });»\n});`,
    `test(async () => {\n  await b.then(c => {\n    expect(c).toBe(1);\n  });\n});`,
  ].map(inBunTest),

  "prefer-ending-with-an-expect": [
    `«test»(() => {\n  expect(1).toBe(1);\n  a();\n});`,
    `own("a", () => {\n  b();\n});`,
    ...[
      `«own»("a", () => {\n  expect(1).toBe(1);\n  b();\n});`,
      `«beforeAll»(() => {\n  b();\n});`,
      `own("a", () => {\n  b();\n  expect(1).toBe(1);\n});`,
      `other("a", () => {\n  b();\n});`,
    ].map(code => ({ code, options: [{ additionalTestBlockFunctions: ["own", "beforeAll"] }] })),
    `«test»("a", { retry: 1 }, () => {\n  expect(1).toBe(1);\n  a();\n});`,
    `test(() => {\n  a();\n  expect(1).toBe(1);\n});`,
  ].map(inBunTest),

  "prefer-todo": [
    { code: `«test»("a");`, output: `test.todo("a");` },
    { code: `«test»("a", () => {});`, output: `test.todo("a");` },
    // No fix takes away the options, or the whole test.
    `«test»("a", () => {}, 1000);`,
    `«test»("a", { retry: 1 }, () => {});`,
    `«test»("a", 1000, () => {});`,
    `«test.if(a)»("b", () => {});`,
    `«test.each([1])»("a", () => {});`,
    `test(() => {});`,
    `test("a", { retry: 1 }, () => {\n  b();\n});`,
    `test.todoIf(a)("b");`,
    `test.todo("a");`,
  ].map(inBunTest),

  "prefer-expect-assertions": [
    `«test("a", () => {\n  expect(1).toBe(1);\n})»;`,
    `«test(() => {\n  expect(1).toBe(1);\n})»;`,
    `«test("a", { retry: 1 }, () => {\n  expect(1).toBe(1);\n})»;`,
    `test(() => {\n  expect.hasAssertions();\n});`,
  ]
    .map(code => ({
      code,
      suggestions: ["hasAssertions();", "assertions();"].map(it =>
        code.replace(/[«»]/g, "").replace("{\n", `{expect.${it}\n`),
      ),
    }))
    .map(it => (it.code.includes("«") ? it : it.code))
    .map(inBunTest),

  // A test's count includes its nested blocks and the callbacks it passes to other functions.
  "max-expects": [
    `test("a", () => {\n  expect(1).toBe(1);\n  «expect»(2).toBe(2);\n});`,
    `test("a", () => {\n  expect(1).toBe(1);\n  for (const b of c) {\n    «expect»(b).toBe(2);\n  }\n});`,
    `test("a", () => {\n  expect(1).toBe(1);\n  c.forEach(b => {\n    «expect»(b).toBe(2);\n  });\n});`,
    `test("a", () => {\n  if (b) expect(1).toBe(1);\n  else «expect»(2).toBe(2);\n});`,
    `function check() {\n  expect(1).toBe(1);\n  «expect»(2).toBe(2);\n}`,

    `test("a", () => {\n  expect(1).toBe(1);\n});\ntest("b", () => {\n  expect(2).toBe(2);\n});`,
    `describe("a", () => {\n  test("b", () => {\n    expect(1).toBe(1);\n  });\n  test("c", () => {\n    expect(2).toBe(2);\n  });\n});`,
    `test("a", () => {\n  expect(1).toBe(1);\n  function check() {\n    expect(2).toBe(2);\n  }\n});`,
    `test("a", () => {\n  expect.assertions(1);\n  expect.hasAssertions();\n  expect(1).toBe(1);\n});`,
  ]
    .map(code => ({ code, options: [{ max: 1 }] }))
    .map(inBunTest),

  "no-conditional-expect": [
    `test("a", () => {\n  if (b) «expect»(1).toBe(1);\n});`,
    `test("a", function () {\n  if (b) «expect»(1).toBe(1);\n});`,
    `test("a", function named() {\n  if (b) «expect»(1).toBe(1);\n});`,
    `test("a", () => {\n  each(function () {\n    if (b) «expect»(1).toBe(1);\n  });\n});`,
    // Functions that a test calls, or that are passed as the test itself.
    `function check() {\n  if (b) «expect»(1).toBe(1);\n}\ntest("a", () => check());`,
    `function check() {\n  if (b) «expect»(1).toBe(1);\n}\ntest("a", check);`,
    `const check = () => {\n  if (b) «expect»(1).toBe(1);\n};\ntest("a", () => check());`,
    `const check = function () {\n  if (b) «expect»(1).toBe(1);\n};\ntest("a", check);`,

    `if (b) {\n  test("a", function () {\n    expect(1).toBe(1);\n  });\n}`,
    `test("a", () => {\n  if (b) {\n    const check = () => expect(1).toBe(1);\n  }\n});`,
    `function check() {\n  if (b) expect(1).toBe(1);\n}`,
    `const check = () => {\n  if (b) expect(1).toBe(1);\n};\ncheck();`,
    `const checks = {\n  check() {\n    if (b) expect(1).toBe(1);\n  },\n};\ntest("a", () => checks.check());`,
  ].map(inBunTest),

  // The condition for running a test, its title and its timeout aren't part of the test body.
  "no-conditional-in-test": [
    `test("a", () => {\n  «if (a) b();»\n});`,
    `test.skipIf(a)("b", () => {\n  const c = «d || e»;\n});`,
    `test("a", { timeout: 1000 }, function () {\n  return «b ? c : d»;\n});`,
    `test(() => {\n  «a ?? b»;\n}, 1000);`,

    `test.skipIf(a || b)("c", () => {});`,
    `test.if(a && b)("c", () => {});`,
    `test.todoIf(a ? b : c)("d", () => {});`,
    `test.each(a ?? b)("c", () => {});`,
    `test(a || "b", () => {});`,
    `test("a", () => {}, b ? 1000 : 5000);`,
    `test("a", { timeout: b ?? 1000 }, () => {});`,
  ].map(inBunTest),

  "no-large-snapshots": [
    inTest("expect(a).«toMatchInlineSnapshot»(`\n1\n2\n3\n`);"),
    inTest("expect(a).«toMatchInlineSnapshot»({ b: expect.any(Number) }, `\n1\n2\n3\n`);"),
    inTest("expect(a).toMatchInlineSnapshot({\n  b: expect.any(Number),\n  c: expect.any(Number),\n}, `1`);"),
    inTest("expect(a).toMatchInlineSnapshot(`1`);"),
    inTest("expect(a).toMatchInlineSnapshot();"),
  ]
    .map(code => ({ code, options: [{ inlineMaxSize: 2 }] }))
    .map(inBunTest),

  "no-identical-title": [
    `test("a", () => {});\ntest(«"a"», () => {});`,
    `test.failing("a", () => {});\ntest.serial(«"a"», () => {});`,

    `test.if(a)("b", () => {});\ntest.if(!a)("b", () => {});`,
    `test.skipIf(a)("b", () => {});\ntest.todoIf(a)("b", () => {});`,
    `test.each([1])("a", () => {});\ntest.each([2])("a", () => {});`,
  ].map(inBunTest),

  // A fix writes a name only if the file imports it: nothing else is declared in a file that imports from "bun:test".
  "consistent-test-it": [
    inBunTest({ code: `«it»("a", () => {});`, output: `test("a", () => {});` }),
    inBunTest({ code: `«xit»("a", () => {});`, output: `xtest("a", () => {});` }),
    inBunTest({
      code: `describe("a", () => {\n  «test»("b", () => {});\n});`,
      output: `describe("a", () => {\n  it("b", () => {});\n});`,
    }),
    `import { it } from "bun:test";\n«it»("a", () => {});`,
    `import { test, xit } from "bun:test";\n«xit»("a", () => {});`,
    `import { describe, test } from "bun:test";\ndescribe("a", () => {\n  «test»("b", () => {});\n});`,
  ],

  "no-test-prefixes": [
    ...[
      { code: `«xtest»("a", () => {});`, output: `test.skip("a", () => {});` },
      { code: `«xit.each»([1])("a", () => {});`, output: `it.skip.each([1])("a", () => {});` },
      { code: `«xdescribe»("a", () => {});`, output: `describe.skip("a", () => {});` },
      `fit("a", () => {});`,
    ].map(inBunTest),
    `import { xtest } from "bun:test";\n«xtest»("a", () => {});`,
    `import { xdescribe } from "bun:test";\n«xdescribe»("a", () => {});`,
  ],

  "no-export": [
    { code: `export const «a» = 1;\ntest("a", () => {});`, file: "a.test.ts" },
    { code: `export const «a» = 1;\ntest("a", () => {});`, file: "a_spec.ts" },
    // `bun test` does not run it: others import what it has.
    { code: `export const a = 1;\ntest("a", () => {});`, file: "helpers.ts" },
    { code: `export const a = 1;`, file: "a.test.ts" },
    // Who imports a type does not run the tests.
    { code: `export type A = number;\nexport interface B {}\ntest("a", () => {});`, file: "a.test.ts" },
    { code: `type A = number;\nexport type { A };\nexport {};\ntest("a", () => {});`, file: "a.test.ts" },
    { code: `type A = number;\nconst b = 1;\nexport { type A, «b» };\ntest("a", () => {});`, file: "a.test.ts" },
    { code: `export «default» 1;\ntest("a", () => {});`, file: "a.test.ts" },
  ].map(inBunTest),

  "no-restricted-jest-methods": [`jest.«spyOn»(a, "b");`, `vi.«spyOn»(a, "b");`, `jest.fn();`, `spyOn(a, "b");`]
    .map(code => ({ code, options: [{ spyOn: null }] }))
    .map(inBunTest),

  "prefer-called-once": [
    { code: inTest(`expect(a).«toHaveBeenCalledTimes(1)»;`), output: inTest(`expect(a).toHaveBeenCalledOnce();`) },
    // There is no `toBeCalledOnce`.
    { code: inTest(`expect(a).«toBeCalledTimes(1)»;`), output: inTest(`expect(a).toHaveBeenCalledOnce();`) },
    inTest(`expect(a).toHaveBeenCalledTimes(2);`),
  ].map(inBunTest),

  // A fix that writes `expect(..)` again keeps the message, and the name that `expect` has in the file.
  "prefer-called-times": [
    {
      code: inTest(`«expect(a, "why").toHaveBeenCalledOnce()»;`),
      output: inTest(`expect(a, "why").toHaveBeenCalledTimes(1);`),
    },
    {
      code: inTest(`«expect(a, /* b */ why /* c */).not.toHaveBeenCalledOnce()»;`),
      output: inTest(`expect(a, /* b */ why /* c */).not.toHaveBeenCalledTimes(1);`),
    },
    { code: inTest(`«expect(a).toHaveBeenCalledOnce()»;`), output: inTest(`expect(a).toHaveBeenCalledTimes(1);`) },
    {
      code: `import { expect as check } from "bun:test";\n«check(a, "why").toHaveBeenCalledOnce()»;`,
      output: `import { expect as check } from "bun:test";\ncheck(a, "why").toHaveBeenCalledTimes(1);`,
    },
  ].map(inBunTest),

  "prefer-expect-type-of": [
    {
      code: inTest(`«expect(typeof a, "why").toBe("string")»;`),
      output: inTest(`expect(a, "why").toBeTypeOf("string");`),
    },
    { code: inTest(`«expect(typeof a).toBe("string")»;`), output: inTest(`expect(a).toBeTypeOf("string");`) },
  ].map(inBunTest),

  "prefer-to-have-been-called-times": [
    {
      code: inTest(`«expect(a.mock.calls, "why").toHaveLength(1)»;`),
      output: inTest(`expect(a, "why").toHaveBeenCalledTimes(1);`),
    },
  ].map(inBunTest),

  "prefer-to-have-length": [
    { code: inTest(`expect(a.length, "why").«toBe»(1);`), output: inTest(`expect(a, "why").toHaveLength(1);`) },
    { code: inTest(`expect(a.length, "why").not.«toBe»(1);`), output: inTest(`expect(a, "why").not.toHaveLength(1);`) },
  ].map(inBunTest),

  "prefer-expect-resolves": [
    {
      code: inTest(`expect(«await a», "why").toBe(1);`),
      suggestions: [inTest(`await expect(a, "why").resolves.toBe(1);`)],
    },
  ].map(inBunTest),

  "prefer-to-be": [
    { code: inTest(`expect(a).«toEqual»(1);`), output: inTest(`expect(a).toBe(1);`) },
    { code: inTest(`expect(a).«toEqual»(-1);`), output: inTest(`expect(a).toBe(-1);`) },
    inTest(`expect(a).toEqual(0.5);`),
    inTest(`expect(a).toEqual(-0.5);`),
  ].map(inBunTest),

  "prefer-to-contain": [
    {
      code: inTest(`expect(a.includes(1), "why").«toBe»(true);`),
      suggestions: [inTest(`expect(a, "why").toContain(1);`)],
    },
  ].map(inBunTest),

  "prefer-comparison-matcher": [
    { code: inTest(`expect(a < 1, "why").«toBe»(true);`), suggestions: [inTest(`expect(a, "why").toBeLessThan(1);`)] },
  ].map(inBunTest),

  // A snapshot in a file of its own is found by the titles.
  "prefer-lowercase-title": [
    { code: `test(«"A"», () => {});`, output: `test("a", () => {});` },
    `test(«"A"», () => {\n  expect(1).toMatchSnapshot();\n});`,
    {
      code: `test(«"A"», () => {\n  expect(1).toMatchInlineSnapshot();\n});`,
      output: `test("a", () => {\n  expect(1).toMatchInlineSnapshot();\n});`,
    },
  ].map(inBunTest),

  "prefer-mock-return-shorthand": [
    { code: `a.«mockImplementation»(() => 1);`, output: `a.mockReturnValue(1);` },
    { code: `a.«mockImplementationOnce»(() => ({ b: [c] }));`, output: `a.mockReturnValueOnce({ b: [c] });` },
    { code: `a.«mockImplementation»(function () {\n  return 1;\n});`, output: `a.mockReturnValue(1);` },
    // These run each time the mock is called.
    `a.mockImplementation(() => create());`,
    `a.mockImplementation(() => new User());`,
    `a.mockImplementation(() => ({ id: next() }));`,
    "a.mockImplementation(() => sql`b`);",
    `a.mockImplementation(() => import("b"));`,
    // It returns nothing.
    `a.mockImplementation(function () {\n  b;\n});`,
  ].map(inBunTest),

  "prefer-spy-on": [
    ...[
      { code: `a.b = «jest.fn»();`, suggestions: [`jest.spyOn(a, 'b').mockImplementation();`] },
      // No suggestion, because `spyOn` isn't imported.
      `a.b = «mock»();`,
      `a.b = other();`,
      `const a = mock();`,
      `const a = { b: mock() };`,
      `function f(mock) {\n  a.b = mock();\n}`,
    ].map(inBunTest),
    ...[
      { code: `a.b = «mock»();`, suggestions: [`spyOn(a, 'b').mockImplementation();`] },
      { code: `a.b = «mock»(() => 1);`, suggestions: [`spyOn(a, 'b').mockImplementation(() => 1);`] },
      { code: `a[b] = «mock»(c);`, suggestions: [`spyOn(a, b).mockImplementation(c);`] },
    ].map(({ code, suggestions }) => {
      const head = `import { mock, spyOn } from "bun:test";\n`;
      return { code: head + code, suggestions: suggestions.map(it => head + it) };
    }),
    {
      code: `import { mock as fake, spyOn } from "bun:test";\na.b = «fake»();`,
      suggestions: [`import { mock as fake, spyOn } from "bun:test";\nspyOn(a, 'b').mockImplementation();`],
    },
    `import { test } from "bun:test";\nimport { mock } from "./mock";\na.b = mock();`,
  ],

  "prefer-describe-function-title": [
    {
      code: `import { add } from "./add";\ndescribe(«"add"», () => {});`,
      suggestions: [`import { add } from "./add";\ndescribe(add, () => {});`],
    },
    // A type can't be passed as a value.
    `import type { Add } from "./add";\ndescribe("Add", () => {});`,
    `import { type Add } from "./add";\ndescribe("Add", () => {});`,
  ].map(inBunTest),

  // oxlint applies these, and the fixes above of what is awaited, included and compared. A test that passes can fail afterwards.
  "prefer-called-with": [
    { code: inTest(`expect(a).«toHaveBeenCalled»();`), suggestions: [inTest(`expect(a).toHaveBeenCalledWith();`)] },
  ].map(inBunTest),

  "prefer-strict-boolean-matchers": [
    { code: inTest(`expect(1).«toBeTruthy()»;`), suggestions: [inTest(`expect(1).toBe(true);`)] },
    { code: inTest(`expect(0, "why").«toBeFalsy()»;`), suggestions: [inTest(`expect(0, "why").toBe(false);`)] },
    // `.not.toBe(true)` passes for everything but `true`.
    { code: inTest(`expect(a).not.«toBeTruthy()»;`), suggestions: [inTest(`expect(a).toBe(false);`)] },
    { code: inTest(`expect(a).not.«toBeFalsy()»;`), suggestions: [inTest(`expect(a).toBe(true);`)] },
    {
      code: inTest(`await expect(a).resolves.not.«toBeTruthy()»;`),
      suggestions: [inTest(`await expect(a).resolves.toBe(false);`)],
    },
    inTest(`expect(a)["not"].«toBeTruthy()»;`),
  ].map(inBunTest),

  "require-hook": [
    `«setup()»;`,
    `describe("a", () => {\n  «setup()»;\n});`,
    `describe(() => {\n  «setup()»;\n});`,
    `describe("a", { timeout: 1000 }, () => {\n  «setup()»;\n});`,

    `setDefaultTimeout(1000);`,
    `mock.module("a", () => ({}));`,
    `jest.useFakeTimers();`,
    `expect.extend({});`,
    `expectTypeOf(1).toBeNumber();`,
    `xtest("a", () => {});`,
    `xdescribe("a", () => {});`,
  ].map(inBunTest),

  "require-mock-type-parameters": [`jest.«fn»();`, `vi.«fn»();`, `jest.fn<() => void>();`, `vi.fn<() => void>();`].map(
    inBunTest,
  ),

  "require-test-timeout": [
    `«test("a", () => {})»;`,
    `«test(() => {})»;`,
    `test(() => {}, «{ retry: 1 }»);`,
    `test("a", () => {}, «{ retry: 1 }»);`,
    `test("a", «{ retry: 1 }», () => {});`,
    `test("a", () => {}, «-1»);`,
    `test("a", () => {}, «limit»);`,
    `«test("a", () => {})»;\nsetDefaultTimeout(1000);`,
    `setDefaultTimeout(«limit»);`,
    // Vitest's.
    `vi.setConfig({ testTimeout: 1000 });\n«test("a", () => {})»;`,

    `test("a", () => {}, 1000);`,
    `test(() => {}, 1000);`,
    `test(() => {}, { timeout: 1000 });`,
    `test("a", 1000, () => {});`,
    `test("a", () => {}, { timeout: 1000 });`,
    `test("a", { timeout: 1000 }, () => {});`,
    `setDefaultTimeout(1000);\ntest("a", () => {});`,
    `jest.setTimeout(1000);\ntest("a", () => {});`,
    `test.todo("a", () => {});`,
    `xtest("a", () => {});`,
  ].map(inBunTest),
};

const whose: Case[] = [
  focused(`import { test } from "bun:test";\ntest.«only»("a", () => {});`),
  focused(`import { test as check } from "bun:test";\ncheck.«only»("a", () => {});`),
  focused(`import { type Mock, test } from "bun:test";\ntest.«only»("a", () => {});`),
  focused(`const { test } = require("bun:test");\ntest.«only»("a", () => {});`),
  focused(`const { test: check } = require("bun:test");\ncheck.«only»("a", () => {});`),
  focused(`const { test } = await import("bun:test");\ntest.«only»("a", () => {});`),
  // What `bun test` declares, in a file that imports something else from there.
  focused(`import { expect } from "bun:test";\ntest.«only»("a", () => {});`),
  focused(`import { expect } from "bun:test";\ndescribe.«only»("a", () => {});`),
  focused(`import "bun:test";\ntest.«only»("a", () => {});`),
  focused(`import * as all from "bun:test";\ntest.«only»("a", () => {});`),
  focused(`const all = require("bun:test");\ntest.«only»("a", () => {});`),

  // Nothing is imported from there.
  { code: `test.only("a", () => {});`, file: "a.test.ts" },
  { code: `import { test } from "vitest";\ntest.only("a", () => {});`, file: "a.test.ts" },
  { code: `import { test } from "@jest/globals";\ntest.only("a", () => {});`, file: "a.test.ts" },
  `import type { Mock } from "bun:test";\ntest.only("a", () => {});`,
  `import { test } from "bun:tests";\ntest.only("a", () => {});`,
  `const from = "bun:test";\ntest.only("a", () => {});`,
  `function load() {\n  return require("bun:test");\n}\ntest.only("a", () => {});`,
  // It is somebody else's.
  `import { expect } from "bun:test";\nimport { test } from "vitest";\ntest.only("a", () => {});`,
  `import { expect } from "bun:test";\nimport { test } from "@jest/globals";\ntest.only("a", () => {});`,
  `import { expect } from "bun:test";\nimport { test } from "./test";\ntest.only("a", () => {});`,
  `import { expect } from "bun:test";\nfunction test() {}\ntest.only("a", () => {});`,
  `import { expect } from "bun:test";\nfunction run(test) {\n  test.only("a", () => {});\n}`,
  // As with `@jest/globals`, the members of a namespace are not followed.
  `import * as all from "bun:test";\nall.test.only("a", () => {});`,
];

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

const tables = Object.entries({
  bun: rules,
  "bun:test": { ...testRules, "no-focused-tests, by whose the call is": whose },
});
describe.concurrent.each(tables)("%s/", (plugin, rules) => {
  for (const [title, table] of Object.entries(rules)) {
    test(title, async () => {
      const rule = `${plugin}/${title.split(",")[0]}`;
      const cases = table.map(it => (typeof it === "string" ? { code: it } : it));
      const name = (index: number) => (cases[index].file ? `case-${index}/${cases[index].file}` : `case-${index}.tsx`);
      const code = (index: number) => cases[index].code.replace(/[«»]/g, "");
      const objects = cases.map((it, index) => ({
        files: [name(index)],
        rules: { [rule]: ["error", ...(it.options ?? [])] },
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
        rules: it.code.includes("«") ? [rule] : [],
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

  test("--rules lists them, without a category", async () => {
    const { stdout } = await lint({ ".oxlintrc.json": "{}" }, ["--rules", "-f", "json"]);
    const listed = (JSON.parse(stdout) as Record<string, unknown>[]).filter(it => it.scope === "bun");
    // `bun/format` is tested with `prettier/prettier`: prettier-rule.test.ts.
    expect(listed.map(it => it.value)).toEqual([...Object.keys(rules), "format"].toSorted());
    expect([...new Set(listed.map(it => JSON.stringify([it.category, it.default])))]).toEqual(["[null,false]"]);
    expect(listed.map(it => it.docs_url)).toEqual(listed.map(it => `https://bun.com/docs/lint/rules/bun/${it.value}`));
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
    expect(stderr).toContain(`Invalid pattern "(": Invalid regular expression: `);
    expect(exitCode).toBe(2);
  });

  test("each rule's message", async () => {
    const files = {
      "bunfig.toml": `[lint.rules]
"bun/no-eager-dynamic-import" = "error"
"bun/no-eager-native-addon" = "error"
"bun/no-env-at-module-scope" = "error"
"bun/no-literal-temp-dir" = "error"
"bun/no-negative-repeat-count" = "error"
"bun/no-redundant-catch-type" = "error"
"bun/no-useless-spread-fallback" = "error"
"bun/no-array-just-to-count" = "error"
"bun/prefer-builtin-sleep" = "error"
"bun/react-prefer-updater-function" = "error"
"bun/no-console-window-flash" = "error"
"bun/no-unportable-commands" = "error"
"bun/no-cwd-dependent-path" = "error"
"bun/zod-prefer-lazy-schema" = "error"
"bun/no-side-effects-on-import" = "error"
"bun/fast-check-no-unseeded-random" = "error"
"bun/react-no-namespace-hooks" = "error"
"bun/react-no-latest-value-ref" = "error"
"bun/jsx-no-forbidden-nesting" = "error"
"bun/consistent-directive-prefix" = "error"
"bun/no-restricted-text" = ["error", { patterns = [{ pattern = "foo" }] }]
"bun/prefer-timeout-signal" = "error"
"bun/prefer-url-for-sibling-files" = "error"
"bun/react-no-local-render-helpers" = "error"
"bun/prefer-local-module" = ["error", { modules = [{ package = "axios", use = "@/http" }] }]
"bun/axios-no-unbounded-requests" = "error"
"bun/no-unhandled-emitter-errors" = "error"
"bun/no-cast-to-brand" = ["error", { branded = [{ module = "src/ids", type = "UserId", mint = ["toUserId"], mintedIn = ["src/session.ts"] }] }]
`,
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "jsx": "preserve" } }\n`,
      "a.tsx": `import { exec, spawn } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import fc from "fast-check";
import React, { useRef, useEffect, useState } from "react";
import axios from "axios";
const a1 = import("a");
const addon = require("./addon.node");
const port = process.env.PORT;
const env = { ...process.env };
const t = "/tmp/a.txt";
const r = " ".repeat(width - text.length);
try {} catch (error: unknown) {}
const s = { ...(b ? { c: 1 } : {}) };
const n = b.split(",").length;
await new Promise(done => setTimeout(done, 250));
spawn("npm", ["install"]);
spawn("ls", ["-l"]);
exec("a && b");
exec("ps -ef");
fs.readFileSync("a.txt");
const A = z.string();
start();
a.b = 1;
fc.property(fc.integer(), a => fc.sample(fc.integer(), 1));
fc.property(fc.integer(), a => a > Math.random());
React.useState(0);
function C({ count }) {
  const saved = useRef(count);
  saved.current = count;
  useEffect(() => {
    saved.current = count;
  });
  const [rows, setRows] = useState([]);
  setRows([...rows, 1]);
}
const x = <a><a /></a>;
// oxlint-disable-next-line no-debugger
debugger;
const f = "a foo b";
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);
await fetch(address, { signal: controller.signal });
const j = join(import.meta.dirname, "a.txt");
function Table({ rows }) {
  const renderCell = row => <tr key={row.id} />;
  return <table>{rows.map(renderCell)}</table>;
}
axios.get("/a");
axios.get("/a", { timeout: 0 });
const ps = "ps -ef";
`,
      "src/ids.ts": `export type UserId = string & { brand: 1 };
export const toUserId = (a: string) => a as UserId;
`,
      "src/views/page.ts": `import type { UserId } from "../ids";
import { toUserId } from "../ids";
const a = text as UserId;
const b = toUserId(text);
`,
    };
    const { stdout, exitCode } = await lint(files, ["-f", "json"]);
    const messages = (JSON.parse(stdout) as { messages: { ruleId: string | null; message: string }[] }[])
      .flatMap(it => it.messages)
      .filter(it => it.ruleId?.startsWith("bun/"));
    expect([...new Set(messages.map(it => `${it.ruleId}: ${it.message}`))].sort()).toEqual([
      "bun/axios-no-unbounded-requests: This axios request has no time limit. Set `timeout` or pass a `signal`.",
      "bun/axios-no-unbounded-requests: `timeout: 0` means no time limit.",
      "bun/consistent-directive-prefix: Use `eslint` instead of `oxlint`.",
      "bun/fast-check-no-unseeded-random: `Math.random()` ignores the seed of the run, so a failure cannot be replayed or shrunk. Make the value a parameter of the property.",
      "bun/fast-check-no-unseeded-random: `sample()` ignores the seed of the run, so a failure cannot be replayed or shrunk. Make the value a parameter of the property.",
      "bun/jsx-no-forbidden-nesting: `<a>` cannot be inside `<a>`.",
      "bun/no-array-just-to-count: `split()` builds an array only to read its length. Count the separators instead.",
      "bun/no-cast-to-brand: This cast creates a `UserId` from an unchecked value. Only `src/ids` should create one.",
      "bun/no-cast-to-brand: `toUserId` turns any value into a `UserId`, and this file is not allowed to import it.",
      "bun/no-console-window-flash: On Windows, this process briefly opens a console window. Set `windowsHide: true`.",
      'bun/no-cwd-dependent-path: "a.txt" is relative to the working directory of the process. Resolve it from `import.meta.dirname`.',
      "bun/no-eager-dynamic-import: This `import()` runs as soon as the module is imported. Call it where it is needed, or use an `import` statement.",
      "bun/no-eager-native-addon: The native addon `./addon.node` loads as soon as the module is imported. Load it inside the function that needs it.",
      "bun/no-env-at-module-scope: The environment is read as soon as the module is imported. Read it inside the function that needs it.",
      "bun/no-env-at-module-scope: `process.env.PORT` is read as soon as the module is imported. Read it inside the function that needs it.",
      "bun/no-literal-temp-dir: `/tmp` is not the temporary directory on every system. Use `os.tmpdir()`.",
      "bun/no-negative-repeat-count: `repeat()` throws a `RangeError` if this count is negative. Give it a lower bound.",
      "bun/no-redundant-catch-type: With `strict` or `useUnknownInCatchVariables`, a `catch` variable is already `unknown`. Remove the annotation.",
      "bun/no-restricted-text: `foo` matches the restricted pattern `foo`.",
      "bun/no-side-effects-on-import: This changes an object as soon as the module is imported. Move it into an exported function.",
      "bun/no-side-effects-on-import: This runs as soon as the module is imported. Move it into an exported function.",
      "bun/no-unhandled-emitter-errors: `spawn()` emits `error` when it fails, which crashes the process if nothing listens. Add an `error` listener.",
      "bun/no-unportable-commands: On Windows, `npm` is the script `npm.cmd`, which cannot run without a shell.",
      "bun/no-unportable-commands: `&&` is shell syntax, and the shell differs between systems.",
      "bun/no-unportable-commands: `ls` does not exist on Windows.",
      "bun/no-unportable-commands: `ps` does not exist on Windows.",
      "bun/no-unportable-commands: `ps` options differ between systems, and `ps` does not exist on Windows.",
      "bun/no-useless-spread-fallback: This empty object is not needed. Spreading `false`, `null` or `undefined` into an object does nothing.",
      "bun/prefer-builtin-sleep: This promise only waits. Use `Bun.sleep(ms)` or `setTimeout(ms)` from `node:timers/promises`.",
      "bun/prefer-local-module: Import from `@/http` instead of `axios`.",
      "bun/prefer-timeout-signal: Only a timer aborts this controller. Use `AbortSignal.timeout(ms)` instead.",
      'bun/prefer-url-for-sibling-files: Bundlers cannot follow this path. Use `new URL("./file", import.meta.url)`.',
      "bun/react-no-latest-value-ref: This effect only copies a value into `saved.current`. Use `useEffectEvent()` to read the latest values without a ref.",
      "bun/react-no-latest-value-ref: `saved.current` is set during render. React may render more than once, or throw the result away.",
      "bun/react-no-local-render-helpers: `renderCell` is created again on every render, and React does not see it as a component. Move it out and make it a component.",
      'bun/react-no-namespace-hooks: Import `useState` by name from "react".',
      "bun/react-prefer-updater-function: `rows` may be out of date when `setRows` is called. Pass a function: `setRows(previous => ..)`.",
      "bun/zod-prefer-lazy-schema: This schema is built as soon as the module is imported. Build it when it is first used.",
    ]);
    expect(exitCode).toBe(1);
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

/** For each rule of `bun:test`: code that it reports, code that it does not, and its options. */
const twins: Record<string, [reported: string, clean: string, ...options: unknown[]]> = {
  "consistent-test-filename": [`test("a", () => {});`, `test("a", () => {});`],
  "consistent-test-it": [`it("a", () => {});`, `test("a", () => {});`],
  "expect-expect": [`test("a", () => {});`, `test("a", () => { expect(1).toBe(1); });`],
  "max-expects": [
    `test("a", () => { expect(1).toBe(1); expect(2).toBe(2); });`,
    `test("a", () => { expect(1).toBe(1); });`,
    { max: 1 },
  ],
  "max-nested-describe": [`describe("a", () => { describe("b", () => {}); });`, `describe("a", () => {});`, { max: 1 }],
  "no-alias-methods": [
    `test("a", () => { expect(a).toBeCalled(); });`,
    `test("a", () => { expect(a).toHaveBeenCalled(); });`,
  ],
  "no-commented-out-tests": [`// test("a", () => {});`, `// a test`],
  "no-conditional-expect": [
    `test("a", () => { if (a) expect(1).toBe(1); });`,
    `test("a", () => { expect(1).toBe(1); });`,
  ],
  "no-conditional-in-test": [`test("a", () => { if (a) b(); });`, `test("a", () => { b(); });`],
  "no-conditional-tests": [`if (a) { test("a", () => {}); }`, `test("a", () => {});`],
  "no-disabled-tests": [`test.skip("a", () => {});`, `test("a", () => {});`],
  "no-done-callback": [`test("a", done => { done(); });`, `test("a", () => {});`],
  "no-duplicate-hooks": [`beforeEach(() => {}); beforeEach(() => {});`, `beforeEach(() => {});`],
  "no-export": [`export const a = 1; test("a", () => {});`, `const a = 1; test("a", () => {});`],
  "no-focused-tests": [`test.only("a", () => {});`, `test("a", () => {});`],
  "no-hooks": [`beforeEach(() => {});`, `test("a", () => {});`],
  "no-identical-title": [`test("a", () => {}); test("a", () => {});`, `test("a", () => {}); test("b", () => {});`],
  "no-interpolation-in-snapshots": [
    "test('a', () => { expect(a).toMatchInlineSnapshot(`${b}`); });",
    "test('a', () => { expect(a).toMatchInlineSnapshot(`b`); });",
  ],
  "no-large-snapshots": [
    "test('a', () => { expect(a).toMatchInlineSnapshot(`\n1\n2\n3\n`); });",
    "test('a', () => { expect(a).toMatchInlineSnapshot(`1`); });",
    { inlineMaxSize: 2 },
  ],
  "no-restricted-jest-methods": [`jest.spyOn(a, "b");`, `jest.fn();`, { spyOn: null }],
  "no-restricted-matchers": [
    `test("a", () => { expect(a).toBeFalsy(); });`,
    `test("a", () => { expect(a).toBe(false); });`,
    { toBeFalsy: null },
  ],
  "no-standalone-expect": [`expect(1).toBe(1);`, `test("a", () => { expect(1).toBe(1); });`],
  "no-test-prefixes": [`xtest("a", () => {});`, `test.skip("a", () => {});`],
  "no-test-return-statement": [
    `test("a", () => { return expect(1).toBe(1); });`,
    `test("a", () => { expect(1).toBe(1); });`,
  ],
  "no-unneeded-async-expect-function": [
    `test("a", async () => { await expect(async () => { await b(); }).rejects.toThrow("c"); });`,
    `test("a", async () => { await expect(b()).rejects.toThrow("c"); });`,
  ],
  "padding-around-after-all-blocks": [`const a = 1;\nafterAll(() => {});`, `const a = 1;\n\nafterAll(() => {});`],
  "padding-around-test-blocks": [`const a = 1;\ntest("a", () => {});`, `const a = 1;\n\ntest("a", () => {});`],
  "prefer-called-once": [
    `test("a", () => { expect(a).toHaveBeenCalledTimes(1); });`,
    `test("a", () => { expect(a).toHaveBeenCalledOnce(); });`,
  ],
  "prefer-called-times": [
    `test("a", () => { expect(a).toHaveBeenCalledOnce(); });`,
    `test("a", () => { expect(a).toHaveBeenCalledTimes(1); });`,
  ],
  "prefer-called-with": [
    `test("a", () => { expect(a).toHaveBeenCalled(); });`,
    `test("a", () => { expect(a).toHaveBeenCalledWith(1); });`,
  ],
  "prefer-comparison-matcher": [
    `test("a", () => { expect(a > 1).toBe(true); });`,
    `test("a", () => { expect(a).toBeGreaterThan(1); });`,
  ],
  "prefer-describe-function-title": [
    `import { add } from "./add";\ndescribe("add", () => {});`,
    `import { add } from "./add";\ndescribe(add, () => {});`,
  ],
  "prefer-each": [`for (const a of b) { test("a", () => {}); }`, `test.each(b)("a", () => {});`],
  "prefer-ending-with-an-expect": [
    `test("a", () => { expect(1).toBe(1); b(); });`,
    `test("a", () => { b(); expect(1).toBe(1); });`,
  ],
  "prefer-equality-matcher": [
    `test("a", () => { expect(a === 1).toBe(true); });`,
    `test("a", () => { expect(a).toBe(1); });`,
  ],
  "prefer-expect-assertions": [
    `test("a", () => { expect(1).toBe(1); });`,
    `test("a", () => { expect.hasAssertions(); expect(1).toBe(1); });`,
  ],
  "prefer-expect-resolves": [
    `test("a", async () => { expect(await b).toBe(1); });`,
    `test("a", async () => { await expect(b).resolves.toBe(1); });`,
  ],
  "prefer-expect-type-of": [
    `test("a", () => { expect(typeof a).toBe("string"); });`,
    `test("a", () => { expect(a).toBeTypeOf("string"); });`,
  ],
  "prefer-hooks-in-order": [`afterAll(() => {});\nbeforeAll(() => {});`, `beforeAll(() => {});\nafterAll(() => {});`],
  "prefer-hooks-on-top": [`test("a", () => {});\nbeforeAll(() => {});`, `beforeAll(() => {});\ntest("a", () => {});`],
  "prefer-lowercase-title": [`test("A", () => {});`, `test("a", () => {});`],
  "prefer-mock-promise-shorthand": [`a.mockImplementation(() => Promise.resolve(1));`, `a.mockResolvedValue(1);`],
  "prefer-mock-return-shorthand": [`a.mockImplementation(() => 1);`, `a.mockReturnValue(1);`],
  "prefer-snapshot-hint": [
    `test("a", () => { expect(1).toMatchSnapshot(); expect(2).toMatchSnapshot(); });`,
    `test("a", () => { expect(1).toMatchSnapshot("b"); expect(2).toMatchSnapshot("c"); });`,
  ],
  "prefer-spy-on": [`a.b = jest.fn();`, `jest.spyOn(a, "b");`],
  "prefer-strict-boolean-matchers": [
    `test("a", () => { expect(a).toBeTruthy(); });`,
    `test("a", () => { expect(a).toBe(true); });`,
  ],
  "prefer-strict-equal": [
    `test("a", () => { expect(a).toEqual(1); });`,
    `test("a", () => { expect(a).toStrictEqual(1); });`,
  ],
  "prefer-to-be": [`test("a", () => { expect(a).toEqual(1); });`, `test("a", () => { expect(a).toBe(1); });`],
  "prefer-to-be-falsy": [
    `test("a", () => { expect(a).toBe(false); });`,
    `test("a", () => { expect(a).toBeFalsy(); });`,
  ],
  "prefer-to-be-truthy": [
    `test("a", () => { expect(a).toBe(true); });`,
    `test("a", () => { expect(a).toBeTruthy(); });`,
  ],
  "prefer-to-contain": [
    `test("a", () => { expect(a.includes(1)).toBe(true); });`,
    `test("a", () => { expect(a).toContain(1); });`,
  ],
  "prefer-to-have-been-called": [
    `test("a", () => { expect(a).toHaveBeenCalledTimes(0); });`,
    `test("a", () => { expect(a).not.toHaveBeenCalled(); });`,
  ],
  "prefer-to-have-been-called-times": [
    `test("a", () => { expect(a.mock.calls).toHaveLength(1); });`,
    `test("a", () => { expect(a).toHaveBeenCalledTimes(1); });`,
  ],
  "prefer-to-have-length": [
    `test("a", () => { expect(a.length).toBe(1); });`,
    `test("a", () => { expect(a).toHaveLength(1); });`,
  ],
  "prefer-todo": [`test("a");`, `test.todo("a");`],
  "require-hook": [`setup();`, `beforeAll(() => { setup(); });`],
  "require-mock-type-parameters": [`const a = vi.fn();`, `const a = vi.fn<() => void>();`],
  "require-test-timeout": [`test("a", () => {});`, `test("a", () => {}, 1000);`],
  "require-to-throw-message": [
    `test("a", () => { expect(a).toThrow(); });`,
    `test("a", () => { expect(a).toThrow("b"); });`,
  ],
  "require-top-level-describe": [`test("a", () => {});`, `describe("a", () => { test("b", () => {}); });`],
  "valid-describe-callback": [`describe("a", b => {});`, `describe("a", () => {});`],
  "valid-expect": [`test("a", () => { expect(1); });`, `test("a", () => { expect(1).toBe(1); });`],
  "valid-expect-in-promise": [
    `test("a", () => { b.then(c => { expect(c).toBe(1); }); });`,
    `test("a", async () => { await b.then(c => { expect(c).toBe(1); }); });`,
  ],
  "valid-title": [`test("", () => {});`, `test("a", () => {});`],
  "warn-todo": [`test.todo("a");`, `test("a", () => {});`],
};

/** The rules of oxlint that do not ask what `test` refers to, or that are not about calls: they report in every file. */
const goByWhatIsWritten = [
  "consistent-test-filename",
  "no-commented-out-tests",
  "no-conditional-in-test",
  "no-test-return-statement",
  "prefer-each",
  "prefer-hooks-in-order",
  "prefer-mock-promise-shorthand",
  "prefer-mock-return-shorthand",
  "prefer-spy-on",
  "require-hook",
];

describe.concurrent("bun:test/, jest/ and vitest/ are one implementation", () => {
  const names =
    "afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, jest, test, vi, xdescribe, xit, xtest";
  const sources = ["bun:test", "vitest", "@jest/globals", ""];

  test("each reports what is imported from where it looks", async () => {
    const listed = await lint({ ".oxlintrc.json": "{}" }, ["--rules", "-f", "json"]);
    const all = (JSON.parse(listed.stdout) as { scope: string; value: string }[]).map(it => `${it.scope}/${it.value}`);
    expect(all.filter(it => it.startsWith("bun:test/"))).toEqual(Object.keys(twins).map(it => `bun:test/${it}`));
    /** The rules of the other two plugins that are the same rule. */
    const twinsOf = (rule: string) =>
      [`jest/${rule}`, `vitest/${rule.replace("-jest-", "-vi-")}`].filter(it => all.includes(it));

    const files: Record<string, string> = {};
    const overrides = Object.entries(twins).map(([rule, [reported, clean, ...options]]) => {
      for (const [index, source] of sources.entries()) {
        const head = source && `import { ${names} } from "${source}";\n`;
        // `consistent-test-filename` wants `.test.`.
        files[`${rule}.${index}.reported.${rule === "consistent-test-filename" ? "spec" : "test"}.ts`] =
          head + reported;
        files[`${rule}.${index}.clean.test.ts`] = head + clean;
      }
      const ids = [`bun:test/${rule}`, ...twinsOf(rule)];
      return { files: [`${rule}.*`], rules: Object.fromEntries(ids.map(id => [id, ["error", ...options]])) };
    });
    const config = { plugins: ["jest", "vitest"], categories: { correctness: "off" }, overrides };
    const { stdout } = await lint({ ".oxlintrc.json": JSON.stringify(config), ...files }, ["-f", "json", "."]);
    const diagnostics = JSON.parse(stdout).diagnostics as { filename: string; code: string }[];
    const found = (prefix: string) => [
      ...new Set(
        diagnostics
          .filter(it => it.filename.startsWith(prefix))
          .map(it => it.code.replace(/\((.*)\)/, "/$1"))
          .toSorted(),
      ),
    ];
    const table = (cell: (rule: string, index: number, kind: "reported" | "clean") => string[]) =>
      Object.fromEntries(
        Object.keys(twins).map(rule => [
          rule,
          sources.map((_, index) => [cell(rule, index, "reported"), cell(rule, index, "clean")]),
        ]),
      );
    expect(table((rule, index, kind) => found(`${rule}.${index}.${kind}.`))).toEqual(
      table((rule, index, kind) =>
        kind === "clean"
          ? []
          : index === 0
            ? [`bun:test/${rule}`, ...(goByWhatIsWritten.includes(rule) ? twinsOf(rule) : [])]
            : // oxlint has one list of what is imported from either, and of the globals, for both plugins.
              twinsOf(rule),
      ),
    );
  });
});

describe.concurrent("the plugin bun:test", () => {
  const name = "bun:test/no-focused-tests";
  const flat = (rules: unknown) => `export default [{ rules: ${JSON.stringify(rules)} }];\n`;
  const legacy = (rules: unknown) =>
    JSON.stringify({ root: true, parserOptions: { ecmaVersion: 2022, sourceType: "module" }, rules });
  const oxlintrc = (rules: unknown) => JSON.stringify({ rules });
  const only = `import { test } from "bun:test";\ntest.only("a", () => {});\n`;
  /** The lines of `unix` that are about a rule of the plugin: the line in the file, and what is in the brackets. */
  const unix = (stdout: string) =>
    [...stdout.matchAll(/^.*?:(\d+):\d+: .* \[(.*bun:test.*)\]$/gm)].map(it => `${it[1]} ${it[2]}`);

  test("without a configuration file some rules are on", async () => {
    const code = `import { describe, expect, test } from "bun:test";
test.only("a", () => {});
test.skip("b", () => {});
export const c = 1;
describe("d", e => {});
test("f", () => {
  expect(1);
  g.then(h => {
    expect(h).toBe(1);
  });
});
`;
    // What oxlint has in `correctness` too, and what reports too much that is usual with Bun.
    const quiet = `import { expect, test } from "bun:test";
test("a", () => {});
test("test b", () => {
  if (c) expect(() => {}).toThrow();
  expect(1).toMatchSnapshot();
  expect(2).toMatchSnapshot();
});
expect(1).toBe(1);
`;
    const files = { "a.test.js": code, "quiet.test.js": quiet };
    const [plain, withBunfig, skipped] = await Promise.all([
      lint(files, ["-f", "json", "."]),
      lint({ ...files, "bunfig.toml": "[lint]\nmaxWarnings = 0\n" }, ["-f", "json", "."]),
      lint({ "a.test.js": `import { test } from "bun:test";\ntest.skip("a", () => {});\n` }, ["-f", "unix", "."]),
    ]);
    const own = (all: string[]) => all.filter(it => it.includes(" bun:test/"));
    for (const { stdout } of [plain, withBunfig]) {
      expect(own(reported(stdout, "a.test.js"))).toEqual([
        "2 bun:test/no-focused-tests",
        "3 bun:test/no-disabled-tests",
        "4 bun:test/no-export",
        "5 bun:test/valid-describe-callback",
        "7 bun:test/valid-expect",
        "8 bun:test/valid-expect-in-promise",
      ]);
      expect(own(reported(stdout, "quiet.test.js"))).toEqual([]);
      // Skipping a test and exporting from a test file are often done on purpose. The rest are errors.
      const files = JSON.parse(stdout) as { messages: { ruleId: string; severity: number }[] }[];
      const ofBunTest = files.flatMap(it => it.messages).filter(it => it.ruleId.startsWith("bun:test/"));
      expect(ofBunTest.filter(it => it.severity !== 2).map(it => it.ruleId)).toEqual([
        "bun:test/no-disabled-tests",
        "bun:test/no-export",
      ]);
    }
    // A test that is skipped on purpose does not fail the run.
    expect(unix(skipped.stdout)).toEqual(["2 Warning/bun:test/no-disabled-tests"]);
    expect(skipped.exitCode).toBe(0);
  });

  test("a configuration file replaces the defaults", async () => {
    const found = await Promise.all([
      lint({ "eslint.config.mjs": flat({}), "a.test.js": only }, ["-f", "unix", "a.test.js"]),
      lint({ ".eslintrc.json": legacy({}), "a.test.js": only }, ["-f", "unix", "a.test.js"]),
      lint({ ".oxlintrc.json": "{}", "a.test.js": only }, ["-f", "unix", "a.test.js"]),
      // The defaults of oxlint, for a project that depends on it.
      lint({ "package.json": `{ "devDependencies": { "oxlint": "1.87.0" } }`, "a.test.js": only }, ["-f", "unix", "."]),
      lint({ "a.test.js": only }, ["--no-config-lookup", "-f", "unix", "a.test.js"]),
      lint({ "a.test.js": only }, ["-f", "unix", "a.test.js"]),
    ]);
    expect(found.map(it => unix(it.stdout))).toEqual([[], [], [], [], [], ["2 Error/bun:test/no-focused-tests"]]);
    expect(found.map(it => it.exitCode)).toEqual([0, 0, 0, 0, 0, 1]);
  });

  test("no configuration file has to name it", async () => {
    const found = await Promise.all([
      lint({ "eslint.config.mjs": flat({ [name]: "error" }), "a.test.js": only }, ["-f", "unix", "a.test.js"]),
      lint({ ".eslintrc.json": legacy({ [name]: "warn" }), "a.test.js": only }, ["-f", "unix", "a.test.js"]),
      lint({ ".oxlintrc.json": oxlintrc({ [name]: "error" }), "a.test.js": only }, ["-f", "unix", "a.test.js"]),
      lint({ ".oxlintrc.json": JSON.stringify({ plugins: [], rules: { [name]: "warn" } }), "a.test.js": only }, [
        "-f",
        "unix",
        "a.test.js",
      ]),
      lint(
        {
          ".oxlintrc.json": JSON.stringify({ overrides: [{ files: ["*.test.js"], rules: { [name]: "error" } }] }),
          "a.test.js": only,
          "b.js": only,
        },
        ["-f", "unix", "."],
      ),
    ]);
    expect(found.map(it => unix(it.stdout))).toEqual([
      ["2 Error/bun:test/no-focused-tests"],
      ["2 Warning/bun:test/no-focused-tests"],
      ["2 Error/bun:test(no-focused-tests)"],
      ["2 Warning/bun:test(no-focused-tests)"],
      ["2 Error/bun:test(no-focused-tests)"],
    ]);
  });

  test("[lint.rules] of bunfig.toml and the command line", async () => {
    const skipped = `${only}test.skip("b", () => {});\n`;
    const bunfig = `[lint.rules]\n"${name}" = "off"\n"bun:test/no-disabled-tests" = "error"\n`;
    const rule = (text: string) => lint({ "a.test.js": skipped }, ["--rule", text, "-f", "unix", "a.test.js"]);
    const filter = (...args: string[]) =>
      lint({ ".oxlintrc.json": "{}", "a.test.js": only }, [...args, "-f", "unix", "a.test.js"]);
    const found = await Promise.all([
      lint({ "bunfig.toml": bunfig, "a.test.js": skipped }, ["-f", "unix", "a.test.js"]),
      rule(`"${name}": off`),
      // ESLint takes the first colon for the end of the name.
      rule(`${name}: off`),
      rule(`${name}:0,bun:test/no-disabled-tests:[2]`),
      rule(`{"${name}": "off"}`),
      filter("-D", name),
      filter("-W", name),
      filter(`--deny=${name}`),
      filter("-D", name, "-A", name),
      // Without the plugin a name is that of a rule of oxlint.
      filter("-D", "no-focused-tests"),
      filter("-D", "all"),
    ]);
    expect(found.map(it => unix(it.stdout))).toEqual([
      ["3 Error/bun:test/no-disabled-tests"],
      ["3 Warning/bun:test/no-disabled-tests"],
      ["3 Warning/bun:test/no-disabled-tests"],
      ["3 Error/bun:test/no-disabled-tests"],
      ["3 Warning/bun:test/no-disabled-tests"],
      ["2 Error/bun:test(no-focused-tests)"],
      ["2 Warning/bun:test(no-focused-tests)"],
      ["2 Error/bun:test(no-focused-tests)"],
      [],
      [],
      [],
    ]);
  });

  test("neither a category nor a plugin of oxlint turns a rule on, and it is no plugin of an .oxlintrc.json", async () => {
    const all = ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"];
    const categories = Object.fromEntries(all.map(it => [it, "error"]));
    const plugins = ["jest", "vitest"];
    const [everything, andTheRule, named] = await Promise.all([
      lint({ ".oxlintrc.json": JSON.stringify({ plugins, categories }), "a.test.js": only }, [
        "-f",
        "unix",
        "a.test.js",
      ]),
      lint(
        { ".oxlintrc.json": JSON.stringify({ plugins, categories, rules: { [name]: "warn" } }), "a.test.js": only },
        ["-f", "unix", "a.test.js"],
      ),
      lint({ ".oxlintrc.json": JSON.stringify({ plugins: ["bun:test"] }), "a.test.js": only }, ["a.test.js"]),
    ]);
    expect(unix(everything.stdout)).toEqual([]);
    expect(unix(andTheRule.stdout)).toEqual(["2 Warning/bun:test(no-focused-tests)"]);
    expect(named.stdout).toContain("Unknown plugin: 'bun:test'.");
    expect(named.exitCode).toBe(1);
  });

  test("`settings.vitest` doesn't apply to it", async () => {
    const code = `import { describe } from "bun:test";\nimport { add } from "./add";\ndescribe("add", () => {});\ndescribe("", () => {});\n`;
    const config = {
      settings: { vitest: { typecheck: true } },
      rules: { "bun:test/prefer-describe-function-title": 2, "bun:test/valid-title": 2 },
    };
    const { stdout } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.test.ts": code }, ["-f", "unix", "."]);
    expect(unix(stdout)).toEqual(["3 Error/bun:test(prefer-describe-function-title)", "4 Error/bun:test(valid-title)"]);
  });

  test("valid-title prints the pattern exactly as the option spells it", async () => {
    const code = `import { it, test } from "bun:test";\nit("a", () => {});\ntest("b", () => {});\n`;
    const rules = { "bun:test/valid-title": ["error", { mustMatch: { it: "^should ", test: "/^ADDS /i" } }] };
    const { stdout } = await lint({ "eslint.config.mjs": flat(rules), "a.test.js": code }, ["-f", "unix", "."]);
    expect(stdout).toContain(":2:4: it should match ^should  [");
    expect(stdout).toContain(":3:6: test should match /^ADDS /i [");
  });

  test("comments turn a rule off", async () => {
    const code = (prefix: string) => `import { test } from "bun:test";
// ${prefix}-disable-next-line ${name}
test.only("a", () => {});
// ${prefix}-disable-next-line ${name} -- why
test.only("a", () => {});
test.only("a", () => {}); // ${prefix}-disable-line ${name}
test.only("a", () => {}); /* ${prefix}-disable-line no-var, ${name} -- why */
/* ${prefix}-disable ${name}, no-var */
test.only("a", () => {});
/* ${prefix}-enable ${name} */
test.only("a", () => {});
// ${prefix}-disable-next-line bun:test/no-disabled-tests
test.only("a", () => {});
`;
    const found = await Promise.all([
      lint({ "a.test.js": code("eslint") }, ["-f", "unix", "a.test.js"]),
      lint({ "eslint.config.mjs": flat({ [name]: "error" }), "a.test.js": code("eslint") }, [
        "-f",
        "unix",
        "a.test.js",
      ]),
      lint({ ".eslintrc.json": legacy({ [name]: "error" }), "a.test.js": code("eslint") }, ["-f", "unix", "a.test.js"]),
      lint({ ".oxlintrc.json": oxlintrc({ [name]: "error" }), "a.test.js": code("eslint") }, [
        "-f",
        "unix",
        "a.test.js",
      ]),
      lint({ ".oxlintrc.json": oxlintrc({ [name]: "error" }), "a.test.js": code("oxlint") }, [
        "-f",
        "unix",
        "a.test.js",
      ]),
    ]);
    expect(found.map(it => unix(it.stdout).map(it => it.split(" ")[0]))).toEqual(Array(5).fill(["11", "13"]));
  });

  test("comments turn a rule on", async () => {
    const files = Object.fromEntries(
      [
        `"${name}": "error"`,
        // ESLint cannot read these: for it the name ends at the first colon.
        `${name}: "error"`,
        `${name}:2`,
        `no-var: 2, ${name}: [2]`,
        `${name}: 2 -- why`,
        // Without commas it is read as JSON.
        `"${name}": 2 "no-var": 2`,
        `${name}: 2 no-var: 2`,
      ].map((text, index) => [`${index}.test.js`, `/* eslint ${text} */\n${only}`]),
    );
    const { stdout } = await lint({ "eslint.config.mjs": flat({}), ...files }, ["-f", "json", "."]);
    expect(Object.keys(files).map(file => reported(stdout, file))).toEqual(Array(7).fill([`3 ${name}`]));
  });

  test("a comment that disables nothing is reported, and --fix removes the name", async () => {
    const code = `import { test } from "bun:test";
// eslint-disable-next-line ${name}, bun:test/no-disabled-tests -- why
test.only("a", () => {});
/* eslint-disable no-var, ${name}, no-undef */
var a = b;
`;
    const files = { "eslint.config.mjs": flat({ [name]: 2, "no-var": 2, "no-undef": 2 }), "a.test.js": code };
    using dir = tempDir("bun-rules", files);
    const run = async (...args: string[]) => {
      await using proc = spawn({
        cmd: [bunExe(), "lint", "--report-unused-disable-directives", ...args, "a.test.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      return await proc.stdout.text();
    };
    expect(JSON.parse(await run("-f", "json"))[0].messages.map((it: { message: string }) => it.message)).toEqual([
      "Unused eslint-disable directive (no problems were reported from 'bun:test/no-disabled-tests').",
      `Unused eslint-disable directive (no problems were reported from '${name}').`,
    ]);
    await run("--fix");
    expect(await Bun.file(`${dir}/a.test.js`).text()).toBe(
      code.replace(", bun:test/no-disabled-tests", "").replace(`, ${name}, no-undef`, ", no-undef"),
    );
  });

  test("suppressions", async () => {
    for (const [config, text, file] of [
      ["eslint.config.mjs", flat({ [name]: "error" }), "eslint-suppressions.json"],
      [".oxlintrc.json", oxlintrc({ [name]: "error" }), "oxlint-suppressions.json"],
    ]) {
      using dir = tempDir("bun-rules", { [config]: text, "a.test.js": only });
      const run = async (...args: string[]) => {
        await using proc = spawn({
          cmd: [bunExe(), "lint", ...args, "a.test.js"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        return await proc.exited;
      };
      expect(await run()).toBe(1);
      expect(await run("--suppress-rule", name)).toBe(0);
      expect(await Bun.file(`${dir}/${file}`).json()).toEqual({ "a.test.js": { [name]: { count: 1 } } });
      expect(await run()).toBe(0);
    }
  });

  test("every format", async () => {
    const formats = ["stylish", "unix", "json", "github", "checkstyle", "junit", "gitlab", "sarif", "pretty", "agent"];
    const print = (files: Record<string, string>) =>
      Promise.all(formats.map(async format => (await lint(files, ["-f", format, "a.test.js"])).stdout));
    const [plain, oxlint] = await Promise.all([
      print({ "a.test.js": only }),
      print({ ".oxlintrc.json": oxlintrc({ [name]: "error" }), "a.test.js": only }),
    ]);
    /** How the rule is written. */
    const written = (text: string) => [...new Set(text.match(/bun(:|%3A)test[/(]no-focused-tests\)?/g))];
    expect(Object.fromEntries(formats.map((format, index) => [format, written(plain[index])]))).toEqual({
      stylish: ["bun:test/no-focused-tests"],
      unix: ["bun:test/no-focused-tests"],
      json: ["bun:test/no-focused-tests"],
      // A colon ends the name of a property there.
      github: ["bun%3Atest/no-focused-tests"],
      checkstyle: ["bun:test(no-focused-tests)"],
      junit: ["bun:test(no-focused-tests)"],
      gitlab: ["bun:test(no-focused-tests)"],
      sarif: ["bun:test(no-focused-tests)"],
      pretty: ["bun:test/no-focused-tests"],
      agent: ["bun:test/no-focused-tests"],
    });
    expect(Object.fromEntries(formats.map((format, index) => [format, written(oxlint[index])]))).toEqual({
      stylish: ["bun:test(no-focused-tests)"],
      unix: ["bun:test(no-focused-tests)"],
      json: ["bun:test(no-focused-tests)"],
      github: ["bun%3Atest(no-focused-tests)"],
      checkstyle: ["bun:test(no-focused-tests)"],
      junit: ["bun:test(no-focused-tests)"],
      gitlab: ["bun:test(no-focused-tests)"],
      sarif: ["bun:test(no-focused-tests)"],
      pretty: ["bun:test/no-focused-tests"],
      agent: ["bun:test(no-focused-tests)"],
    });
    // There is no page about it at oxc.rs.
    expect(Object.keys(JSON.parse(oxlint[formats.indexOf("json")]).diagnostics[0])).not.toContain("url");
    // What to do about it is said whatever the configuration.
    for (const text of [plain, oxlint].map(it => it[formats.indexOf("pretty")])) {
      expect(text).toContain("Remove focus from test.");
    }
  });

  test("--print-config has the rules and no plugin", async () => {
    const [plain, eslint, oxlint] = await Promise.all([
      lint({ "a.test.js": only }, ["--print-config", "a.test.js"]),
      lint({ "eslint.config.mjs": flat({ [name]: "warn" }), "a.test.js": only }, ["--print-config", "a.test.js"]),
      lint({ ".oxlintrc.json": JSON.stringify({ plugins: [], rules: { [name]: "error" } }), "a.test.js": only }, [
        "--print-config",
      ]),
    ]);
    expect(Object.entries(JSON.parse(plain.stdout).rules).filter(it => it[0].startsWith("bun:test/"))).toEqual([
      ["bun:test/no-disabled-tests", [1]],
      ["bun:test/no-export", [1]],
      ["bun:test/no-focused-tests", [2]],
      ["bun:test/valid-describe-callback", [2]],
      ["bun:test/valid-expect", [2]],
      ["bun:test/valid-expect-in-promise", [2]],
    ]);
    expect(JSON.parse(eslint.stdout).rules).toEqual({ [name]: [1] });
    expect(JSON.parse(eslint.stdout).plugins).toEqual(["@"]);
    expect(JSON.parse(oxlint.stdout).rules[name]).toBe("deny");
    expect(JSON.parse(oxlint.stdout).plugins).toEqual([]);
  });

  test("--rules lists them, without a category", async () => {
    const [json, lines, alone] = await Promise.all([
      lint({ ".oxlintrc.json": "{}" }, ["--rules", "-f", "json"]),
      lint({}, ["--rules"]),
      lint({}, ["--rules", "-f", "json"]),
    ]);
    // `default` is what oxlint turns on without a configuration file, also where some of these rules are on.
    expect(alone.stdout).toBe(json.stdout);
    const listed = (JSON.parse(json.stdout) as Record<string, unknown>[]).filter(it => it.scope === "bun:test");
    expect(listed.map(it => it.value)).toEqual(Object.keys(twins));
    expect([...new Set(listed.map(it => JSON.stringify([it.category, it.default])))]).toEqual(["[null,false]"]);
    expect(listed.map(it => it.docs_url)).toEqual(
      listed.map(it => `https://bun.com/docs/lint/rules/bun-test/${it.value}`),
    );
    expect(lines.stdout.split("\n").filter(it => it.startsWith("bun:test/"))).toEqual(
      Object.keys(twins).map(it => `bun:test/${it}`),
    );
  });

  test("a plugin of the project that is called bun:test hides it", async () => {
    const config = `
      const rule = { create: context => ({ Program: node => context.report({ node, message: "theirs" }) }) };
      export default [{ plugins: { "bun:test": { rules: { "no-focused-tests": rule } } }, rules: { "${name}": "error" } }];`;
    const [theirs, ours] = await Promise.all([
      lint({ "eslint.config.mjs": config, "a.test.js": only }, ["-f", "json", "a.test.js"]),
      lint({ "eslint.config.mjs": flat({ [name]: "error" }), "a.test.js": only }, ["-f", "json", "a.test.js"]),
    ]);
    const messages = (stdout: string) => JSON.parse(stdout)[0].messages.map((it: { message: string }) => it.message);
    expect(messages(theirs.stdout)).toEqual(["theirs"]);
    expect(messages(ours.stdout)).toEqual(["Unexpected focused test."]);
  });

  test("options that a rule does not have are refused, and a rule that does not exist", async () => {
    const check = (rules: unknown) => lint({ "eslint.config.mjs": flat(rules), "a.test.js": only }, ["a.test.js"]);
    const refused = await Promise.all(
      [
        { "bun:test/max-expects": ["error", { nope: 1 }] },
        { "bun:test/max-expects": ["error", { max: "1" }] },
        { "bun:test/prefer-snapshot-hint": ["error", "sometimes"] },
        { "bun:test/valid-title": ["error", { mustMatch: 1 }] },
        // It is about `.snap` files, which import nothing.
        { "bun:test/no-large-snapshots": ["error", { allowedSnapshots: {} }] },
        // Bun has neither `vi.importActual` nor `vi.importMock`.
        { "bun:test/require-mock-type-parameters": ["error", { checkImportFunctions: true }] },
        { [name]: ["error", {}] },
      ].map(async rules => [Object.keys(rules)[0], await check(rules)] as const),
    );
    for (const [id, { stderr, exitCode }] of refused) {
      expect(stderr).toContain(`Key "rules": Key "${id}":`);
      expect(exitCode).toBe(2);
    }
    const taken = await check({
      "bun:test/max-expects": ["error", { max: 1 }],
      "bun:test/prefer-snapshot-hint": ["error", "always"],
      "bun:test/valid-title": [
        "error",
        { mustMatch: { test: "^a" }, mustNotMatch: ["b$", "why"], disallowedWords: ["c"] },
      ],
      "bun:test/no-restricted-matchers": ["error", { toBeFalsy: null, "not.toBe": "why" }],
    });
    expect(taken.stderr).not.toContain("Key");
    expect(taken.exitCode).toBe(0);
    const missing = await check({ "bun:test/no-mocks-import": "error" });
    expect(missing.stderr).toContain("1 rule in eslint.config.mjs is not supported: bun:test/no-mocks-import");
    expect(missing.exitCode).toBe(2);
  });

  test("what is said is not about Jest or Vitest", async () => {
    const code = `import { expect, jest, test } from "bun:test";
test("a", () => {
  return expect(1).toBe(1);
});
test("b", () => {
  expect(1).toMatchInlineSnapshot(\`
    1
    2
  \`);
}, 1000);
test("c", () => {
  expect(typeof jest.fn()).toBe("function");
}, 1000);
`;
    const rules = {
      "bun:test/no-test-return-statement": "error",
      "bun:test/no-large-snapshots": ["error", { inlineMaxSize: 1 }],
      "bun:test/require-test-timeout": "error",
      "bun:test/prefer-expect-type-of": "error",
      "bun:test/require-mock-type-parameters": "error",
    };
    const { stdout } = await lint({ ".oxlintrc.json": oxlintrc(rules), "a.test.ts": code }, [
      "-f",
      "json",
      "a.test.ts",
    ]);
    const said = (JSON.parse(stdout).diagnostics as Record<string, string>[]).map(it => [it.message, it.help, it.note]);
    expect(said).toEqual([
      [
        "Test is missing a timeout.",
        "Add a numeric third argument, a `{ timeout }` option object, or call `setDefaultTimeout(..)` before this test.",
        undefined,
      ],
      [
        "Tests should not return a value",
        "Use `await` for async assertions or remove the return statement.",
        undefined,
      ],
      ["Snapshot is too long.", "Expected snapshot to be no longer than 1 lines but it was 3 lines long", undefined],
      [
        "Type assertions should be done using `toBeTypeOf()`.",
        'Substitute the assertion with `expect(jest.fn()).toBeTypeOf("function")`.',
        undefined,
      ],
      [
        "Missing type parameters on mock function call",
        "Add a type parameter to the mock function, e.g. `jest.fn<() => void>()`.",
        undefined,
      ],
    ]);
  });
});

/** Made-up tests that use what `bun:test` has, in every shape that `bun test` takes. All of them pass. */
const valid = {
  "shapes.test.ts": `import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, test } from "bun:test";

const yes = true;
const no = false;
function add(a: number, b: number) {
  return a + b;
}
class Adder {}
const callback = () => {
  expect(add(1, 2)).toBe(3);
};

// Every shape and order of the arguments.
test("title, callback", () => {
  expect(1).toBe(1);
});
test("title, callback, timeout", () => {
  expect(1).toBe(1);
}, 1000);
test("title, callback, options", () => {
  expect(1).toBe(1);
}, { timeout: 1000, retry: 1 });
test("title, options, callback", { timeout: 1000, repeats: 1 }, () => {
  expect(1).toBe(1);
});
test("title, timeout, callback", 1000, () => {
  expect(1).toBe(1);
});
test(() => {
  expect(1).toBe(1);
});
test(async () => {
  await expect(Promise.resolve(1)).resolves.toBe(1);
});
test(() => {
  expect(1).toBe(1);
}, 1000);
test(() => {
  expect(1).toBe(1);
}, { timeout: 1000 });
test(function named() {
  expect(1).toBe(1);
});
test("a name for the callback", callback);
test("a name for the callback and a timeout", callback, 1000);
test(callback);
test(callback, 1000);
test(callback, { timeout: 1000 });
test.each([1])(callback, 1000);
const limit = 1000;
test(() => {
  expect(1).toBe(1);
}, limit);
test("a name for the timeout", callback, limit);
test("a name for the timeout before the callback", limit, () => {
  expect(1).toBe(1);
});
test(\`a template\`, callback);
test("done", done => {
  done();
});
it("it", callback);

// Every modifier.
test.if(yes)("if", callback);
test.if(no)("if not", callback);
test.skipIf(no)("skipIf", callback);
test.todoIf(no)("todoIf", callback);
test.todoIf(yes)("todoIf without a callback");
test.failing("failing", () => {
  expect(1).toBe(2);
});
test.failingIf(yes)("failingIf", () => {
  expect(1).toBe(2);
});
test.concurrent("concurrent", async () => {
  expect(1).toBe(1);
});
test.concurrentIf(yes)("concurrentIf", async () => {
  expect(1).toBe(1);
});
test.serial("serial", callback);
test.serialIf(yes)("serialIf", callback);
test.todo("todo");
test.todo("todo with a callback", callback);
test.each([1, 2])("each %d", n => {
  expect(n).toBeGreaterThan(0);
});
test.each([
  [1, 2, 3],
  [2, 3, 5],
])("each %d + %d", (a, b, sum) => {
  expect(add(a, b)).toBe(sum);
});
test.each([{ a: 1 }])("each $a", ({ a }) => {
  expect(a).toBe(1);
});
test.each([1])("each with a timeout %d", n => {
  expect(n).toBe(1);
}, 1000);
test.skipIf(no).each([1])("skipIf.each %d", n => {
  expect(n).toBe(1);
});
test.each([1]).if(yes)("each.if %d", n => {
  expect(n).toBe(1);
});
test.concurrent.each([1])("concurrent.each %d", async n => {
  expect(n).toBe(1);
});
test.serial.failing("serial.failing", () => {
  expect(1).toBe(2);
});
const onThisSystem = test.skipIf(no);
onThisSystem("kept in a variable", callback);
const maybe = yes ? test : test.todo;
maybe("chosen", callback);

// \`describe\` takes the same.
describe("title, callback", () => {
  test("a", callback);
});
describe("async", async () => {
  await Promise.resolve();
  test("a", callback);
});
describe("returns something", () => tests());
function tests() {
  test("a", callback);
}
describe(() => {
  test("in a describe without a title", callback);
});
describe(add, () => {
  test("a function as the title", callback);
});
describe(Adder, () => {
  test("a class as the title", callback);
});
describe(1, () => {
  test("a number as the title", callback);
});
describe("a name for the callback", tests);
describe(tests);
describe(tests, 1000);
describe(tests, { timeout: 1000 });
describe("a name for the callback and a timeout", tests, 1000);
describe("options before a name for the callback", { timeout: 1000 }, tests);
describe.if(yes)("if", tests);
describe.skipIf(no)("skipIf", tests);
describe.todoIf(no)("todoIf", tests);
describe.concurrent("concurrent", () => {
  test("a", async () => {
    expect(1).toBe(1);
  });
});
describe.serial("serial", tests);
describe.todo("todo");
describe.todo("todo with a callback", tests);
describe.each([1, 2])("each %d", n => {
  test("a", () => {
    expect(n).toBeGreaterThan(0);
  });
});
describe.each([[1, 2]])("each %d %d", (a, b) => {
  test("a", () => {
    expect(a).toBeLessThan(b);
  });
});

// Hooks.
beforeAll(() => {});
beforeAll(async () => {}, 1000);
beforeEach(() => {}, { timeout: 1000 });
afterEach(done => {
  done();
});
afterAll(callback);
test("onTestFinished", () => {
  onTestFinished(() => {});
  expect(1).toBe(1);
});

// Who imports a type does not run the tests.
export type Callback = typeof callback;
export interface Options {
  timeout: number;
}
export {};
`,
  "expect.test.ts": `import { expect, expectTypeOf, test } from "bun:test";

const why = "why";
const matcher = "toBe" as const;

test("the arguments of expect", () => {
  expect(1).toBe(1);
  expect(1, "why").toBe(1);
  expect(1, why).toBe(1);
  expect(1, \`\${why}\`).toBe(1);
  expect().pass();
  expect().pass("why");
  expect(() => expect().fail()).toThrow();
  expect(() => expect().fail("why")).toThrow("why");
  expect(() => expect.unreachable()).toThrow();
  expect(() => expect.unreachable("why")).toThrow("why");
  expect(1)[matcher](1);
  expect(1)["toBe"](1);
  expect(1).not["toBe"](2);
});

test("modifiers", async () => {
  expect(1).not.toBe(2);
  expect(1).not.not.toBe(1);
  await expect(Promise.resolve(1)).resolves.toBe(1);
  await expect(Promise.resolve(1)).resolves.not.toBe(2);
  await expect(Promise.resolve(1)).not.resolves.toBe(2);
  await expect(Promise.reject(new Error("a"))).rejects.toThrow("a");
  await expect(Promise.reject(1)).rejects.not.toBe(2);
  await expect(Promise.reject(1), "why").rejects.toBe(1);
  await Promise.all([expect(Promise.resolve(1)).resolves.toBe(1), expect(Promise.resolve(2)).resolves.toBe(2)]);
  return expect(Promise.resolve(1)).resolves.toBe(1);
});

test("what is of expect itself", async () => {
  expect.hasAssertions();
  expect.assertions(16);
  expect(1).toEqual(expect.anything());
  expect(1).toEqual(expect.any(Number));
  expect([1, 2]).toEqual(expect.arrayContaining([1]));
  expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }));
  expect("abc").toEqual(expect.stringContaining("b"));
  expect("abc").toEqual(expect.stringMatching(/b/));
  expect(0.1 + 0.2).toEqual(expect.closeTo(0.3));
  expect([1]).toEqual(expect.not.arrayContaining([2]));
  expect({ a: 1 }).toEqual(expect.not.objectContaining({ b: 1 }));
  expect("a").toEqual(expect.not.stringContaining("b"));
  expect("a").toEqual(expect.not.stringMatching(/b/));
  expect({ a: Promise.resolve("1") }).toEqual({ a: expect.resolvesTo.stringContaining("1") });
  expect({ a: Promise.reject("1") }).toEqual({ a: expect.rejectsTo.stringContaining("1") });
  expect([Promise.resolve(1)]).toEqual([expect.resolvesTo.any(Number)]);
  expect(Promise.resolve(1)).toEqual(expect.resolvesTo.anything());
  const containsOne = expect.resolvesTo.stringContaining("1");
  expect({ a: Promise.resolve("1") }).toEqual({ a: containsOne });
});

expect.extend({
  toBeOne(received: unknown) {
    return { pass: received === 1, message: () => "not one" };
  },
});

test("a matcher of one's own", () => {
  (expect(1) as unknown as { toBeOne(): void }).toBeOne();
  expect(1).toEqual((expect as unknown as { toBeOne(): unknown }).toBeOne());
});

test("matchers that Jest has not", () => {
  expect(1).toBeOdd();
  expect(2).toBeEven();
  expect(1).toBeOneOf([1, 2]);
  expect({ a: 1 }).toContainKey("a");
  expect({ a: 1 }).toContainKeys(["a"]);
  expect({ a: 1 }).toContainAllKeys(["a"]);
  expect({ a: 1 }).toContainAnyKeys(["a", "b"]);
  expect({ a: 1 }).toContainValue(1);
  expect({ a: 1 }).toContainValues([1]);
  expect({ a: 1 }).toContainAllValues([1]);
  expect({ a: 1 }).toContainAnyValues([1, 2]);
  expect([]).toBeEmpty();
  expect({}).toBeEmptyObject();
  expect(null).toBeNil();
  expect([]).toBeArray();
  expect([1]).toBeArrayOfSize(1);
  expect(true).toBeBoolean();
  expect(true).toBeTrue();
  expect(false).toBeFalse();
  expect(1).toBeTypeOf("number");
  expect(1).toBeNumber();
  expect(1).toBeInteger();
  expect({}).toBeObject();
  expect(1).toBeFinite();
  expect(1).toBePositive();
  expect(-1).toBeNegative();
  expect(1).toBeWithin(0, 2);
  expect("a b").toEqualIgnoringWhitespace("ab");
  expect(Symbol()).toBeSymbol();
  expect(() => {}).toBeFunction();
  expect(new Date()).toBeDate();
  expect(new Date()).toBeValidDate();
  expect("a").toBeString();
  expect("abc").toInclude("b");
  expect("aa").toIncludeRepeated("a", 2);
  expect(1).toSatisfy(it => it === 1);
  expect("abc").toStartWith("a");
  expect("abc").toEndWith("c");
});

test("errors", () => {
  const fails = () => {
    throw new TypeError("a");
  };
  expect(fails).toThrow();
  expect(fails).toThrow("a");
  expect(fails).toThrow(/a/);
  expect(fails).toThrow(TypeError);
  expect(fails).toThrowError("a");
  expect(() => {}).not.toThrow();
});

test("snapshots", () => {
  expect(1).toMatchInlineSnapshot(\`1\`);
  expect({ a: 1, b: "c" }).toMatchInlineSnapshot(
    { a: expect.any(Number) },
    \`
{
  "a": Any<Number>,
  "b": "c",
}
\`,
  );
  expect(() => {
    throw new Error("a");
  }).toThrowErrorMatchingInlineSnapshot(\`"a"\`);
});

test("types", () => {
  expectTypeOf(1).toBeNumber();
  expectTypeOf<string>().toEqualTypeOf<string>();
  expectTypeOf({ a: 1 }).toHaveProperty("a");
  expectTypeOf(1).not.toBeString();
});

test("promises that are awaited elsewhere", async () => {
  const later = expect(Promise.resolve(1)).resolves.toBe(1);
  await later;
  const all: Promise<void>[] = [];
  all.push(expect(Promise.resolve(1)).resolves.toBe(1));
  await Promise.all(all);
  await Promise.allSettled([expect(Promise.resolve(1)).resolves.toBe(1)]);
  const one = expect(1);
  one.toBe(1);
});

test("returned by an arrow function", () => expect(Promise.resolve(1)).resolves.toBe(1));
`,
  "mocks.test.ts": `import { afterEach, expect, jest, mock, setSystemTime, spyOn, test, vi } from "bun:test";

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

test("mock", async () => {
  const one = mock(() => 1);
  expect(one()).toBe(1);
  expect(one, "it ran").toHaveBeenCalled();
  expect(one, "it ran once").toHaveBeenCalledOnce();
  expect(one, "it ran once").toHaveBeenCalledTimes(1);
  expect(one.mock.calls, "it ran once").toHaveLength(1);
  expect(one).toHaveBeenCalledWith();
  expect(one).toHaveBeenLastCalledWith();
  expect(one).toHaveBeenNthCalledWith(1);
  expect(one).toHaveReturned();
  expect(one).toHaveReturnedTimes(1);
  expect(one).toHaveReturnedWith(1);
  expect(one).toHaveLastReturnedWith(1);
  expect(one).toHaveNthReturnedWith(1, 1);
  expect(one).toBeCalled();
  expect(one).toBeCalledTimes(1);
  expect(one).toBeCalledWith();
  expect(one).lastCalledWith();
  expect(one).nthCalledWith(1);
  const never = mock();
  expect(never, "it did not run").toHaveBeenCalledTimes(0);
  expect(never).not.toHaveBeenCalled();
  const later = mock(async () => 1);
  expect(await later(), "later").toBe(1);
  later.mockResolvedValue(2);
  expect(await later()).toBe(2);
  later.mockImplementation(() => Promise.resolve(3));
  expect(await later()).toBe(3);
  one.mockImplementation(() => 2);
  expect(one()).toBe(2);
  one.mockReturnValue(3);
  expect(one()).toBe(3);
});

test("jest.fn, vi.fn and spies", () => {
  const a = jest.fn();
  const b = vi.fn(() => 1);
  const c = jest.fn<() => number>(() => 1);
  a();
  expect(a).toHaveBeenCalled();
  expect(b()).toBe(1);
  expect(c()).toBe(1);
  const object = { method: () => 1, other: () => 2 };
  const spy = spyOn(object, "method").mockReturnValue(2);
  expect(object.method()).toBe(2);
  expect(spy).toHaveBeenCalledTimes(1);
  jest.spyOn(object, "other").mockImplementation(() => 3);
  expect(object.other()).toBe(3);
  vi.spyOn(object, "other");
  object.other = jest.fn(() => 4);
  expect(object.other()).toBe(4);
});

test("time", () => {
  setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  expect(new Date().getFullYear(), "the year").toBe(2020);
  setSystemTime();
  jest.useFakeTimers();
  const ran = mock();
  setTimeout(ran, 1000);
  jest.advanceTimersByTime(1000);
  expect(ran).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test("lengths, members and comparisons with a message", () => {
  const list = [1, 2];
  expect(list.length, "two").toBe(2);
  expect(list.includes(1), "has one").toBe(true);
  expect(list.length > 1, "more than one").toBe(true);
  expect(list.length === 2, "two").toBe(true);
  expect(typeof list, "an object").toBe("object");
  expect(list[0], "one").toEqual(1);
  expect(undefined, "nothing").toBe(undefined);
  expect(null, "null").toEqual(null);
  expect(true, "true").toBe(true);
  expect(false, "false").toBe(false);
  expect(1, "truthy").toBeTruthy();
  expect(0, "falsy").toBeFalsy();
});
`,
  "promises.test.ts": `import { describe, expect, test } from "bun:test";

const one = () => Promise.resolve(1);

test("awaited", async () => {
  await one().then(it => {
    expect(it).toBe(1);
  });
});
test("returned", () => {
  return one().then(it => {
    expect(it).toBe(1);
  });
});
test("returned by an arrow function", () =>
  one().then(it => {
    expect(it).toBe(1);
  }));
test("kept and awaited", async () => {
  const later = one().then(it => {
    expect(it).toBe(1);
  });
  await later;
});
test("kept and returned", () => {
  const later = one().then(it => {
    expect(it).toBe(1);
  });
  return later;
});
test("in a list", async () => {
  const all = [];
  all.push(
    one().then(it => {
      expect(it).toBe(1);
    }),
  );
  await Promise.all(all);
  await Promise.all([one().then(it => expect(it).toBe(1)), one().then(it => expect(it).toBe(1))]);
});
test("with done", done => {
  one().then(it => {
    expect(it).toBe(1);
    done();
  });
});
test("with options before the callback", { timeout: 1000 }, async () => {
  await one().then(it => {
    expect(it).toBe(1);
  });
});
test("catch and finally", async () => {
  await Promise.reject(new Error("a"))
    .catch(error => {
      expect(error.message).toBe("a");
    })
    .finally(() => {
      expect(1).toBe(1);
    });
});
test("resolves with a chain", async () => {
  await expect(one().then(it => it + 1)).resolves.toBe(2);
});
describe.each([1]).skipIf(false)("each.skipIf %d", n => {
  test("a", () => {
    expect(n).toBe(1);
  });
});
describe("a function expression", function () {
  test("a", () => {
    expect(1).toBe(1);
  });
});
`,
  "rest.test.ts": `import { expect, jest, mock, setDefaultTimeout, test, vi } from "bun:test";

setDefaultTimeout(5000);
jest.setTimeout(5000);

mock.module("./made-up-module", () => ({ one: 1 }));
vi.mock("./another-made-up-module", () => ({ two: 2 }));

test("mocked modules", async () => {
  const { one } = await import("./made-up-module");
  const { two } = await import("./another-made-up-module");
  expect(one + two).toBe(3);
});

test("matchers that Jest has too", () => {
  expect(0.1 + 0.2).toBeCloseTo(0.3);
  expect(0.1 + 0.2).toBeCloseTo(0.3, 5);
  expect({ a: 1 }).toStrictEqual({ a: 1 });
  expect([1, 2]).toContain(1);
  expect("abc").toContain("b");
  expect([{ a: 1 }]).toContainEqual({ a: 1 });
  expect({ a: { b: 1 } }).toHaveProperty("a.b");
  expect({ a: { b: 1 } }).toHaveProperty("a.b", 1);
  expect({ a: { b: 1 } }).toHaveProperty(["a", "b"], 1);
  expect(1).toBeDefined();
  expect(new Date()).toBeInstanceOf(Date);
  expect(undefined).toBeUndefined();
  expect(null).toBeNull();
  expect(NaN).toBeNaN();
  expect(2).toBeGreaterThan(1);
  expect(2).toBeGreaterThanOrEqual(2);
  expect(1).toBeLessThan(2);
  expect(1n).toBeLessThanOrEqual(1n);
  expect("abc").toMatch(/b/);
  expect("abc").toMatch("b");
  expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
  expect([1]).toHaveLength(1);
  expect(1).toBeTruthy();
  expect(0).toBeFalsy();
  expect(0.3).toEqual(expect.not.closeTo(0.5));
  expect({ a: Promise.resolve("1") }).toEqual({ a: expect.not.resolvesTo.stringContaining("2") });
  expect({ a: Promise.reject("1") }).toEqual({ a: expect.not.rejectsTo.stringContaining("2") });
});

test("what a mock has", async () => {
  const a = mock((n: number) => n);
  a.mockName("a");
  expect(a.getMockName()).toBe("a");
  expect(a.getMockImplementation()).toBeFunction();
  a.mockImplementationOnce(() => 2);
  expect(a(1)).toBe(2);
  a.mockReturnValueOnce(3);
  expect(a(1)).toBe(3);
  expect(a(1)).toBe(1);
  a.withImplementation(
    () => 4,
    () => {
      expect(a(1)).toBe(4);
    },
  );
  a.mockClear();
  expect(a).not.toHaveBeenCalled();
  a.mockReset();
  a.mockRestore();
  const b = mock(async () => 1);
  b.mockResolvedValueOnce(2);
  expect(await b()).toBe(2);
  b.mockRejectedValueOnce(new Error("c"));
  await expect(b()).rejects.toThrow("c");
  b.mockRejectedValue(new Error("d"));
  await expect(b()).rejects.toThrow("d");
  const c = { d: mock().mockReturnThis() };
  expect(c.d()).toBe(c);
});

test("what jest and vi have", () => {
  for (const it of [jest, vi]) {
    it.useFakeTimers();
    expect(it.isFakeTimers()).toBe(true);
    const ran = it.fn();
    setTimeout(ran, 10);
    setTimeout(ran, 20);
    setTimeout(ran, 30);
    setTimeout(ran, 40);
    expect(it.getTimerCount()).toBe(4);
    it.advanceTimersByTime(10);
    it.advanceTimersToNextTimer();
    it.runOnlyPendingTimers();
    it.runAllTimers();
    expect(ran).toHaveBeenCalledTimes(4);
    setTimeout(ran, 50);
    it.clearAllTimers();
    it.useRealTimers();
    it.resetAllMocks();
    it.clearAllMocks();
    it.restoreAllMocks();
  }
  jest.useFakeTimers({ now: 0 });
  jest.setSystemTime(1000);
  expect(jest.now()).toBe(1000);
  expect(Date.now()).toBe(1000);
  jest.useRealTimers();
});
`,
  "snapshots.test.ts": `import { describe, expect, test } from "bun:test";

// The snapshots are in a file of their own, where they are found by these titles.
describe("Upper case", () => {
  test("Upper case too", () => {
    expect(1).toMatchSnapshot();
  });
  test(" spaces around ", () => {
    expect({ a: 1, b: "c" }).toMatchSnapshot({ a: expect.any(Number) });
  });
  test("test with its own name first", () => {
    expect(1).toMatchSnapshot("a hint");
    expect({ a: 1 }).toMatchSnapshot({ a: expect.any(Number) }, "another hint");
  });
  test("errors", () => {
    expect(() => {
      throw new Error("a");
    }).toThrowErrorMatchingSnapshot();
    expect(() => {
      throw new Error("b");
    }).toThrowErrorMatchingSnapshot("a hint");
  });
});
`,
  "__snapshots__/snapshots.test.ts.snap": `// Bun Snapshot v1, https://bun.sh/docs/test/snapshots

exports[\`Upper case Upper case too 1\`] = \`1\`;

exports[\`Upper case  spaces around  1\`] = \`
{
  "a": Any<Number>,
  "b": "c",
}
\`;

exports[\`Upper case test with its own name first: a hint 1\`] = \`1\`;

exports[\`Upper case test with its own name first: another hint 1\`] = \`
{
  "a": Any<Number>,
}
\`;

exports[\`Upper case errors 1\`] = \`"a"\`;

exports[\`Upper case errors: a hint 1\`] = \`"b"\`;
`,
};

describe("code that bun test passes", () => {
  // With `CI` a snapshot that is not found is a failure, and is not written.
  async function run(cwd: string, ...cmd: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...cmd],
      env: { ...bunEnv, CI: "1" },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  /** "68 pass", "1 skip", .. */
  const counts = (stderr: string) => stderr.match(/^ *\d+ (pass|skip|todo|fail)$/gm)?.map(it => it.trim());

  test("gets no report without a configuration file", async () => {
    using dir = tempDir("bun-rules", valid);
    const [tests, found] = await Promise.all([run(String(dir), "test"), run(String(dir), "lint", "-f", "unix", ".")]);
    expect(counts(tests.stderr)).toContain("0 fail");
    expect(tests.exitCode).toBe(0);
    expect(found.stdout.trim().split("\n")).toEqual([""]);
    expect(found.exitCode).toBe(0);
  });

  test("still passes after --fix with every rule on, and nothing that was written is gone", async () => {
    using dir = tempDir("bun-rules", valid);
    const before = await run(String(dir), "test");
    const rules = Object.keys(twins).flatMap(it => ["--rule", `bun:test/${it}: error`]);
    await run(String(dir), "lint", "--fix", ...rules, ".");
    const after = await run(String(dir), "test");
    expect(counts(after.stderr)).toEqual(counts(before.stderr));
    expect(after.exitCode).toBe(0);
    for (const [name, text] of Object.entries(valid)) {
      const fixed = await Bun.file(`${dir}/${name}`).text();
      if (name === "shapes.test.ts") expect(fixed).not.toBe(text);
      // The messages of `expect`, the titles, the timeouts and the options.
      const kept = (text: string) =>
        (text.match(/"[^"\n]*"|\b1000\b|\{ (timeout|retry|repeats)[^}]*\}/g) ?? []).toSorted();
      expect(kept(fixed)).toEqual(kept(text));
    }
  });
});
