import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// A static import that cannot be resolved fails the load of every module that reaches it, before any of them is evaluated, and the error
// names the file that wrote the import. Libraries try an optional dependency this way: `import("./adapter.mjs").catch(..)`.

const files = {
  "sub/first.mjs": `console.log("first runs");`,
  "sub/importer.mjs": `import "./first.mjs";
import x from "not-installed";
console.log("importer runs", x);
`,
  "sub/over.mjs": `import "./second.mjs";
import "./importer.mjs";
console.log("over runs");
`,
  "sub/second.mjs": `console.log("second runs");`,
  "sub/relative.mjs": `import "./first.mjs";
import "./not-there.mjs";
`,
  "sub/left.mjs": `import "./first.mjs";
import "./right.mjs";
console.log("left runs");
`,
  "sub/right.mjs": `import "./left.mjs";
import "@scope/not-installed/part";
console.log("right runs");
`,
  "sub/exports-again.mjs": `import "./first.mjs";
export * from "not-installed";
`,
  "sub/fine.mjs": `import "./first.mjs";
import { join } from "node:path";
console.log("fine runs", typeof join);
`,
};

const show = `const show = e => console.log([e.name, e.message, e.code, e.referrer, e.specifier, e.importKind].join(" | ").replaceAll(import.meta.dir, "<dir>"));\n`;

const programs: Record<string, string> = {
  "an-optional-dependency.mjs": `${show}console.log("entry begins");
await import("./sub/importer.mjs").catch(show);
console.log("entry goes on");
`,
  "two-files-above.mjs": `${show}await import("./sub/over.mjs").catch(show);
await import("./sub/second.mjs");
`,
  "a-file-that-is-not-there.mjs": `${show}await import("./sub/relative.mjs").catch(show);`,
  "in-a-cycle.mjs": `${show}await import("./sub/left.mjs").catch(show);
await import("./sub/right.mjs").catch(show);
`,
  "exported-again.mjs": `${show}await import("./sub/exports-again.mjs").catch(show);`,
  "twice.mjs": `${show}await import("./sub/importer.mjs").catch(show);
await import("./sub/importer.mjs").catch(show);
await import("./sub/first.mjs");
`,
  "required.cjs": `${show.replaceAll("import.meta.dir", "__dirname")}try { require("./sub/importer.mjs"); } catch (e) { show(e); }
console.log("entry goes on");
`,
  "what-resolves-is-as-it-was.mjs": `await import("./sub/fine.mjs");`,
  "from-the-entry-point.mjs": `import "./sub/second.mjs";
import "./sub/importer.mjs";
console.log("entry runs");
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot does what bun run does", async () => {
    using dir = tempDir("unresolved-imports", { ...files, [entry]: programs[entry] });
    const run = async (flags: string[]) => {
      const { stdout, stderr, exitCode } = await runCommand([bunExe(), "run", ...flags, entry], String(dir));
      return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode };
    };
    const [plain, aot] = [await run([]), await run(["--debug-aot"])];
    // Where the entry point reaches the import, nothing runs either way: the build says in its own words what the loader says.
    const named =
      entry === "from-the-entry-point.mjs"
        ? (errors: string[]) => errors.map(line => line.includes("not-installed"))
        : (errors: string[]) => errors;
    expect({ ...aot, errors: named(aot.errors) }).toEqual({ ...plain, errors: named(plain.errors) });
  });
});
