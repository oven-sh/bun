import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// ONE TEST FILE OF SEVERAL IS RUN, as a shard of CI runs a part of a suite. A helper writes a file of code to disk and imports it.
// A file of the tests may do that. A file of the product may not: the compiled run refuses the load, as the executable would.
// Whose a file is goes by what speaks for the product: a way in that a manifest names, a file on disk that imports it and to which no test file leads, and what such a file imports.
// It went by one step from a test file: a helper that a fixture imports too was the product's, and so was one that a fixture of a test file outside the run imports.
// The tests' files are found from the tests down: a file whose every importer is a file of the tests or such a file. A ring of imports that a test enters is never begun,
// so a program of any size stays the product's but for its top. The shapes that begin with REFUSED are the controls. Each shape is a project of its own.
const shapes: Record<string, Record<string, string>> = {
  "REFUSED-a-test-enters-a-ring-of-imports": {
    "a.test.ts": `import { test } from "bun:test";
import { run } from "./src/main";
test("a", async () => { console.log("SEEN", (await run()).answer); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/loads.ts": `import { name } from "./main";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-" + name)), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
    "src/main.ts": `import { loadWritten } from "./loads";
export const name = "main";
export const run = () => loadWritten("export const answer = 5;");
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "REFUSED-what-a-ring-imports": {
    "a.test.ts": `import { test } from "bun:test";
import { run } from "./src/main";
test("a", async () => { console.log("SEEN", (await run()).answer); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/loads.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
    "src/main.ts": `import { other } from "./other";
import { loadWritten } from "./loads";
export const name = "main";
export const run = () => other() && loadWritten("export const answer = 5;");
`,
    "src/other.ts": `import { name } from "./main";
export const other = () => name.length > 0;
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "REFUSED-a-manifest-names-the-entry-point-that-a-test-imports": {
    "a.test.ts": `import { test } from "bun:test";
import { run } from "./src/main";
test("a", async () => { console.log("SEEN", (await run()).answer); });
`,
    "package.json": `{ "name": "p", "type": "module", "main": "./src/main.ts" }
`,
    "src/loads.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
    "src/main.ts": `import { loadWritten } from "./loads";
export const run = () => loadWritten("export const answer = 5;");
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "REFUSED-the-product-imports-the-fixture-too": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("a", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { viaFixture } from "./fixtures/fixture";
test("b", async () => { console.log("SEEN", (await viaFixture()).answer); });
`,
    "fixtures/fixture.ts": `import { loadWritten } from "../support/helper";
export const viaFixture = () => loadWritten("export const answer = 7;");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/main.ts": `import { viaFixture } from "../fixtures/fixture";
console.log((await viaFixture()).answer);
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "REFUSED-the-product-imports-the-helper": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("a", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/main.ts": `import { loadWritten } from "../support/helper";
console.log((await loadWritten("export const answer = 1;")).answer);
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "a-fixture-of-another-test-file-imports-the-helper": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("a", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { viaFixture } from "./fixtures/fixture";
test("b", async () => { console.log("SEEN", (await viaFixture()).answer); });
`,
    "fixtures/fixture.ts": `import { loadWritten } from "../support/helper";
export const viaFixture = () => loadWritten("export const answer = 7;");
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "a-test-imports-the-entry-point-and-no-manifest-names-it": {
    "a.test.ts": `import { test } from "bun:test";
import { run } from "./src/main";
test("a", async () => { console.log("SEEN", (await run()).answer); });
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "src/loads.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
    "src/main.ts": `import { loadWritten } from "./loads";
export const run = () => loadWritten("export const answer = 5;");
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "another-test-file-imports-the-helper": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("a", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("b", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "in-the-run-a-fixture-behind-an-index-file-imports-the-helper": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
import Fixtures from "./fixtures";
test("a", async () => {
  console.log("SEEN", (await loadWritten("export const answer = 42;")).answer, (await Fixtures.viaFixture()).answer);
});
`,
    "fixtures/fixture.ts": `import { loadWritten } from "../support/helper";
export const viaFixture = () => loadWritten("export const answer = 7;");
`,
    "fixtures/index.ts": `import { viaFixture } from "./fixture";
export default { viaFixture };
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "the-fixture-comes-through-an-index-file": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("a", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { viaFixture } from "./fixtures";
test("b", async () => { console.log("SEEN", (await viaFixture()).answer); });
`,
    "fixtures/fixture.ts": `import { loadWritten } from "../support/helper";
export const viaFixture = () => loadWritten("export const answer = 7;");
`,
    "fixtures/index.ts": `export * from "./fixture";
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "the-tests-alone-import-the-helper": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("a", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
  "two-fixtures-in-a-row": {
    "a.test.ts": `import { test } from "bun:test";
import { loadWritten } from "./support/helper";
test("a", async () => {
  const loaded = await loadWritten("export const answer = 42;");
  console.log("SEEN", loaded.answer);
});
`,
    "b.test.ts": `import { test } from "bun:test";
import { outer } from "./fixtures/outer";
test("b", async () => { console.log("SEEN", (await outer()).answer); });
`,
    "fixtures/fixture.ts": `import { loadWritten } from "../support/helper";
export const viaFixture = () => loadWritten("export const answer = 7;");
`,
    "fixtures/outer.ts": `import { viaFixture } from "./fixture";
export const outer = () => viaFixture();
`,
    "package.json": `{ "name": "p", "type": "module" }
`,
    "support/helper.ts": `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function loadWritten(text: string) {
  const path = join(mkdtempSync(join(tmpdir(), "whose-")), "written.mjs");
  writeFileSync(path, text);
  return await import(path);
}
`,
  },
};

for (const [name, files] of Object.entries(shapes)) {
  test.concurrent(`whose a helper is that loads what it has written: ${name}`, async () => {
    using dir = tempDir("aot-whose-a-file-is", files);
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "a.test.ts"], String(dir), bunEnv);
      return {
        lines: stdout.split("\n").filter(line => line.startsWith("SEEN")),
        refused: (stdout + stderr).includes("it wasn't compiled with the program"),
        exitCode,
      };
    };
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain.lines.length).toBe(1);
    expect(plain).toMatchObject({ refused: false, exitCode: 0 });
    if (name.startsWith("REFUSED-")) {
      expect(compiled).toEqual({ lines: [], refused: true, exitCode: 1 });
    } else {
      expect(compiled).toEqual(plain);
    }
  }, 120_000);
}
