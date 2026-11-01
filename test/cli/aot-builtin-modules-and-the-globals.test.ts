import { expect } from "bun:test";
import { isWindows, tempDir } from "harness";
import { test } from "../aot/supported";
import { compileEachAlone, importingByName, oneAfterTheOther, startsAtAnyEntryPoint } from "./aot-builtin-modules";

const plain = "plain.mjs";

const withoutADoor: Record<string, string> = {
  "takes-process-apart.mjs": `const { env, argv } = process;\nconsole.log(env && argv ? "run" : "");`,
  "takes-process-apart-under-other-names.mjs": `const { env: variables, platform = "none" } = process;\nconsole.log(variables && platform ? "run" : "");`,
  "tests-process.mjs": `console.log(typeof process !== "undefined" && process && process.env ? "run" : "");`,
  "compares-process-with-null.mjs": `if (process != null) console.log("run");`,
  "tests-the-global-object.mjs": `console.log(typeof globalThis !== "undefined" && globalThis && globalThis.Array ? "run" : "");`,
};

const loads = `const name = ["node:querystring"][0];\n`;
const withADoor = importingByName("node:querystring", {
  "takes-the-loader-out-of-process.mjs": `${loads}const { getBuiltinModule } = process;\nconsole.log(typeof getBuiltinModule(name).escape === "function" ? "run" : "");`,
  "takes-process-apart-by-a-computed-name.mjs": `${loads}const { ["get" + "BuiltinModule"]: load } = process;\nconsole.log(typeof load(name).escape === "function" ? "run" : "");`,
  "keeps-process.mjs": `${loads}const kept = process || {};\nconsole.log(typeof kept.getBuiltinModule(name).escape === "function" ? "run" : "");`,
  "keeps-the-global-object.mjs": `${loads}const kept = typeof globalThis !== "undefined" && globalThis;\nconsole.log(typeof kept.process.getBuiltinModule(name).escape === "function" ? "run" : "");`,
});

const harmless = "without-a-door.mjs";
const loading = "with-a-door.mjs";

test.skipIf(!startsAtAnyEntryPoint)(
  "what only reads written properties of process, or tests a global, brings no built-in module into the executable",
  async () => {
    using dir = tempDir("builtin-modules-and-the-globals", {
      [plain]: `console.log("run");`,
      ...withoutADoor,
      ...withADoor,
      [harmless]: oneAfterTheOther(withoutADoor),
      [loading]: oneAfterTheOther(withADoor),
    });
    const ran = await compileEachAlone(String(dir), [plain, harmless, loading]);
    expect(ran).toEqual({
      [plain]: { stdout: "run\n", exitCode: 0, bytes: expect.any(Number) },
      [harmless]: { stdout: "run\n".repeat(Object.keys(withoutADoor).length), exitCode: 0, bytes: expect.any(Number) },
      [loading]: { stdout: "run\n".repeat(Object.keys(withADoor).length), exitCode: 0, bytes: expect.any(Number) },
    });
    // TODO: on Windows process.env is a Proxy that the library makes in JavaScript, and it brings more than that.
    if (!isWindows) expect(ran[harmless].bytes - ran[plain].bytes).toBeLessThanOrEqual(64 * 1024);
  },
  180_000,
);
