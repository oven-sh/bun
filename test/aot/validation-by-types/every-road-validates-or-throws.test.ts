// `JSON.parse<T>(text)` with the `JSON` of "bun" either validates or doesn't run: however the call reaches a running program, text that is no `T` never comes back as one.
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { unsupported } from "../run-programs";

const prelude = `
const text = '{"id":"7"}';
type User = { id: number };
function show(call: () => any) {
  try {
    const value = call();
    console.log(typeof value?.id === "string" ? "unchecked" : "another value");
  } catch (error: any) {
    console.log(Array.isArray(error.issues) ? "validated" : String(error.message).startsWith('JSON.parse() from "bun" has no type') ? "threw" : String(error));
  }
}
`;

type Outcome = "validated" | "threw" | "refused";
// What each road does: [without --aot, with --aot].
const roads: Record<string, { files: Record<string, string>; outcomes: [Outcome[], Outcome[]] }> = {};
function road(name: string, plain: Outcome | Outcome[], compiled: Outcome | Outcome[], program: string, others = {}) {
  const [imports, ...calls] = program.split("\n---\n");
  roads[name] = {
    files: { "program.ts": imports + prelude + calls.join("\n"), ...others },
    outcomes: [[plain].flat(), [compiled].flat()],
  };
}

const imported = `import { JSON } from "bun";`;
road("the import", "refused", "validated", `${imported}\n---\nshow(() => JSON.parse<User>(text));`);
road("Bun.JSON", "refused", "validated", `\n---\nshow(() => Bun.JSON.parse<User>(text));`);
road("globalThis.Bun.JSON", "threw", "validated", `\n---\nshow(() => globalThis.Bun.JSON.parse<User>(text));`);
road("a string key", "refused", "validated", `${imported}\n---\nshow(() => JSON["parse"]<User>(text));`);
road("no type argument", "refused", "refused", `${imported}\n---\nshow(() => JSON.parse(text) as User);`);
road("Bun.JSON without a type argument", "threw", "refused", `\n---\nshow(() => Bun.JSON.parse(text) as User);`);
road(
  "require",
  ["threw", "threw"],
  ["threw", "threw"],
  `\n---\nconst { JSON: Codec } = require("bun");\nshow(() => Codec.parse<User>(text));\nshow(() => require("bun").JSON.parse<User>(text));`,
);
road(
  "parse taken out",
  "threw",
  "validated",
  `${imported}\n---\nconst { parse } = JSON;\nshow(() => parse<User>(text));`,
);
road(
  "another name for the object",
  ["threw", "threw"],
  ["validated", "validated"],
  `${imported}\n---\nconst codec = JSON, other = Bun.JSON;\nshow(() => codec.parse<User>(text));\nshow(() => other.parse<User>(text));`,
);
road(
  "an untyped name for the object",
  "threw",
  "threw",
  `${imported}\n---\nconst codec: any = [JSON][0];\nshow(() => codec.parse(text));`,
);
road("call", "threw", "threw", `${imported}\n---\nshow(() => JSON.parse.call(JSON, text) as User);`);
road("apply", "threw", "threw", `${imported}\n---\nshow(() => Reflect.apply(JSON.parse, JSON, [text]) as User);`);
road("bind", "threw", "threw", `${imported}\n---\nshow(() => JSON.parse.bind(JSON)(text) as User);`);
road(
  "a callback",
  "threw",
  "threw",
  `${imported}\n---\nshow(() => [text].map(JSON.parse as (text: string) => User)[0]);`,
);
road(
  "import()",
  "threw",
  "threw",
  `\n---\nconst { JSON: Codec } = await import("bun");\nshow(() => Codec.parse<User>(text));`,
);
road(
  "a parameter, a field and a property",
  ["threw", "threw", "threw"],
  ["threw", "threw", "threw"],
  `${imported}\n---
function read(JSON: typeof Bun.JSON) { return JSON.parse<User>(text); }
class Box { codec = JSON; read() { return this.codec.parse<User>(text); } }
const table = { JSON };
show(() => read(JSON));
show(() => new Box().read());
show(() => table.JSON.parse<User>(text));`,
);
road(
  "text that is evaluated",
  ["threw", "threw", "threw", "threw"],
  ["threw", "threw", "threw", "threw"],
  `\n---
const source = "Bun.JSON.parse('" + text + "')" + (process.env.NOTHING_IS_SET_UNDER_THIS_NAME ?? "");
show(() => (0, eval)(source));
show(() => new Function("return " + source)());
show(() => require("node:vm").runInThisContext(source));
show(() => require("node:vm").runInNewContext(source, { Bun }));`,
);
road("text that the build can read", "threw", "refused", `\n---\nshow(() => (0, eval)("Bun.JSON.parse('{}')"));`);
road("a JavaScript file", "threw", "refused", `import { read } from "./read.js";\n---\nshow(() => read(text));`, {
  "read.js": `const { JSON: Codec } = globalThis.Bun;\nexport const read = text => Codec.parse(text);`,
});

const notDeclared = `${imported}\n---\nshow(() => JSON.parse<Usr>(text));`;
road("a type that isn't declared", "refused", "refused", notDeclared);
road(
  "a type that isn't declared, the error silenced",
  "refused",
  "refused",
  notDeclared.replace("show(", "// @ts-ignore\nshow("),
);
road("a type that isn't declared, the file not checked", "refused", "refused", "// @ts-nocheck\n" + notDeclared);
road(
  "a type of a package that isn't installed",
  "refused",
  "refused",
  `${imported}\nimport type { Person } from "a-package-that-is-not-installed";\n---\nshow(() => JSON.parse<Person>(text));`,
);
road(
  "a name for any",
  "refused",
  "refused",
  `${imported}\ntype Anything = any;\n---\nshow(() => JSON.parse<Anything>(text));`,
);

const ways: Record<string, (folder: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>> = {
  "bun run": folder => run([bunExe(), "run", "./program.ts"], folder),
  "bun build": async folder => {
    const built = await run([bunExe(), "build", "./program.ts", "--target=bun", "--outfile", "out.js"], folder);
    return built.exitCode ? built : run([bunExe(), "run", "./out.js"], folder);
  },
  "bun run --aot": folder => run([bunExe(), "run", "--aot", "./program.ts"], folder),
};

describe.each(Object.keys(ways))("%s", way => {
  const isCompiled = way.endsWith("--aot");
  test.skipIf(isCompiled && unsupported).each(Object.keys(roads))(
    "%s",
    async name => {
      using dir = tempDir("every-road", roads[name].files);
      const { stdout, stderr, exitCode } = await ways[way](String(dir));
      const outcomes = roads[name].outcomes[isCompiled ? 1 : 0];
      if (outcomes[0] === "refused") {
        expect(stderr).toContain("error: ");
        expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
        return;
      }
      expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        stdout: outcomes.join("\n") + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});

test("the rest of the object is the global's", async () => {
  using dir = tempDir("json-of-bun", {
    "program.ts": `import { JSON } from "bun";
const global: any = globalThis.JSON, own: any = JSON;
console.log(own === global, JSON === Bun.JSON, own.stringify === global.stringify, own.rawJSON === global.rawJSON, own.isRawJSON === global.isRawJSON);
console.log(JSON.stringify({ a: [1] }), String(JSON), Object.keys(JSON), JSON.parse<any>("[1]"), JSON.parse<unknown>('"a"'), Bun.JSON.parse<any>("2"));
"use strict";
for (const change of [() => ((JSON as any).parse = global.parse), () => delete (JSON as any).parse, () => ((Bun as any).JSON = global)]) {
  try { change(); } catch {}
}
console.log(own.parse === global.parse, Bun.JSON === JSON);`,
  });
  for (const way of unsupported ? ["bun run", "bun build"] : Object.keys(ways)) {
    const { stdout, stderr, exitCode } = await ways[way](String(dir));
    expect({ way, stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
      way,
      stdout: `false true true true true\n{"a":[1]} [object JSON] [] [ 1 ] a 2\nfalse true\n`,
      stderr: "",
      exitCode: 0,
    });
  }
}, 120_000);

const example = `import { JSON } from "bun";

interface User {
  id: number;
  name: string;
  tags?: string[];
}

try {
  const user = JSON.parse<User>('{"id":"7","tags":["a",1]}');
  console.log("unchecked", user.id);
} catch (error) {
  console.log(String(error).slice(0, 56));
}
`;

const otherTools: Record<string, (source: string) => Promise<string>> = {
  tsc: async source => {
    const { default: ts } = await import("typescript");
    const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext };
    return ts.transpileModule(source, { compilerOptions }).outputText;
  },
  esbuild: async source => (await import("esbuild")).transformSync(source, { loader: "ts", format: "esm" }).code,
  swc: async source =>
    (await import("@swc/core")).transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2022" } })
      .code,
};

test.each(Object.keys(otherTools))("what %s emits throws", async tool => {
  const emitted = await otherTools[tool](example);
  expect(emitted).toContain("JSON.parse(");
  using dir = tempDir("emitted-by-another-tool", { "user.mjs": emitted });
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", join(String(dir), "user.mjs")], String(dir));
  // Bun sees the call in the file and refuses the file. Behind another name the call itself throws.
  expect(stderr).toContain(`JSON.parse() from "bun" needs a type argument`);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });

  using hidden = tempDir("emitted-by-another-tool", {
    "user.mjs": emitted.replace(/import \{ JSON \} from "bun";/, `const JSON = globalThis.Bun.JSON;`),
  });
  expect(await run([bunExe(), "run", join(String(hidden), "user.mjs")], String(hidden))).toEqual({
    stdout: `TypeError: JSON.parse() from "bun" has no type to valida\n`,
    stderr: "",
    exitCode: 0,
  });
});
