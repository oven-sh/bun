import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isLinux, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";
import { env as plainOutput } from "./differential";

afterAll(endChildren);

// A content mapper is a program from a package that turns a file TypeScript can't read into TypeScript. The mappers here
// are small scripts that Bun runs. Unless a comment says otherwise, the expected output is what `tsc` 7.1 prints for the
// same project.

const env = {
  ...plainOutput,
  GITHUB_WORKSPACE: undefined,
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  BUN_INTERNAL_SCRIPTS_OF_COMMANDS: undefined,
  BUN_INTERNAL_CHECK_SCRIPTS: undefined,
};

// What every mapper starts with. `serve` answers each request with the result of its handler, or with nothing if that's
// `SKIP`. By default a file maps to the text between `<script>` and `</script>`.
const prelude = String.raw`
const fs = require("fs");
const SKIP = Symbol();
const frame = message => {
  const body = Buffer.from(typeof message === "string" ? message : JSON.stringify(message));
  return Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body]);
};
const raw = (bytes, written) => process.stdout.write(bytes, written);
const send = (message, written) => raw(frame({ jsonrpc: "2.0", ...message }), written);
const script = content => {
  const bytes = Buffer.from(content);
  const start = bytes.indexOf("<script>") + 8, end = bytes.indexOf("</script>");
  return { text: bytes.subarray(start, end).toString(), extension: ".ts", mappings: [[0, end - start, start, end - start, 0]] };
};
const defaults = {
  initialize: () => ({ positionEncoding: "utf-8", diagnosticSource: "m" }),
  openProject: () => ({}),
  closeProject: () => null,
  transform: ({ content }) => script(content),
};
function serve(handlers = {}) {
  handlers = { ...defaults, ...handlers };
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const header = buffer.indexOf("\r\n\r\n");
      if (header < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, header).toString())[1]);
      if (buffer.length < header + 4 + length) return;
      const message = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString());
      buffer = buffer.subarray(header + 4 + length);
      if (!message.method) continue;
      const result = handlers[message.method](message.params, message.id);
      if (result !== SKIP) send({ id: message.id, result });
    }
  });
}
`;

const app = `<template>
  <p>hi</p>
</template>
<script>
export const count: number = "one";
export function greet(name: string) { return name; }
</script>
`;

const main = `import { greet, count } from "./App.vue";
greet(count);
`;

const errorsOfApp = `App.vue(5,14): error TS2322: Type 'string' is not assignable to type 'number'.
main.ts(2,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.`;

type Project = {
  /** The mapper's code after `prelude`. */
  mapper: string;
  files?: Record<string, string>;
  /** Replaces properties of `tsconfig.json`. */
  config?: object;
  compilerOptions?: object;
  /** `typescript.contentMapper` in the package's `package.json`. */
  manifest?: object;
};

function project({ mapper, files, config, compilerOptions, manifest }: Project) {
  return tempDir("bun-check-mappers", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "esnext",
        moduleResolution: "bundler",
        lib: ["esnext"],
        types: [],
        ...compilerOptions,
      },
      contentMappers: [{ package: "m", extensions: [".vue"] }],
      include: ["*.ts", "*.vue"],
      ...config,
    }),
    "node_modules/m/package.json": JSON.stringify({
      name: "m",
      version: "1.0.0",
      typescript: { contentMapper: { exec: [bunExe(), "mapper.js"], ...manifest } },
    }),
    "node_modules/m/mapper.js": prelude + mapper,
    "App.vue": app,
    "main.ts": main,
    ...files,
  });
}

async function check(dir: { toString(): string }, args: string[], extra: Record<string, string | undefined> = {}) {
  await using proc = spawn({
    cmd: [bunExe(), "check", "--no-pretty", ...args],
    cwd: String(dir),
    env: { ...env, ...extra },
    timeout: longLimit,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.replaceAll("\\", "/").trim(), stderr, exitCode };
}

/** Checks the project with `--runExternalCode`. */
async function expectErrors(options: Project, errors: string) {
  using dir = project(options);
  const { stdout, exitCode } = await check(dir, ["--runExternalCode"]);
  expect(stdout).toBe(errors);
  expect(exitCode).toBe(errors ? 1 : 0);
}

/** A mapper whose `transform` changes `r`, the default result. */
const changed = (body: string) =>
  `serve({ transform: params => { const r = script(params.content); ${body}; return r; } });`;

const failed = (why: string) => `App.vue(1,1): error TS18069: The content mapper 'm' failed to transform this file.
  ${why}`;
const invalidResponse = failed("The content mapper returned an invalid transform response.");
const requestFailed = failed("The content mapper process failed while handling the transform request.");
const notInitialized = (why: string) => `error TS18099: The content mapper 'm' could not be initialized.
  ${why}`;
const isVirtual =
  "  This location is in virtual code produced by the content mapper 'm@1.0.0' and has no corresponding location in the original file.";

describe.concurrent("a content mapper", () => {
  test("errors are reported where they are in the original file", async () => {
    await expectErrors({ mapper: `serve();` }, errorsOfApp);
  });

  test("a project without errors", async () => {
    await expectErrors(
      { mapper: `serve();`, files: { "App.vue": app.replace(`"one"`, "1"), "main.ts": `import "./App.vue";\n` } },
      "",
    );
  });

  const notAscii = `<template>😀 日本語 é</template>
<script>
export const s = "😀日本"; export const count: number = "one";
export function greet(name: string) { return name; }
</script>
`;
  const errorsOfNotAscii = errorsOfApp.replace("(5,14)", "(3,39)");

  test("offsets in UTF-8", async () => {
    await expectErrors({ mapper: `serve();`, files: { "App.vue": notAscii } }, errorsOfNotAscii);
  });

  test("offsets in UTF-16", async () => {
    const mapper = `serve({
      initialize: () => ({ positionEncoding: "utf-16", diagnosticSource: "m" }),
      transform: ({ content }) => {
        const start = content.indexOf("<script>") + 8, end = content.indexOf("</script>");
        return { text: content.slice(start, end), extension: ".ts", mappings: [[0, end - start, start, end - start, 0]] };
      },
    });`;
    await expectErrors({ mapper, files: { "App.vue": notAscii } }, errorsOfNotAscii);
  });

  test("a byte order mark and CRLF", async () => {
    await expectErrors({ mapper: `serve();`, files: { "App.vue": "﻿" + app.replaceAll("\n", "\r\n") } }, errorsOfApp);
  });

  test("an error in text that the mapper made up", async () => {
    const mapper = `serve({ transform: () => ({
      text: "const generated: number = 'x';\\nexport const count = 1; export function greet(n: string) { return n; }\\n",
      extension: ".ts",
    }) });`;
    await expectErrors(
      { mapper },
      `App.vue(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
${isVirtual}
main.ts(2,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.`,
    );
  });

  test("spans that correspond as a whole", async () => {
    const mapper = `serve({ transform: ({ content }) => {
      const text = "export const myCount: number = 'x';\\nexport const other: string = myCount;\\n";
      return { text, extension: ".ts", mappings: [
        [13, 7, content.indexOf("my-count"), 8, 2],
        [text.indexOf("other"), 5, content.indexOf("zzz"), 3, 1],
      ] };
    } });`;
    await expectErrors(
      { mapper, files: { "App.vue": `<a my-count zzz />\n`, "main.ts": `import "./App.vue";\n` } },
      `App.vue(1,4): error TS2322: Type 'string' is not assignable to type 'number'.
App.vue(1,13): error TS2322: Type 'number' is not assignable to type 'string'.`,
    );
  });

  test("the mapper's own errors", async () => {
    await expectErrors(
      { mapper: changed(`r.diagnostics = [{ start: 1, length: 8, messageText: "bad template", code: 7 }]`) },
      `App.vue(1,2): error m7: bad template`,
    );
  });

  test("directives that ignore and expect errors", async () => {
    const mapper = `serve({ transform: ({ content }) => {
      const r = script(content);
      const line = n => {
        let at = 0;
        for (let i = 0; i < n; i++) at = r.text.indexOf("\\n", at) + 1;
        return [at, r.text.indexOf("\\n", at)];
      };
      r.diagnosticDirectives = {
        unusedExpectDirectiveDiagnostics: [{ code: 55, messageText: "unused expect" }],
        directives: [[0, 15, ...line(1), 0], [16, 15, ...line(2), 1, 0], [32, 22, ...line(3), 1, 0]],
      };
      return r;
    } });`;
    const file = `<!-- ignore -->
<!-- expect -->
<!-- expect unused -->
<script>
export const a: number = "one";
export const b: number = "two";
export const c: number = 3;
</script>
`;
    await expectErrors(
      { mapper, files: { "App.vue": file, "main.ts": `import "./App.vue";\n` } },
      `App.vue(3,1): error m55: unused expect`,
    );
  });

  test("supplemental files", async () => {
    const mapper = changed(`
      r.supplemental = [{ text: "declare const fromSupplemental: number;\\nconst wrong: string = 1;\\n", extension: ".ts" }];
      r.text += "export const viaGlobal: string = fromSupplemental;\\n"`);
    await expectErrors(
      { mapper },
      `App.vue(5,14): error TS2322: Type 'string' is not assignable to type 'number'.
App.vue(4,14): error TS2322: Type 'number' is not assignable to type 'string'.
${isVirtual}
App.vue(2,7): error TS2322: Type 'number' is not assignable to type 'string'.
${isVirtual}
main.ts(2,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.`,
    );
  });

  test("options reach the mapper", async () => {
    const mapper = `let options;
    serve({
      openProject: params => { options = params.options; return {}; },
      transform: () => ({ text: "export const count: " + options.type + " = 'x';\\n", extension: ".ts" }),
    });`;
    await expectErrors(
      {
        mapper,
        config: { contentMappers: [{ package: "m", extensions: [".vue"], options: { type: "boolean" } }] },
        files: { "main.ts": `import "./App.vue";\n` },
      },
      `App.vue(1,14): error TS2322: Type 'string' is not assignable to type 'boolean'.
${isVirtual}`,
    );
  });

  test("compiler options reach the mapper as numbers and as the names of lib files", async () => {
    const mapper = `let seen;
    serve({
      openProject: ({ compilerOptions: o }) => {
        seen = [...o.lib, o.jsx, o.moduleDetection, o.module, o.moduleResolution, o.target, o.newLine].join(" ");
        return {};
      },
      transform: () => ({ text: "export const count: " + JSON.stringify(seen) + " = 0;\\n", extension: ".ts" }),
    });`;
    await expectErrors(
      {
        mapper,
        compilerOptions: {
          lib: ["es6", "ES7", "esnext.array", "esnext.collection", "dom", "es2022"],
          jsx: "react",
          moduleDetection: "legacy",
          target: "es2022",
          newLine: "lf",
        },
        files: { "main.ts": `import "./App.vue";\n` },
      },
      `App.vue(1,14): error TS2322: Type '0' is not assignable to type '"lib.es2015.d.ts lib.es2016.d.ts lib.es2026.array.d.ts lib.es2026.collection.d.ts lib.dom.d.ts lib.es2022.d.ts 2 2 99 100 9 2"'.
${isVirtual}`,
    );
  });

  const withoutErrors = { "App.vue": app.replace(`"one"`, "1"), "main.ts": `import "./App.vue";\n` };

  /** Returns the column at which `text` begins in the project's `tsconfig.json`, which is one line. */
  const columnOf = async (dir: { toString(): string }, text: string) =>
    (await Bun.file(join(String(dir), "tsconfig.json")).text()).indexOf(text) + 1;

  describe("errors about its options", () => {
    const mapper = `serve({ openProject: () => ({ optionDiagnostics: [{ path: ["x"], messageText: "bad x", code: 3 }] }) });`;
    const entry = { package: "m", extensions: [".vue"], options: { x: 1 } };

    test("are reported at the option", async () => {
      using dir = project({ mapper, files: withoutErrors, config: { contentMappers: [entry] } });
      const { stdout } = await check(dir, ["--runExternalCode"]);
      expect(stdout).toBe(`tsconfig.json(1,${(await columnOf(dir, `"x":1`)) + 4}): error m3: bad x`);
    });

    // `tsc` counts the mappers that are left, and then counts that far in the list as it's written.
    test("are reported at another entry if an entry before it is dropped", async () => {
      const dropped = { package: "gone", extensions: [".a"], options: { x: 0 } };
      using dir = project({ mapper, files: withoutErrors, config: { contentMappers: [dropped, entry] } });
      const { stdout } = await check(dir, ["--runExternalCode"]);
      expect(stdout).toBe(
        `tsconfig.json(1,${await columnOf(dir, `"gone"`)}): error TS18075: The content mapper package 'gone' could not be resolved.
tsconfig.json(1,${(await columnOf(dir, `"x":0`)) + 4}): error m3: bad x`,
      );
    });
  });

  describe("the package's outputExtensions", () => {
    const manifest = { outputExtensions: { ".vue": ".js" } };
    const run = async (entry: object) => {
      const contentMappers = [{ package: "m", extensions: [".vue"], ...entry }];
      using dir = project({ mapper: `serve();`, files: withoutErrors, manifest, config: { contentMappers } });
      const { stdout } = await check(dir, ["--runExternalCode"]);
      return stdout.replace(/\(1,\d+\)/, "");
    };
    const needsRewrite = (target: string) =>
      `tsconfig.json: error TS18120: Content mapper output extension mapping from '.vue' to '${target}' requires 'rewriteRelativeImportExtensions' to be enabled.`;

    test("apply if tsconfig.json has none", async () => {
      expect(await run({})).toBe(needsRewrite(".js"));
    });

    test("are replaced by those in tsconfig.json", async () => {
      expect(await run({ outputExtensions: { ".vue": ".mjs" } })).toBe(needsRewrite(".mjs"));
    });

    test.each([null, {}])("are turned off by %j in tsconfig.json", async outputExtensions => {
      expect(await run({ outputExtensions })).toBe("");
    });
  });

  test("two entries with the same package share a process", async () => {
    using dir = project({
      mapper: `fs.appendFileSync(__dirname + "/started.txt", "x"); serve();`,
      config: {
        contentMappers: [
          { package: "m", extensions: [".vue"] },
          { package: "m", extensions: [".sv"] },
        ],
        include: ["*.ts", "*.vue", "*.sv"],
      },
      files: { "B.sv": app },
    });
    const { stdout } = await check(dir, ["--runExternalCode"]);
    expect(stdout).toBe(
      `App.vue(5,14): error TS2322: Type 'string' is not assignable to type 'number'.
B.sv(5,14): error TS2322: Type 'string' is not assignable to type 'number'.
main.ts(2,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.`,
    );
    expect(await Bun.file(join(String(dir), "node_modules/m/started.txt")).text()).toBe("x");
  });

  test("it runs in its package's directory, and its standard error is shown", async () => {
    using dir = project({
      mapper: `fs.writeSync(2, "cwd=" + require("path").basename(process.cwd()) + "\\n"); serve();`,
    });
    const { stdout, stderr } = await check(dir, ["--runExternalCode"]);
    expect(stderr).toContain("cwd=m\n");
    expect(stdout).toBe(errorsOfApp);
  });

  test("it has exited when the check ends", async () => {
    using dir = project({ mapper: `fs.writeFileSync(__dirname + "/pid.txt", String(process.pid)); serve();` });
    const { stdout } = await check(dir, ["--runExternalCode"]);
    expect(stdout).toBe(errorsOfApp);
    const pid = Number(await Bun.file(join(String(dir), "node_modules/m/pid.txt")).text());
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("a file larger than a pipe's buffer", async () => {
    const lines = 200_000;
    const comments = Buffer.alloc(lines * 13, "// a comment\n").toString();
    await expectErrors(
      { mapper: `serve();`, files: { "App.vue": app.replace("<script>\n", "<script>\n" + comments) } },
      errorsOfApp.replace("(5,14)", `(${5 + lines},14)`),
    );
  });
});

describe.concurrent("a mapper that doesn't follow the protocol", () => {
  // `tsc` reports one of three errors here, depending on which of its threads is first.
  test.each([
    ["text that isn't a header", `raw("hello world\\n\\n\\n"); serve();`, `jsonrpc: invalid header: "hello world/n"`],
    ["a header without a length", `raw("X-Thing: 1\\r\\n\\r\\n{}"); serve();`, "jsonrpc: no content length"],
    [
      "a negative length",
      `raw("Content-Length: -5\\r\\n\\r\\n{}"); serve();`,
      "jsonrpc: invalid content length: negative value -5",
    ],
    [
      "a length that isn't a number",
      `raw("Content-Length: abc\\r\\n\\r\\n{}"); serve();`,
      `jsonrpc: invalid content length: parse error: strconv.ParseInt: parsing "abc": invalid syntax`,
    ],
    // For these, `tsc` prints an error of Go's JSON decoder.
    [
      "a message that isn't JSON",
      `serve({ initialize: () => { raw(frame("{nope")); return SKIP; } });`,
      "jsonrpc: invalid message",
    ],
    [
      "a message that isn't an object",
      `serve({ initialize: () => { raw(frame("[1,2]")); return SKIP; } });`,
      "jsonrpc: invalid message",
    ],
    [
      "another version of JSON-RPC",
      `serve({ initialize: (params, id) => { raw(frame({ jsonrpc: "1.0", id, result: defaults.initialize() })); return SKIP; } });`,
      "jsonrpc: invalid message",
    ],
  ])("%s", async (_, mapper, why) => {
    await expectErrors(
      { mapper },
      notInitialized(`The content mapper's 'initialize' request failed: ipc: connection closed\n${why}`),
    );
  });

  test("a length that never arrives", async () => {
    await expectErrors(
      { mapper: `raw("Content-Length: 1000000000000000000\\r\\n\\r\\n{}", () => process.exit(0));` },
      notInitialized("The content mapper process exited before responding to the 'initialize' request (exit code 0)."),
    );
  });

  test("answers that nothing asked for are dropped", async () => {
    const mapper = `send({ method: "log", params: {} });
    send({ id: 99, method: "ask", params: {} });
    serve({ transform: (params, id) => {
      send({ id: "nope", result: { text: "wrong", extension: ".ts" } });
      send({ id: 7, result: null });
      send({ id, result: script(params.content) });
      send({ id, result: { text: "export {}", extension: ".ts" } });
      return SKIP;
    } });`;
    await expectErrors({ mapper }, errorsOfApp);
  });

  test("only answers with the wrong id, then exits", async () => {
    const mapper = `serve({ initialize: () => {
      send({ id: "nope", result: defaults.initialize() }, () => process.exit(0));
      return SKIP;
    } });`;
    await expectErrors(
      { mapper },
      notInitialized("The content mapper process exited before responding to the 'initialize' request (exit code 0)."),
    );
  });

  test.each([
    ["initialize", notInitialized("The content mapper's 'initialize' request failed: ipc: remote error [-1]: no")],
    ["openProject", failed("The content mapper process failed while handling the project request.")],
    ["transform", requestFailed],
  ])("answers %s with an error", async (method, errors) => {
    const mapper = `serve({ ${method}: (params, id) => { send({ id, error: { code: -1, message: "no" } }); return SKIP; } });`;
    await expectErrors({ mapper }, errors);
  });

  test("a message with the same name twice", async () => {
    const mapper = `serve({ transform: (params, id) => {
      raw(frame('{"jsonrpc":"2.0","id":"' + id + '","result":{"text":"","text":"export {}","extension":".ts"}}'));
      return SKIP;
    } });`;
    await expectErrors({ mapper }, requestFailed);
  });

  test("a message that's nested too deeply", async () => {
    const mapper = `serve({ transform: (params, id) => {
      const deep = Buffer.alloc(2000000, "[").toString() + Buffer.alloc(2000000, "]").toString();
      raw(frame('{"jsonrpc":"2.0","id":"' + id + '","result":{"text":"","extension":".ts","x":' + deep + '}}'));
      return SKIP;
    } });`;
    await expectErrors({ mapper }, requestFailed);
  });

  test("an unknown position encoding", async () => {
    await expectErrors(
      { mapper: `serve({ initialize: () => ({ positionEncoding: "utf-32", diagnosticSource: "m" }) });` },
      notInitialized("The content mapper selected unsupported position encoding 'utf-32'."),
    );
  });

  test.each([
    ["a huge offset", "[0, 5, 2000000000, 5, 0]", invalidResponse],
    ["an offset that isn't an int32", "[0, 5, 3000000000, 5, 0]", invalidResponse],
    ["a negative offset", "[-1, 5, 0, 5, 0]", invalidResponse],
    ["a negative length", "[0, -5, 0, 5, 0]", invalidResponse],
    ["a fraction", "[0.5, 5, 0, 5, 0]", invalidResponse],
    ["a string", `["0", 5, 0, 5, 0]`, invalidResponse],
    ["too few numbers", "[0, 5, 0, 5]", invalidResponse],
    ["too many numbers", "[0, 5, 0, 5, 0, 1, 2]", invalidResponse],
    ["past the end of the new text", "[0, 100000, 0, 5, 1]", invalidResponse],
    ["past the end of the original text", "[0, 5, 0, 100000, 1]", invalidResponse],
    [
      "an unknown kind",
      "[0, 5, 0, 5, 9]",
      "App.vue(1,1): error TS18083: The content mapper 'm' produced a position mapping with an invalid kind (near virtual offset 0).",
    ],
    [
      "verbatim, but the texts differ",
      "[0, 5, 0, 5, 0]",
      "App.vue(1,1): error TS18073: The content mapper 'm' produced a verbatim mapping that does not match the original content (virtual offset 0, original offset 0).",
    ],
  ])("a mapping with %s", async (_, tuple, errors) => {
    await expectErrors({ mapper: changed(`r.mappings = [${tuple}]`) }, errors);
  });

  test("mappings that overlap", async () => {
    await expectErrors(
      { mapper: changed(`const at = r.mappings[0][2]; r.mappings = [[0, 10, at, 10, 0], [5, 10, at + 5, 10, 0]]`) },
      "App.vue(1,1): error TS18081: The content mapper 'm' produced overlapping or out-of-order position mappings (near virtual offset 5).",
    );
  });

  test("an offset in the middle of a character", async () => {
    const utf8 = `serve({ transform: () => ({ text: "export const é = 1;", extension: ".ts", mappings: [[14, 1, 1, 1, 1]] }) });`;
    await expectErrors({ mapper: utf8, files: { "App.vue": "é é\n" } }, invalidResponse);
    const utf16 = `serve({
      initialize: () => ({ positionEncoding: "utf-16", diagnosticSource: "m" }),
      transform: () => ({ text: "export const a = '😀';", extension: ".ts", mappings: [[18, 1, 1, 1, 1]] }),
    });`;
    await expectErrors({ mapper: utf16, files: { "App.vue": "😀😀\n" } }, invalidResponse);
  });

  test.each([".exe", "ts", ".d.ts", "", ".TS"])("the extension %j", async extension => {
    await expectErrors(
      { mapper: changed(`r.extension = ${JSON.stringify(extension)}`) },
      failed(`The content mapper returned an output with unsupported virtual extension '${extension}'.`),
    );
  });

  test("after five files it isn't used again", async () => {
    const files: Record<string, string> = { "main.ts": "export {};\n" };
    for (let i = 0; i < 8; i++) files[`F${i}.vue`] = app;
    using dir = project({ mapper: changed(`r.extension = ".exe"`), files });
    // Which five depends on the order in which the answers arrive, as in `tsc`.
    const { stdout, exitCode } = await check(dir, ["--runExternalCode"]);
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("error TS18070: The content mapper 'm' failed 5 times and will not be used.");
    expect(lines.filter(line => line.includes("TS18069")).length).toBe(5);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("a mapper's process", () => {
  test.each([0, 3])("exits with code %d at once", async code => {
    await expectErrors(
      { mapper: `process.exit(${code});` },
      notInitialized(
        `The content mapper process exited before responding to the 'initialize' request (exit code ${code}).`,
      ),
    );
  });

  test.each([
    ["exits", `process.exit(3)`],
    ["throws", `throw new Error("expected by the test")`],
    [
      "exits after half an answer",
      `fs.writeSync(1, frame({ jsonrpc: "2.0", id, result: script(params.content) }).subarray(0, 40)); process.exit(0)`,
    ],
  ])("%s in the middle of a request", async (_, body) => {
    await expectErrors({ mapper: `serve({ transform: (params, id) => { ${body}; } });` }, requestFailed);
  });

  test("is killed in the middle of a request", async () => {
    await expectErrors({ mapper: `serve({ transform: () => process.kill(process.pid, "SIGKILL") });` }, requestFailed);
  });

  test("never answers the first request", async () => {
    using dir = project({ mapper: `setInterval(() => {}, 1000);` });
    // The limit is five seconds, as in `tsc`.
    const { stdout } = await check(dir, ["--runExternalCode"], { BUN_DEBUG_TEST_CONTENT_MAPPER_TIMEOUT_MS: "1" });
    expect(stdout).toBe(
      notInitialized("The content mapper did not respond to the 'initialize' request within 5 seconds."),
    );
  });

  // The second mapper answers once the process of the first one is gone, so this never ends if that process is only
  // killed at the end of the check.
  test("is killed as soon as the first request has failed", async () => {
    const first = `fs.writeFileSync(__dirname + "/pid.txt", String(process.pid));
    serve({ initialize: () => ({ positionEncoding: "utf-32", diagnosticSource: "a" }) });`;
    const second = `serve({ transform: (params, id) => {
      const wait = () => {
        try {
          process.kill(Number(fs.readFileSync(__dirname + "/../a/pid.txt", "utf8")), 0);
        } catch (error) {
          if (error.code === "ESRCH") return send({ id, result: script(params.content) });
        }
        setTimeout(wait, 5);
      };
      wait();
      return SKIP;
    } });`;
    await expectErrors(
      {
        mapper: second,
        config: {
          contentMappers: [
            { package: "a", extensions: [".aa"] },
            { package: "m", extensions: [".vue"] },
          ],
          files: ["A.aa", "App.vue"],
          include: undefined,
        },
        files: {
          "node_modules/a/package.json": JSON.stringify({
            name: "a",
            version: "1.0.0",
            typescript: { contentMapper: { exec: [bunExe(), "mapper.js"] } },
          }),
          "node_modules/a/mapper.js": prelude + first,
          "A.aa": app,
        },
      },
      `error TS18099: The content mapper 'a' could not be initialized.
  The content mapper selected unsupported position encoding 'utf-32'.`,
    );
  });

  // `tsc` prints the errors and then waits forever.
  test("never answers the last request", async () => {
    await expectErrors({ mapper: `serve({ closeProject: () => SKIP });` }, errorsOfApp);
  });

  test("writes a lot to standard error", async () => {
    // The mapper is killed when the check ends, so it only answers once all of it is written.
    using dir = project({ mapper: `process.stderr.write(Buffer.alloc(1 << 20, "e"), () => serve());` });
    const { stdout, stderr } = await check(dir, ["--runExternalCode"]);
    expect(stderr.length).toBeGreaterThan(1 << 20);
    expect(stdout).toBe(errorsOfApp);
  });

  test("a command that doesn't exist", async () => {
    await expectErrors(
      { mapper: `serve();`, manifest: { exec: ["does-not-exist-anywhere"] } },
      notInitialized(
        `The content mapper command 'does-not-exist-anywhere' could not be started: exec: "does-not-exist-anywhere": executable file not found in ${isWindows ? "%PATH%" : "$PATH"}`,
      ),
    );
    await expectErrors(
      { mapper: `serve();`, manifest: { exec: ["./nope/x"] } },
      notInitialized(
        `The content mapper command './nope/x' could not be started: fork/exec ./nope/x: no such file or directory`,
      ),
    );
  });

  test("`node` is Bun if there's no `node` in $PATH", async () => {
    using dir = project({ mapper: `serve();`, manifest: { exec: ["node", "mapper.js"] } });
    const { stdout } = await check(dir, ["--runExternalCode"], { PATH: String(dir), Path: undefined });
    expect(stdout).toBe(errorsOfApp);
  });

  test("arguments are passed as they are, without a shell", async () => {
    const marker = "$(touch shell-ran.txt); `touch shell-ran.txt` && touch shell-ran.txt";
    using dir = project({
      mapper: `if (process.argv[2] !== ${JSON.stringify(marker)}) process.exit(9); serve();`,
      manifest: { exec: [bunExe(), "mapper.js", marker] },
    });
    const { stdout } = await check(dir, ["--runExternalCode"]);
    expect(stdout).toBe(errorsOfApp);
    expect(existsSync(join(String(dir), "node_modules/m/shell-ran.txt"))).toBe(false);
  });
});

describe.concurrent("nothing starts without --runExternalCode on the command line", () => {
  const started = `fs.writeFileSync(__dirname + "/started.txt", "x"); serve();`;
  const notAllowed = (line: number) =>
    `main.ts(1,30): error TS2307: Cannot find module './App.vue' or its corresponding type declarations.
tsconfig.json(${line}): error TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.`;

  async function expectNotStarted(
    options: Omit<Project, "mapper">,
    args: string[],
    extra: Record<string, string> = {},
    cmd = ["check", "--no-pretty"],
  ) {
    using dir = project({ mapper: started, ...options });
    await using proc = spawn({
      cmd: [bunExe(), ...cmd, ...args],
      cwd: String(dir),
      env: { ...env, ...extra },
      timeout: longLimit,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(existsSync(join(String(dir), "node_modules/m/started.txt"))).toBe(false);
    return stdout
      .replaceAll("\\", "/")
      .replace(/tsconfig\.json\(\d+,\d+\)/g, "tsconfig.json")
      .trim();
  }
  const withoutPlace = notAllowed(0).replace("(0)", "");

  test("the control: with the flag, it starts", async () => {
    using dir = project({ mapper: started });
    await check(dir, ["--runExternalCode"]);
    expect(existsSync(join(String(dir), "node_modules/m/started.txt"))).toBe(true);
  });

  test("no flag", async () => {
    expect(await expectNotStarted({}, [])).toBe(withoutPlace);
  });

  test("--runExternalCode false", async () => {
    expect(await expectNotStarted({}, ["--runExternalCode", "false"])).toBe(withoutPlace);
    expect(await expectNotStarted({}, ["--runExternalCode=false"])).toBe(withoutPlace);
  });

  test("in tsconfig.json", async () => {
    expect(await expectNotStarted({ compilerOptions: { runExternalCode: true } }, [])).toBe(
      `main.ts(1,30): error TS2307: Cannot find module './App.vue' or its corresponding type declarations.
tsconfig.json: error TS6266: Option 'runExternalCode' can only be specified on command line.
tsconfig.json: error TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.`,
    );
  });

  test("in a tsconfig.json that's extended", async () => {
    const files = { "base.json": `{ "compilerOptions": { "runExternalCode": true } }` };
    expect(await expectNotStarted({ config: { extends: "./base.json" }, files }, [])).toBe(
      `base.json(1,24): error TS6266: Option 'runExternalCode' can only be specified on command line.
${withoutPlace}`,
    );
  });

  // These have no counterpart in `tsc`, or `tsc` accepts them.
  test("in BUN_OPTIONS", async () => {
    expect(await expectNotStarted({}, [], { BUN_OPTIONS: "--runExternalCode" })).toBe(withoutPlace);
    await expectNotStarted({}, [], { BUN_OPTIONS: "check --runExternalCode" });
  });

  test.each(["--env-file", "--preload", "--define"])("in BUN_OPTIONS, after `check` as the value of %s", async flag => {
    // `check`, as it's typed, is then also a path to check.
    const files = { "check/x.ts": `import "../App.vue";\n` };
    const stdout = await expectNotStarted({ files }, [], { BUN_OPTIONS: `${flag} check --runExternalCode` });
    expect(stdout).toContain("error TS18068");
  });

  test("typed, with `check` in BUN_OPTIONS, it counts", async () => {
    using dir = project({ mapper: started });
    await using proc = spawn({
      cmd: [bunExe(), "--runExternalCode", "--no-pretty"],
      cwd: String(dir),
      env: { ...env, BUN_OPTIONS: "check" },
      timeout: longLimit,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The mapper gets the same `BUN_OPTIONS`, so what starts isn't the mapper.
    expect(stdout).toContain("error TS18099");
    expect(stdout).not.toContain("error TS18068");
  });

  test("before `check`", async () => {
    expect(await expectNotStarted({}, [], {}, ["--runExternalCode", "check", "--no-pretty"])).toBe(withoutPlace);
  });

  test("in a response file", async () => {
    expect(await expectNotStarted({ files: { "args.txt": "--runExternalCode" } }, ["@args.txt"])).toBe(withoutPlace);
  });

  test("in bunfig.toml", async () => {
    const files = { "bunfig.toml": `runExternalCode = true\n[check]\nrunExternalCode = true\n` };
    expect(await expectNotStarted({ files }, [])).toBe(withoutPlace);
  });

  test("after `--`", async () => {
    await expectNotStarted({}, ["--", "--runExternalCode"]);
  });
});

// `tsc` has no counterpart to any of these.
describe.concurrent("--check", () => {
  // The mapper adds its process id to a file, which is how a test knows that it has run.
  const mapper = `fs.appendFileSync(__dirname + "/pids.txt", process.pid + "\\n"); serve();`;
  const pidsOf = (dir: { toString(): string }) => {
    const path = join(String(dir), "node_modules/m/pids.txt");
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(Number) : [];
  };
  // Only the types of `App.vue` are imported, because nothing here teaches the runtime or the bundler to load it.
  const files = {
    "App.vue": `<script>\nexport type Count = number;\n</script>\n`,
    "main.ts": `import type { Count } from "./App.vue";\nconst one: Count = 1;\nconsole.log(["ran", one, ...process.argv.slice(2)].join(" "));\n`,
    "main.test.ts": `import { test } from "bun:test";\nimport type { Count } from "./App.vue";\ntest("counts", () => {\n  const one: Count = 1;\n  console.log("ran", one);\n});\n`,
    "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n}\ndeclare const console: { log(...values: unknown[]): void };\ndeclare const process: { argv: string[]; execArgv: string[] };\n`,
    "package.json": JSON.stringify({ name: "app", scripts: { start: `"${bunExe().replaceAll("\\", "/")}" main.ts` } }),
  };
  const wrong = { "App.vue": `<script>\nexport type Count = number;\nconst wrong: Count = "one";\n</script>\n` };
  const isWrong = "TS2322: Type 'string' is not assignable to type 'number'.";
  const notAllowed = "TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.";

  async function run(dir: { toString(): string }, cmd: string[], extra: Record<string, string> = {}) {
    await using proc = spawn({
      cmd: [bunExe(), ...cmd],
      cwd: String(dir),
      env: { ...env, ...extra },
      timeout: longLimit,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, output: stdout + stderr, exitCode };
  }

  // Each command, given the flags to put next to `--check`, and what follows its last argument.
  const commands: [string, (flags: string[], rest?: string[]) => string[]][] = [
    ["bun --check main.ts", (flags, rest = []) => ["--check", ...flags, "main.ts", ...rest]],
    ["bun run --check main.ts", (flags, rest = []) => ["run", "--check", ...flags, "main.ts", ...rest]],
    ["bun run --check start", (flags, rest = []) => ["run", "--check", ...flags, "start", ...rest]],
    ["bun test --check", (flags, rest = []) => ["test", "--check", ...flags, "main.test.ts", ...rest]],
    ["bun build --check", (flags, rest = []) => ["build", "--check", ...flags, "main.ts", "--outdir", "out", ...rest]],
  ];
  /** Whether the command went on after the check. */
  const hasRun = (dir: { toString(): string }, stdout: string) =>
    stdout.includes("ran 1") || existsSync(join(String(dir), "out/main.js"));

  describe.each(commands)("%s", (name, command) => {
    test("with --runExternalCode, it goes on if there are no errors", async () => {
      using dir = project({ mapper, files });
      const { stdout, output, exitCode } = await run(dir, command(["--runExternalCode"]));
      expect(output).not.toContain("error");
      expect({ mappers: pidsOf(dir).length, hasRun: hasRun(dir, stdout), exitCode }).toEqual({
        mappers: 1,
        hasRun: true,
        exitCode: 0,
      });
    });

    test("with --runExternalCode, it reports the errors in App.vue", async () => {
      using dir = project({ mapper, files: { ...files, ...wrong } });
      const { stdout, output, exitCode } = await run(dir, command(["--runExternalCode"]));
      expect(output).toContain(isWrong);
      expect(output).toMatch(/App\.vue[(:]3[,:]7\b/);
      expect(output).not.toContain("TS18068");
      expect({ mappers: pidsOf(dir).length, hasRun: hasRun(dir, stdout), exitCode }).toEqual({
        mappers: 1,
        hasRun: false,
        exitCode: 1,
      });
      expect(() => process.kill(pidsOf(dir)[0], 0)).toThrow();
    });

    test.each([
      ["without the flag", command([]), {}, {}],
      ["with the flag in BUN_OPTIONS", command([]), { BUN_OPTIONS: "--runExternalCode" }, {}],
      ["with the flag after `--`", command([], ["--", "--runExternalCode"]), {}, {}],
      [
        "with the flag in BUN_OPTIONS and after `--`",
        command([], ["--", "--runExternalCode"]),
        { BUN_OPTIONS: "--runExternalCode" },
        {},
      ],
      ["with the option in tsconfig.json", command([]), {}, { runExternalCode: true }],
    ])("%s, nothing starts", async (where, cmd, extra, compilerOptions) => {
      using dir = project({ mapper, files, compilerOptions });
      const { stdout, output, exitCode } = await run(dir, cmd, extra);
      // To `bun build`, what follows `--` is an entry point.
      const isEntryPoint = name === "bun build --check" && where.endsWith("after `--`");
      expect(output).toContain(isEntryPoint ? `ModuleNotFound resolving "--runExternalCode"` : notAllowed);
      expect({ mappers: pidsOf(dir), hasRun: hasRun(dir, stdout), exitCode }).toEqual({
        mappers: [],
        hasRun: false,
        exitCode: 1,
      });
    });

    test("with the flag and without --check, nothing starts", async () => {
      using dir = project({ mapper, files });
      const cmd = command(["--runExternalCode"]).filter(arg => arg !== "--check");
      const { stdout, exitCode } = await run(dir, cmd);
      expect({ mappers: pidsOf(dir), hasRun: hasRun(dir, stdout), exitCode }).toEqual({
        mappers: [],
        hasRun: true,
        exitCode: 0,
      });
    });
  });

  test("bun --check --runExternalCode alone checks the project", async () => {
    using dir = project({ mapper, files: { ...files, ...wrong } });
    const [alone, afterRun, inOptions] = await Promise.all([
      run(dir, ["--check", "--runExternalCode"]),
      run(dir, ["run", "--check", "--runExternalCode"]),
      run(dir, ["--check"], { BUN_OPTIONS: "--runExternalCode" }),
    ]);
    const error = `App.vue(3,7): error ${isWrong}\n`;
    expect([alone.stdout, afterRun.stdout]).toEqual([error, error]);
    expect(inOptions.stdout).toContain(notAllowed);
    expect(pidsOf(dir)).toHaveLength(2);
  });

  test.each([
    ["bun --check main.ts", ["--check", "main.ts", "--runExternalCode"]],
    ["bun run --check main.ts", ["run", "--check", "main.ts", "--runExternalCode"]],
    ["bun run --check start", ["run", "--check", "start", "--runExternalCode"]],
  ])("%s --runExternalCode: the flag is the program's", async (_, cmd) => {
    using dir = project({ mapper, files });
    const [checked, alsoInOptions] = await Promise.all([
      run(dir, cmd),
      run(dir, cmd, { BUN_OPTIONS: "--runExternalCode" }),
    ]);
    expect(checked.output).toContain(notAllowed);
    expect(alsoInOptions.output).toContain(notAllowed);
    expect(pidsOf(dir)).toEqual([]);
    const unchecked = await run(
      dir,
      cmd.filter(arg => arg !== "--check"),
    );
    expect(unchecked.stdout).toContain("ran 1 --runExternalCode\n");
  });

  test("the program doesn't see the flag, and a process that it starts needs its own", async () => {
    using dir = project({
      mapper,
      files: {
        ...files,
        "parent.ts": `import type { Count } from "./App.vue";
declare const Bun: { spawnSync(options: object): { exitCode: number } };
const one: Count = 1;
console.log(["ran", one, ...process.argv.slice(2), ...process.execArgv].join(" "));
const child = Bun.spawnSync({ cmd: [process.argv[0], "--check", "main.ts"], stdio: ["ignore", "inherit", "inherit"] });
console.log("the child exited with", child.exitCode);
`,
      },
    });
    const { stdout, output } = await run(dir, ["--check", "--runExternalCode", "parent.ts", "argument"]);
    expect(stdout).toBe("ran 1 argument --check\nthe child exited with 1\n");
    expect(output).toContain(notAllowed);
    expect(pidsOf(dir)).toHaveLength(1);
  });

  test("a process that the program forks needs its own flag too", async () => {
    using dir = project({
      mapper,
      files: {
        ...files,
        "parent.ts": `import type { Count } from "./App.vue";
type Child = { on(event: "exit", listener: (code: number) => void): void };
declare function require(name: "node:child_process"): { fork(path: string): Child };
const one: Count = 1;
console.log("ran", one);
const child = require("node:child_process").fork("./main.ts");
child.on("exit", code => console.log("the child exited with", code));
`,
      },
    });
    const { stdout, output } = await run(dir, ["--check", "--runExternalCode", "parent.ts"]);
    expect(stdout).toBe("ran 1\nthe child exited with 1\n");
    expect(output).toContain(notAllowed);
    expect(pidsOf(dir)).toHaveLength(1);
  });

  test.each(["--watch", "--hot"])(
    "bun %s --check --runExternalCode starts the mapper again for each check",
    async flag => {
      using dir = project({ mapper, files });
      await using proc = spawn({
        cmd: [bunExe(), flag, "--no-clear-screen", "--check", "--runExternalCode", "main.ts"],
        cwd: String(dir),
        env,
        timeout: longLimit,
        stdout: "pipe",
        stderr: "pipe",
      });
      let output = "";
      let wake = () => {};
      const read = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) {
          output += Buffer.from(chunk).toString();
          wake();
        }
      };
      let hasExited = false;
      const closed = Promise.all([read(proc.stdout), read(proc.stderr)]).then(() => {
        hasExited = true;
        wake();
      });
      const until = async (pattern: RegExp) => {
        while (!pattern.test(output) && !hasExited) await new Promise<void>(resolve => (wake = resolve));
      };
      await until(/ran 1|error/);
      expect(output).toBe("ran 1\n");
      const [first] = pidsOf(dir);
      expect(() => process.kill(first, 0)).toThrow();
      await Bun.write(join(String(dir), "App.vue"), wrong["App.vue"]);
      await until(/Found \d+ error/);
      expect(output).toContain(isWrong);
      expect(pidsOf(dir)).toEqual([first, expect.any(Number)]);
      proc.kill();
      await closed;
    },
  );
});

describe.concurrent("Bun.build", () => {
  const files = {
    "App.vue": `<script>\nexport type Count = number;\n</script>\n`,
    "main.ts": `import type { Count } from "./App.vue";\nexport const one: Count = 1;\n`,
  };
  const wrong = { "App.vue": `<script>\nexport type Count = number;\nconst wrong: Count = "one";\n</script>\n` };
  const recordsPid = `fs.appendFileSync(__dirname + "/pids.txt", process.pid + "\\n");`;
  // What each program starts with. `build` returns what a test compares. The mappers that have started by then are in
  // `running` if they're still there.
  const start = String.raw`
const fs = require("fs");
const pids = () => {
  try {
    return fs.readFileSync("node_modules/m/pids.txt", "utf8").trim().split("\n").map(Number);
  } catch {
    return [];
  }
};
const isRunning = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function build(check) {
  const { success, logs } = await Bun.build({ entrypoints: ["./main.ts"], check, throw: false });
  const messages = logs.map(log => log.message.split("\n")[0]);
  return { success, messages, started: pids().length, running: pids().filter(isRunning) };
}
`;

  /** Runs `program` in a project with `options`. Returns what it passes to `done`. */
  async function run(options: Project, program: string, extra: Record<string, string> = {}, flags: string[] = []) {
    using dir = project({
      ...options,
      files: {
        ...files,
        ...options.files,
        "build.js": `${start}const done = value => console.log(JSON.stringify(value));\n${program}`,
      },
    });
    await using proc = spawn({
      cmd: [bunExe(), ...flags, "build.js"],
      cwd: String(dir),
      env: { ...env, ...extra },
      timeout: longLimit,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }
  const allowed = `done(await build({ runExternalCode: true }));`;
  const notAllowed = "TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.";

  test("check: { runExternalCode: true } runs the mapper", async () => {
    expect(await run({ mapper: `${recordsPid} serve();` }, allowed)).toEqual({
      success: true,
      messages: [],
      started: 1,
      running: [],
    });
  });

  test("the errors in App.vue fail the build", async () => {
    expect(await run({ mapper: `${recordsPid} serve();`, files: wrong }, allowed)).toEqual({
      success: false,
      messages: ["TS2322: Type 'string' is not assignable to type 'number'."],
      started: 1,
      running: [],
    });
  });

  test("a mapper that exits in the middle of a request", async () => {
    expect(await run({ mapper: `${recordsPid} serve({ transform: () => process.exit(3) });` }, allowed)).toEqual({
      success: false,
      messages: ["TS18069: The content mapper 'm' failed to transform this file."],
      started: 1,
      running: [],
    });
  });

  test("a mapper that never answers", async () => {
    const mapper = `${recordsPid} setInterval(() => {}, 1000);`;
    const result = await run({ mapper }, allowed, { BUN_DEBUG_TEST_CONTENT_MAPPER_TIMEOUT_MS: "1" });
    expect(result).toEqual({
      success: false,
      messages: expect.arrayContaining(["TS18099: The content mapper 'm' could not be initialized."]),
      // It may be killed before it gets to write the file.
      started: expect.any(Number),
      running: [],
    });
  });

  test.each([
    ["true", "true"],
    ["{}", "{}"],
    ["{ runExternalCode: false }", "{ runExternalCode: false }"],
    ["{ runExternalCode: undefined }", "{ runExternalCode: undefined }"],
    ["an object that inherits it", "(Object.prototype.runExternalCode = true, {})"],
  ])("check: %s starts nothing", async (_, check) => {
    const result = await run({ mapper: `${recordsPid} serve();` }, `done(await build(${check}));`);
    expect(result).toEqual({
      success: false,
      messages: expect.arrayContaining([notAllowed]),
      started: 0,
      running: [],
    });
  });

  test("the flags of the process don't count", async () => {
    const program = `const before = pids().length;\ndone({ ...(await build(true)), started: pids().length - before });`;
    const result = await run({ mapper: `${recordsPid} serve();` }, program, {}, ["--check", "--runExternalCode"]);
    expect(result).toEqual({
      success: false,
      messages: expect.arrayContaining([notAllowed]),
      started: 0,
      running: [],
    });
  });

  test.each([`"true"`, "1", "null", "{}"])("check: { runExternalCode: %s } throws", async value => {
    const program = `done(await build({ runExternalCode: ${value} }).catch(error => [error.name, error.message, pids()]));`;
    expect(await run({ mapper: `${recordsPid} serve();` }, program)).toEqual([
      "TypeError",
      expect.stringContaining("runExternalCode"),
      [],
    ]);
  });

  test("two builds at the same time", async () => {
    const program = `
const builds = await Promise.all([build({ runExternalCode: true }), build({ runExternalCode: true })]);
done({ builds: builds.map(it => [it.success, it.messages]), started: pids().length, running: pids().filter(isRunning) });`;
    expect(await run({ mapper: `${recordsPid} serve();` }, program)).toEqual({
      builds: [
        [true, []],
        [true, []],
      ],
      started: 2,
      running: [],
    });
  });

  test("a process that exits during a build takes the mapper with it", async () => {
    const mapper = `serve({ transform: () => (fs.writeFileSync(__dirname + "/working.txt", ""), SKIP) });`;
    const program = `
const exit = why => (done(why), process.exit(0));
build({ runExternalCode: true }).then(() => exit("the build has settled"));
const wait = () => (fs.existsSync("node_modules/m/working.txt") ? exit("the mapper is working") : setImmediate(wait));
wait();`;
    // The mapper has the standard error of the process, so this only returns once both have exited.
    expect(await run({ mapper }, program)).toBe("the mapper is working");
  });

  // A leak would add at least one per build. The garbage collector and the JIT start a few threads when they see fit.
  test.skipIf(!isLinux)("fifty builds in one process leave no file descriptor and no thread behind", async () => {
    const program = `
const count = () => ({ files: fs.readdirSync("/proc/self/fd").length, threads: fs.readdirSync("/proc/self/task").length });
let early;
for (let i = 1; i <= 50; i++) {
  const { success, messages } = await build({ runExternalCode: true });
  if (!success) throw new Error("build " + i + " failed: " + messages.join(", "));
  if (i === 5) early = count();
}
done({ early, late: count(), started: pids().length, running: pids().filter(isRunning) });`;
    const { early, late, started, running } = await run({ mapper: `${recordsPid} serve();` }, program);
    expect({ started, running }).toEqual({ started: 50, running: [] });
    expect(late.files - early.files).toBeLessThan(45);
    expect(late.threads - early.threads).toBeLessThan(45);
  });
});

// The mapper answers late, out of order, twice, with ids that nothing asked for, one byte at a time or several answers in
// one write. What it does for a file depends on the seed and on the file's name only.
describe.concurrent("answers in any order and in any pieces", () => {
  const mapper = String.raw`
const mulberry32 = a => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = text => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const seed = Number(process.env.SEED);
let merged = [];
const flush = () => { if (merged.length) raw(Buffer.concat(merged.splice(0))); };
const write = message => {
  const bytes = frame({ jsonrpc: "2.0", ...message });
  if (seed % 3 === 1) for (const byte of bytes) raw(Buffer.from([byte]));
  else if (seed % 3 === 2) { merged.push(bytes); if (merged.length >= 10) flush(); else setTimeout(flush, 2); }
  else raw(bytes);
};
serve({ transform: ({ content, fileName }, id) => {
  const random = mulberry32(seed ^ hash(require("path").basename(fileName)));
  const delay = Math.floor(random() * 10), before = random(), after = random();
  setTimeout(() => {
    if (before < 0.2) write({ id: "api999999", result: { text: "wrong", extension: ".ts" } });
    if (before > 0.8) write({ id: "q" + id, method: "question", params: {} });
    write({ id, result: script(content) });
    if (after < 0.3) write({ id, result: { text: "const twice: number = '';", extension: ".ts" } });
  }, delay);
  return SKIP;
} });`;
  const count = 30;
  const files: Record<string, string> = {
    "main.ts": `import { v0 } from "./F0.vue";\nconst s: string = v0;\n`,
  };
  for (let i = 0; i < count; i++) {
    const targets = [i + 1, i * 2 + 1, (i * 7 + 3) % count].filter(
      (t, at, all) => t < count && t !== i && all.indexOf(t) === at,
    );
    files[`F${i}.vue`] = `<script>
${targets.map(t => `import { v${t} } from "./F${t}.vue";`).join("\n")}
export const v${i}: number = ${i % 7 === 0 ? `"text"` : i};
export const sum${i} = () => [${targets.map(t => "v" + t).join(", ")}];
</script>
`;
  }
  const lineOf = (i: number) =>
    files[`F${i}.vue`].split("\n").findIndex(line => line.startsWith(`export const v${i}:`)) + 1;
  const errors = [0, 14, 21, 28, 7]
    .map(i => `F${i}.vue(${lineOf(i)},14): error TS2322: Type 'string' is not assignable to type 'number'.`)
    .concat(`main.ts(2,7): error TS2322: Type 'number' is not assignable to type 'string'.`)
    .join("\n");

  test.each([
    [1, 1],
    [1, 4],
    [2, 1],
    [2, 4],
    [3, 1],
    [3, 4],
  ])("seed %d, %d threads", async (seed, threads) => {
    // Only `main.ts` is listed, so the other files are found one import at a time.
    using dir = project({ mapper, files, config: { files: ["main.ts"], include: undefined } });
    const { stdout, exitCode } = await check(dir, ["--runExternalCode", "--threads", String(threads)], {
      SEED: String(seed),
    });
    expect(stdout).toBe(errors);
    expect(exitCode).toBe(1);
  });
});
