import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { EventEmitter } from "node:events";
import os from "node:os";
import util from "node:util";

// Node assigns `code` (and the warning's name/code/detail) as plain enumerable own
// properties (lib/internal/errors.js, lib/internal/process/warning.js). Structured
// loggers and `JSON.stringify` rely on that.

function capture(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("did not throw");
}

test("ERR_* code is an own enumerable property", () => {
  const e = capture(() => Buffer.alloc(-1));
  expect(e.code).toBe("ERR_OUT_OF_RANGE");
  expect(Object.getOwnPropertyDescriptor(e, "code")).toEqual({
    value: "ERR_OUT_OF_RANGE",
    writable: true,
    enumerable: true,
    configurable: true,
  });
  expect(Object.keys(e)).toEqual(["code"]);
  const forIn: string[] = [];
  for (const k in e) forIn.push(k);
  expect(forIn).toEqual(["code"]);
  expect(JSON.stringify(e)).toBe('{"code":"ERR_OUT_OF_RANGE"}');
  expect({ ...e }.code).toBe("ERR_OUT_OF_RANGE");
  expect(util.inspect(e)).toContain("code: 'ERR_OUT_OF_RANGE'");
});

test("ERR_* code comes before the extra properties a site adds", () => {
  const e = capture(() => new EventEmitter().emit("error", 42));
  expect(e.code).toBe("ERR_UNHANDLED_ERROR");
  expect(Object.keys(e)).toEqual(["code", "context"]);
  expect(JSON.parse(JSON.stringify(e))).toEqual({ code: "ERR_UNHANDLED_ERROR", context: 42 });
});

test("ERR_INVALID_ARG_VALUE RangeError carries an own enumerable code", () => {
  const e = capture(() => process.cpuUsage({ user: -1, system: 0 }));
  expect(e.name).toBe("RangeError");
  expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
  expect(Object.keys(e)).toEqual(["code"]);
});

test("ERR_* code is writable and deletable like in node", () => {
  const e = capture(() => Buffer.alloc(-1));
  e.code = "CUSTOM";
  expect(e.code).toBe("CUSTOM");
  delete e.code;
  expect(Object.hasOwn(e, "code")).toBe(false);
  expect(e.code).toBeUndefined();
  // The Node-style toString lives on the shared prototype and keeps working.
  expect(capture(() => Buffer.alloc(-1)).toString()).toStartWith("RangeError [ERR_OUT_OF_RANGE]: ");
});

test("ERR_SYSTEM_ERROR code is enumerable next to info, errno and syscall", () => {
  const e = capture(() => os.setPriority(-1, 0));
  expect(e.code).toBe("ERR_SYSTEM_ERROR");
  expect(Object.keys(e).sort()).toEqual(["code", "errno", "info", "syscall"]);
});

test("warning objects expose name, code and detail as enumerable properties", async () => {
  // A separate process: other test files in the same run can replace the "warning" listeners.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--no-warnings",
      "-e",
      `const seen = [];
       process.on("warning", w => seen.push({ keys: Object.keys(w), json: JSON.parse(JSON.stringify(w)) }));
       process.emitWarning("w", { code: "MY_CODE", detail: "d" });
       // Like Node, an Error passed in is emitted as is: no name, code or detail are added to it.
       process.emitWarning(new Error("e"), { type: "DeprecationWarning", code: "DEP0199", detail: "d" });
       process.on("exit", () => console.log(JSON.stringify(seen)));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([
    { keys: ["name", "code", "detail"], json: { name: "Warning", code: "MY_CODE", detail: "d" } },
    { keys: [], json: {} },
  ]);
  expect(exitCode).toBe(0);
});
