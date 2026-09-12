import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(cwd: string, argv: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argv],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const ok = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });

describe("--extension-order", () => {
  const files = {
    "d.ts": `export default "TS";\n`,
    "d.js": `export default "JS";\n`,
    "i.ts": `import x from "./d"; console.log("import", x);\n`,
    "r.cjs": `console.log("require", require("./d").default);\n`,
    "dyn.ts": `import("./d").then(m => console.log("dynamic", m.default));\n`,
    "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "./index.js" }),
    "node_modules/pkg/index.js": `import x from "./sub"; export default x;\n`,
    "node_modules/pkg/sub.mjs": `export default "PKG-MJS";\n`,
    "node_modules/pkg/sub.js": `export default "PKG-JS";\n`,
    "p.ts": `import x from "pkg"; console.log("pkg", x);\n`,
  };

  describe.each([
    [["--extension-order=.js", "--extension-order=.ts"]],
    [["--extension-order=.js,.ts"]],
    [["--extension-order", ".js,.ts"]],
  ])("%p", flags => {
    test.concurrent("applies to import statements", async () => {
      using dir = tempDir("ext-order", files);
      expect(await run(String(dir), [...flags, "i.ts"])).toEqual(ok("import JS\n"));
    });

    test.concurrent("applies to require()", async () => {
      using dir = tempDir("ext-order", files);
      expect(await run(String(dir), [...flags, "r.cjs"])).toEqual(ok("require JS\n"));
    });

    test.concurrent("applies to dynamic import", async () => {
      using dir = tempDir("ext-order", files);
      expect(await run(String(dir), [...flags, "dyn.ts"])).toEqual(ok("dynamic JS\n"));
    });

    test.concurrent("applies inside node_modules", async () => {
      using dir = tempDir("ext-order", files);
      expect(await run(String(dir), [...flags, "p.ts"])).toEqual(ok("pkg PKG-JS\n"));
    });
  });

  test.concurrent("defaults still prefer .ts over .js for import without the flag", async () => {
    using dir = tempDir("ext-order", files);
    expect(await run(String(dir), ["i.ts"])).toEqual(ok("import TS\n"));
  });
});

describe("--main-fields", () => {
  const files = {
    "node_modules/mf/package.json": JSON.stringify({
      name: "mf",
      main: "./main.js",
      module: "./module.js",
    }),
    "node_modules/mf/main.js": `export default "main";\n`,
    "node_modules/mf/module.js": `export default "module";\n`,
    "m.ts": `import x from "mf"; console.log(x);\n`,
  };

  describe.each([
    [["--main-fields=module", "--main-fields=main"]],
    [["--main-fields=module,main"]],
    [["--main-fields", "module,main"]],
  ])("%p", flags => {
    test.concurrent("resolves the first matching field", async () => {
      using dir = tempDir("main-fields", files);
      expect(await run(String(dir), [...flags, "m.ts"])).toEqual(ok("module\n"));
    });
  });

  test.concurrent("--main-fields=main,module prefers main", async () => {
    using dir = tempDir("main-fields", files);
    expect(await run(String(dir), ["--main-fields=main,module", "m.ts"])).toEqual(ok("main\n"));
  });
});
