// The build writes down where a name that the program resolves leads, under the folder that the name is looked for from. Two ways in which such a row answered another question:
// `require.resolve(name, { paths })` looks from the listed folders in their order, and the run passed over a listed folder of which the executable knows nothing and took the row of a
// later one: another folder's package, silently. A row answers no search through `paths`: what the executable cannot say is refused aloud. Where the build can read the list, it brings
// what each listed folder answers, and the search finds what `bun <file>` finds. Where it cannot, it says so (TS100095).
// `createRequire(__dirname)` takes the folder for a file, so it looks from the folder ABOVE. Its row stood under the own folder, and a name that the file's own require made at the run
// found the file above.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const packageIn = (folder: string) => ({
  [`${folder}/node_modules/gauge/package.json`]: `{ "name": "gauge", "exports": { ".": "./lib/main.js" } }\n`,
  [`${folder}/node_modules/gauge/lib/main.js`]: `module.exports = "main of ${folder}";\n`,
});

const ask = `const ask = find => {
  try {
    return find().split("/").slice(-5).join("/");
  } catch (error) {
    return error.code;
  }
};
`;

async function buildAndRun(files: Record<string, string>, entry: string, folders: string[], warnings: string[] = []) {
  using dir = tempDir("what-the-build-wrote-down-for-a-name", files);
  using elsewhere = tempDir("what-the-build-wrote-down-for-a-name-runs", {});
  const [cwd, program] = [String(dir), join(String(elsewhere), "program")];
  const plain = await run([bunExe(), entry], cwd);
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", program], cwd);
  const said = built.stderr.match(/^warn: TS\d+/gm) ?? [];
  expect({ said, stderr: said.length ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
    said: warnings.map(code => `warn: ${code}`),
    stderr: "",
    exitCode: 0,
  });
  for (const folder of folders) rmSync(join(cwd, folder), { recursive: true });
  return { plain: plain.stdout, compiled: await run([program], String(elsewhere)) };
}

const listed: Record<string, { second: string; found: string; warnings: string[] }> = {
  "a search through paths that the build can read finds what bun <file> finds": {
    second: `"second"`,
    found: "second/node_modules/gauge/lib/main.js",
    warnings: [],
  },
  "a row answers no search through paths that the build cannot read, and the build has said so": {
    second: `[..."dnoces"].reverse().join("")`,
    found: "MODULE_NOT_FOUND",
    warnings: ["TS100095"],
  },
};

for (const [name, { second, found, warnings }] of Object.entries(listed)) {
  test(name, async () => {
    const { plain, compiled } = await buildAndRun(
      {
        ...packageIn("first"),
        ...packageIn("second"),
        "first/main.cjs": `const { join } = require("node:path");
${ask}const second = join(__dirname, "..", ${second});
console.log("SAID", ask(() => require.resolve("gauge")));
console.log("SAID", ask(() => require.resolve("gauge", { paths: [second, __dirname] })));
`,
      },
      "first/main.cjs",
      ["first", "second"],
      warnings,
    );
    expect(plain).toBe("SAID first/node_modules/gauge/lib/main.js\nSAID second/node_modules/gauge/lib/main.js\n");
    expect(compiled).toEqual({
      stdout: `SAID first/node_modules/gauge/lib/main.js\nSAID ${found}\n`,
      stderr: "",
      exitCode: 0,
    });
  });
}

// `Bun.resolveSync()`, `Bun.resolve()` and `import.meta.resolveSync()` embed nothing. The build says so where a written path names a file that the executable
// doesn't hold (TS100099). Once the file is an entry point too, as the warning advises, the build is quiet.
const made = `atob("Li9wYXJ0LmNqcw==")`;
const missed = "ERR_MODULE_NOT_FOUND";
const resolvers: Record<string, { asks: string; warnings: string[]; found: string }> = {
  "Bun.resolveSync() of a written path": {
    asks: `Bun.resolveSync("./part.cjs", import.meta.dir)`,
    warnings: ["TS100099"],
    found: missed,
  },
  "Bun.resolveSync() of a written path without its ending": {
    asks: `Bun.resolveSync("./part", import.meta.dir)`,
    warnings: ["TS100099"],
    found: missed,
  },
  "import.meta.resolveSync() of a written path": {
    asks: `import.meta.resolveSync("./part.cjs")`,
    warnings: ["TS100099"],
    found: missed,
  },
  "Bun.resolveSync() of a const that holds a written path": {
    asks: `Bun.resolveSync(written, import.meta.dir)`,
    warnings: ["TS100099"],
    found: missed,
  },
  "Bun.resolveSync() of a written path that names no file": {
    asks: `Bun.resolveSync("./absent.cjs", import.meta.dir)`,
    warnings: [],
    found: missed,
  },
  "Bun.resolveSync() of a built-in module": {
    asks: `"x/" + Bun.resolveSync("node:path", import.meta.dir)`,
    warnings: [],
    found: "x/node:path",
  },
  "Bun.resolveSync() of a computed path in a branch that never runs": {
    asks: `false ? Bun.resolveSync(${made}, import.meta.dir) : "x/quiet"`,
    warnings: [],
    found: "x/quiet",
  },
};
const asking = (asks: string) => `const written = "./part.cjs";
let said;
try {
  said = (${asks}).split("/").slice(-2).join("/");
} catch (error) {
  said = error.code;
}
console.log("SAID", said);
`;

for (const [name, { asks, warnings, found }] of Object.entries(resolvers)) {
  test(name, async () => {
    const files = { "main.mjs": asking(asks), "part.cjs": `module.exports = "part";\n` };
    const { compiled } = await buildAndRun(files, "main.mjs", [], warnings);
    expect(compiled).toEqual({ stdout: `SAID ${found}\n`, stderr: "", exitCode: 0 });
  });
}

test.each([`Bun.resolveSync("./part.cjs", import.meta.dir)`])(
  "the build is quiet once the file is in the executable: %s",
  async asks => {
    const files = {
      "main.mjs": `import "./part.cjs";\n` + asking(asks),
      "part.cjs": `module.exports = "part";\n`,
    };
    const { compiled } = await buildAndRun(files, "main.mjs", []);
    expect(compiled).toEqual({ stdout: "SAID root/part.cjs\n", stderr: "", exitCode: 0 });
  },
);

// The executable holds no code that nothing reaches, so a call there misses nothing.
const part = { "part.cjs": `module.exports = "part";\n` };
const never = (asks: string) => `function never() {\n  return ${asks};\n}\n`;
test.each([`Bun.resolveSync(${made}, import.meta.dir)`, `Bun.resolveSync("./part.cjs", import.meta.dir)`])(
  "a call in a function that nothing calls gets no warning: %s",
  async asks => {
    const files = { "main.mjs": never(asks) + `console.log("SAID quiet");\n`, ...part };
    const { compiled } = await buildAndRun(files, "main.mjs", []);
    expect(compiled).toEqual({ stdout: "SAID quiet\n", stderr: "", exitCode: 0 });
  },
);

test("a call in an exported function that nothing imports gets no warning", async () => {
  const files = {
    "main.mjs": `import { other } from "./helper.mjs";\nconsole.log("SAID", other);\n`,
    "helper.mjs": `export const other = "quiet";\nexport ` + never(`Bun.resolveSync(${made}, import.meta.dir)`),
    ...part,
  };
  const { compiled } = await buildAndRun(files, "main.mjs", []);
  expect(compiled).toEqual({ stdout: "SAID quiet\n", stderr: "", exitCode: 0 });
});

test("a call in a function that is called gets its warning", async () => {
  const files = {
    "main.mjs":
      never(`Bun.resolveSync("./part.cjs", import.meta.dir)`) +
      `let said;\ntry {\n  said = never();\n} catch (error) {\n  said = error.code;\n}\nconsole.log("SAID", said);\n`,
    ...part,
  };
  const { compiled } = await buildAndRun(files, "main.mjs", [], ["TS100099"]);
  expect(compiled).toEqual({ stdout: `SAID ${missed}\n`, stderr: "", exitCode: 0 });
});

test("a require made for a folder looks from the folder above", async () => {
  const { plain, compiled } = await buildAndRun(
    {
      "main.mjs": `import "./outer/inner/run.cjs";\n`,
      "outer/part.cjs": `module.exports = "above";\n`,
      "outer/inner/part.cjs": `module.exports = "own";\n`,
      "outer/inner/run.cjs": `const { createRequire } = require("node:module");
${ask.replace("-5", "-2")}const other = createRequire(__dirname);
const made = ["./part", "cjs"].join(".");
console.log("SAID", ask(() => other.resolve("./part.cjs")), other("./part.cjs"));
console.log("SAID", ask(() => require.resolve(made)), require("./part.cjs"));
`,
    },
    "main.mjs",
    ["outer"],
  );
  expect(plain).toBe("SAID outer/part.cjs above\nSAID inner/part.cjs own\n");
  expect(compiled).toEqual({ stdout: plain, stderr: "", exitCode: 0 });
});
