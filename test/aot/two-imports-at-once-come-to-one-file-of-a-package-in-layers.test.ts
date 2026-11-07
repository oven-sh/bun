import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A file of the project starts two import()s at once. The long one comes to first.js of a package, which imports shared.js, then to a file of the project that imports
// shared.js itself, and still has files to load. The short one comes to shared.js through second.js alone, runs it and settles. In layers the package is one program and
// the project another: the package's program had no load of its own, so it let go of the record of shared.js when the short import settled, and the long one was rejected:
// TypeError: The module ".../shared.js" is not loaded. Under Promise.allSettled nobody hears of it.
const filesOfLongImport = 8;
const whereLongImportAsksForShared = [2, 3, 4];

function project() {
  const files: Record<string, string> = {
    "package.json": `{ "name": "two-imports-at-once", "type": "module" }`,
    "a.test.js": `
      import { test } from "bun:test";
      import { early, loads } from "./src/main.js";
      test("both imports are fulfilled", async () => {
        console.log("SAID early", early);
        for (const load of loads)
          console.log("SAID", (await load()).map(one => (one.status === "fulfilled" ? one.value.default : one.reason.message)).join(" | "));
      });`,
    "b.test.js": `
      import { test } from "bun:test";
      import { early } from "./src/main.js";
      test("another file, so that the run has pieces", () => console.log("SAID early", early));`,
  };
  const main: string[] = [];
  for (const place of whereLongImportAsksForShared) {
    const name = `pk${place}`;
    files[`node_modules/${name}/package.json`] = `{ "name": "${name}", "type": "module" }`;
    files[`node_modules/${name}/shared.js`] = `export default () => 3;`;
    files[`node_modules/${name}/first.js`] = `import shared from "./shared.js";\nexport default () => shared() + 10;`;
    files[`node_modules/${name}/second.js`] = `import shared from "./shared.js";\nexport default () => shared() + 20;`;
    files[`node_modules/${name}/early.js`] = `export default () => ${place};`;
    for (let file = 1; file <= filesOfLongImport; file++) {
      const lines = [file < filesOfLongImport ? `import below from "./${file + 1}.js";` : `const below = 0;`];
      const sum = ["below", "1"];
      if (file === 1) {
        lines.unshift(`import first from "${name}/first.js";`);
        sum.push("first()");
      }
      if (file === place) {
        lines.unshift(`import shared from "${name}/shared.js";`);
        sum.push("shared()");
      }
      files[`src/long${place}/${file}.js`] = [...lines, `export default ${sum.join(" + ")};`].join("\n");
    }
    files[`src/short${place}.js`] = `import second from "${name}/second.js";\nexport default second();`;
    main.push(`import early${place} from "${name}/early.js";`);
  }
  files["src/main.js"] = [
    ...main,
    `export const early = ${whereLongImportAsksForShared.map(place => `early${place}()`).join(" + ")};`,
    `export const loads = [`,
    ...whereLongImportAsksForShared.map(
      place => `  () => Promise.allSettled([import("./long${place}/1.js"), import("./short${place}.js")]),`,
    ),
    `];`,
  ].join("\n");
  return files;
}

test("an import() is not rejected because another one, which ran a file of the same package, settled first", async () => {
  using dir = tempDir("aot-two-imports-at-once", project());
  const said = async (words: string | undefined, ...flags: string[]) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", ...flags, "./a.test.js", "./b.test.js"],
      String(dir),
      env,
    );
    return {
      said: stdout
        .split("\n")
        .filter(line => line.startsWith("SAID"))
        .sort(),
      summary: stderr.split("\n").filter(line => / (pass|fail)$/.test(line)),
      exitCode,
    };
  };
  const plain = await said(undefined);
  expect(plain).toEqual({
    said: ["SAID 24 | 23", "SAID 24 | 23", "SAID 24 | 23", "SAID early 9", "SAID early 9"],
    summary: [" 2 pass", " 0 fail"],
    exitCode: 0,
  });
  expect(await said("TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
  expect(await said("TestRunLayers:0", "--aot")).toEqual(plain);
}, 240_000);
