import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

describe("process.binding", () => {
  test("process.binding('constants')", () => {
    /* @ts-ignore */
    const constants = process.binding("constants");
    expect(constants).toBeDefined();
    expect(constants).toHaveProperty("os");
    expect(constants).toHaveProperty("crypto");
    expect(constants).toHaveProperty("fs");
    expect(constants).toHaveProperty("trace");
    expect(constants).toHaveProperty("zlib");
  });
  test("process.binding('uv')", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");
    expect(uv).toBeDefined();

    expect(uv).toHaveProperty("errname");
    expect(uv).toHaveProperty("UV_EACCES");
    // UV_EINTR is -4 on POSIX and a libuv-synthetic code on Windows.
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");
    // force the number to be represented as a double
    expect(uv.errname(uv.UV_EINTR - 1.9 + Number("1.9"))).toBe("EINTR");
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");

    expect(uv.errname(5)).toBe("Unknown system error 5");

    const map = uv.getErrorMap();
    expect(map).toBeDefined();
    expect(map.get(uv.UV_EISCONN)).toEqual(["EISCONN", "socket is already connected"]);

    // The binding object must be spreadable like a plain {} (nonzero inline
    // capacity so JSC's spread fast path does not trip hasInlineStorage()).
    expect({ ...uv }.UV_EACCES).toBe(uv.UV_EACCES);
    expect(Object.assign({}, uv).UV_EACCES).toBe(uv.UV_EACCES);
  });
});

// process.binding is public, deprecated (DEP0111) and replaceable. Node.js builtins read their bindings through the
// private internalBinding(). Bun's builtins read them through private accessors, and src/codegen/replacements.ts
// rejects process.binding in src/js.
describe("built-in modules do not use the public process.binding", () => {
  async function run(...args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let output: unknown = stdout;
    try {
      output = JSON.parse(stdout);
    } catch {}
    return { output, stderr, exitCode };
  }

  test.concurrent("they load and work after the program replaced it", async () => {
    expect(await run(path.join(import.meta.dir, "process-binding-replaced-fixture.js"))).toEqual({
      output: { reads: 0, connectedTo: "127.0.0.1", ws: ["ECONNREFUSED", "ECONNREFUSED"], method: "PROPFIND" },
      stderr: "",
      exitCode: 0,
    });
  });

  // Every call of the public function is a call by the program, so --pending-deprecation treats it as Node.js
  // does: deprecate() warns once, and a call that process.noDeprecation hides does not use that warning up. The
  // nearest JS frame of the second call is node:events, a builtin.
  test.concurrent(
    "--pending-deprecation warns for the first call that process.noDeprecation does not hide",
    async () => {
      const script = `
      let warnings = 0;
      process.on("warning", warning => {
        if (warning.code === "DEP0111") warnings++;
      });
      // A warning is emitted on the next tick.
      async function takeWarnings() {
        await new Promise(resolve => setImmediate(resolve));
        const count = warnings;
        warnings = 0;
        return count;
      }
      (async () => {
        process.noDeprecation = true;
        process.binding("uv");
        process.noDeprecation = false;
        const hidden = await takeWarnings();
        new (require("node:events"))().on("call", process.binding).emit("call", "uv");
        const throughEmitter = await takeWarnings();
        process.binding("uv");
        const again = await takeWarnings();
        console.log(JSON.stringify({ hidden, throughEmitter, again }));
      })();
    `;
      expect(await run("--pending-deprecation", "--no-warnings", "-e", script)).toEqual({
        output: { hidden: 0, throughEmitter: 1, again: 0 },
        stderr: "",
        exitCode: 0,
      });
    },
  );
});
