import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { sep } from "node:path";
import { runInNewContext } from "node:vm";

test("can get sourceURL from eval inside node:vm", () => {
  try {
    runInNewContext(
      `
throw new Error("hello");
//# sourceURL=hellohello.js
`,
      {},
    );
  } catch (e: any) {
    var err: Error = e;
  }

  expect(err!.stack!.replaceAll(import.meta.path, "<this-url>")).toMatchSnapshot();
});

test("can get sourceURL inside node:vm", () => {
  const err = runInNewContext(
    `

function hello() {
    return Bun.inspect(new Error("hello"));
}

hello();

//# sourceURL=hellohello.js
`,
    { Bun },
  );

  expect(err.replaceAll(import.meta.path, "<this-url>")).toMatchSnapshot();
});

test("eval sourceURL is correct", () => {
  const err = eval(
    `

function hello() {
    return Bun.inspect(new Error("hello"));
}

hello();

//# sourceURL=hellohello.js
`,
  );
  expect(err.replaceAll(import.meta.path, "<this-url>")).toMatchSnapshot();
});

// Bun keeps a source map for each file it transpiles. node:vm compiles the code it is given as it is, so a position in
// that code is final, whatever `filename` is: the name of the file that runs it, for one.
describe.concurrent("vm code whose filename is a file that Bun transpiled", () => {
  // The transpiler removes the comment, so every line that the source map of the fixture itself can answer with is
  // below it. Each function below is on line 5 of its code.
  const padding = ["/*", ...Array.from({ length: 18 }, () => " *"), " */"].join("\n") + "\n";
  const fixture =
    padding +
    String.raw`
      const vm = require("node:vm");
      const path = require("node:path");
      const source = "\n\n\n\n(function f() { return new Error('boom'); })";
      const names = { own: __filename, other: path.join(__dirname, "not-a-file.js") };
      const compile = {
        script: name => new vm.Script(source, { filename: name }).runInThisContext(),
        runInThisContext: name => vm.runInThisContext(source, { filename: name }),
        runInNewContext: name => vm.runInNewContext(source, {}, { filename: name }),
        compileFunction: name => vm.compileFunction("\n\n\n\nreturn new Error('boom')", [], { filename: name }),
      };
      // "own" and "other" have to say the same thing about different names.
      const unnamed = text =>
        text.replaceAll(__dirname + path.sep, "").replaceAll(/not-a-file\.js|fixture\.js/g, "NAME");
      const position = e => ({ at: unnamed(e.stack.split("\n")[1].trim()), line: e.line, column: e.column });
      // An error of another context is not this realm's Error: its stack stays a string.
      const callSite = make => {
        Error.prepareStackTrace = (_, sites) => sites;
        try {
          const { stack } = make();
          return Array.isArray(stack) ? { line: stack[0].getLineNumber(), column: stack[0].getColumnNumber() } : null;
        } finally {
          Error.prepareStackTrace = undefined;
        }
      };
      // The frame of this file that called the vm code is its own in both.
      const inspect = e => unnamed(Bun.inspect(e)).split("\n").filter(line => !line.includes("<anonymous>"));
      const syntaxError = name => {
        try {
          new vm.Script("\n\n\n\n}", { filename: name });
        } catch (e) {
          return { name: e.name, line: e.line, parse: unnamed(e.stack.split("\n").find(line => line.includes("<parse>"))) };
        }
      };

      const uncaught = process.argv[2];
      if (uncaught) {
        const name = names[uncaught];
        const throws = "\n\n\n\nthrow new Error('boom');";
        ({
          // The vm code returns the error, and this file throws it.
          returned: () => {
            throw compile.script(name)();
          },
          // The error leaves the vm run.
          runInNewContext: () => vm.runInNewContext(throws, {}, { filename: name }),
          runInContext: () => new vm.Script(throws, { filename: name }).runInContext(vm.createContext({})),
          runInThisContext: () => vm.runInThisContext(throws, { filename: name, displayErrors: false }),
        })[process.argv[3]]();
      }
      const out = {};
      for (const [api, make] of Object.entries(compile)) {
        out[api] = {};
        for (const [kind, name] of Object.entries(names)) {
          const f = make(name);
          out[api][kind] = { ...position(f()), callSite: callSite(f), inspect: inspect(f()) };
        }
      }
      out.syntaxError = { own: syntaxError(names.own), other: syntaxError(names.other) };
      console.log(JSON.stringify(out));
    `;

  test("error.stack, call sites, Bun.inspect and a SyntaxError report the position in the vm code", async () => {
    using dir = tempDir("vm-own-filename", { "fixture.js": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);

    for (const api of ["script", "runInThisContext", "runInNewContext"]) {
      expect(out[api].other.line).toBe(5);
      expect(out[api].other.at).toStartWith("at f (NAME:5:");
      expect(out[api].other.inspect).toContain("5 | (function f() { return new Error('boom'); })");
    }
    expect(out.script.other.callSite.line).toBe(5);
    expect(out.syntaxError.other).toMatchObject({ name: "SyntaxError", line: 5 });
    expect(Object.fromEntries(Object.entries<any>(out).map(([api, { own }]) => [api, own]))).toEqual(
      Object.fromEntries(Object.entries<any>(out).map(([api, { other }]) => [api, other])),
    );
    expect(exitCode).toBe(0);
  });

  // jiti (tailwindcss, nuxt, c12 config files): require() the file, and when that throws, transform the file and run
  // the result as vm code under the name of the file. The transform keeps every line where it is.
  test("a file that is run as vm code after it failed to load reports the line of the vm code", async () => {
    using dir = tempDir("vm-after-failed-load", {
      "config.ts": [
        "interface Options {",
        "  a: number;",
        "  b: number;",
        "}",
        "type Plugin = (options: Options) => void;",
        "function plugin(): never {",
        '  throw new Error("from the config");',
        "}",
        // The line of the throw is a line of this code in what the transpiler prints.
        "const one = 1;",
        "const two = 2;",
        "const three = 3;",
        "const four = 4;",
        "module.exports = plugin();",
        "",
      ].join("\n"),
      "main.cjs": String.raw`
        const fs = require("node:fs");
        const path = require("node:path");
        const vm = require("node:vm");
        const file = path.join(__dirname, "config.ts");
        const thrown = fn => {
          try {
            fn();
          } catch (e) {
            return e.stack.split("\n")[1].trim().replaceAll(__dirname + path.sep, "");
          }
        };
        const native = thrown(() => require(file));
        // Lines 1 to 5 are types: blank. "(): never" is the one annotation below them.
        const lines = fs.readFileSync(file, "utf8").split("\n");
        const text = lines.map((line, i) => (i < 5 ? "" : line.replace("(): never", "()"))).join("\n");
        const wrapper = vm.runInThisContext("(function (exports, require, module) {" + text + "\n})", { filename: file });
        const asVmCode = thrown(() => wrapper({}, require, { exports: {} }));
        console.log(JSON.stringify({ native, asVmCode }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      native: "at plugin (config.ts:7:13)",
      asVmCode: "at plugin (config.ts:7:18)",
    });
    expect(exitCode).toBe(0);
  });

  test.each(["returned", "runInNewContext", "runInContext", "runInThisContext"])(
    "the uncaught error printer reports the position in the vm code (%s)",
    async thrown => {
      using dir = tempDir("vm-own-filename-uncaught", { "fixture.js": fixture });
      const run = async (kind: string) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "fixture.js", kind, thrown],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(exitCode).toBe(1);
        return stderr.replaceAll(String(dir) + sep, "").replaceAll(/not-a-file\.js|fixture\.js/g, "NAME");
      };
      const [own, other] = await Promise.all([run("own"), run("other")]);

      expect(other).toContain(thrown === "returned" ? "at f (NAME:5:" : "NAME:5:");
      // A frame of the fixture is on the same line in both, and names the fixture in both.
      expect(own).toBe(other);
    },
  );
});
