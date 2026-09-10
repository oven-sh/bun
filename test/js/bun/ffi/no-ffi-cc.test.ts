// --no-ffi-cc and --no-addons disable bun:ffi and Bun.FFI. The module still
// loads, but everything that would reach native code throws ERR_FFI_DISABLED.
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Runs in a child process. Calls every bun:ffi entry point with arguments that
// are safe when FFI is enabled (nothing is dlopen'd, compiled C is never run)
// and reports, per entry, "ok", the error code, or the error message. The raw
// `native.dlopen` returns its error instead of throwing it. The address is
// taken once up front (0 when ptr() itself is disabled) so that every probe
// reaches its own entry point instead of failing inside its argument list.
// `report` receives the JSON string.
const probeWith = (report: string) => /* js */ `
  const ffi = require("bun:ffi");
  const describeError = e => (e && e.code) || String(e && e.message);
  const attempt = fn => {
    try {
      const result = fn();
      return Error.isError(result) ? describeError(result) : "ok";
    } catch (e) {
      return describeError(e);
    }
  };
  const bytes = new Uint8Array([104, 105, 0, 0, 0, 0, 0, 0]);
  let address = 0;
  const ptr = attempt(() => { address = ffi.ptr(bytes); });
  ${report}(JSON.stringify({
    BunFFI: typeof Bun.FFI,
    dlopen: attempt(() => ffi.dlopen("/does-not-exist-" + process.pid + "." + ffi.suffix, { f: { args: [], returns: "int" } })),
    nativeDlopen: attempt(() => ffi.native.dlopen("/does-not-exist-" + process.pid + "." + ffi.suffix, { f: { args: [], returns: "int" } })),
    cc: attempt(() => ffi.cc({ source: "does-not-exist.c", symbols: {} })),
    JSCallback: attempt(() => new ffi.JSCallback(() => {}, { args: [], returns: "void" }).close()),
    CFunction: attempt(() => ffi.CFunction({ ptr: address, args: [], returns: "void" })),
    linkSymbols: attempt(() => ffi.linkSymbols({ f: { ptr: address, args: [], returns: "void" } })),
    viewSource: attempt(() => ffi.viewSource({ f: { args: [], returns: "int" } }, false)),
    ptr,
    read: attempt(() => ffi.read.u8(address, 0)),
    toBuffer: attempt(() => ffi.toBuffer(address, 0, 8)),
    toArrayBuffer: attempt(() => ffi.toArrayBuffer(address, 0, 8)),
    CString: attempt(() => String(new ffi.CString(address))),
    CStringCall: attempt(() => String(ffi.CString(address))),
    FFIType: typeof ffi.FFIType.int,
    suffix: typeof ffi.suffix,
  }));
`;
const probe = probeWith("console.log");

const enabled = {
  BunFFI: "object",
  dlopen: "ERR_DLOPEN_FAILED",
  nativeDlopen: "ERR_DLOPEN_FAILED",
  cc: "Expected at least one exported symbol",
  JSCallback: "ok",
  CFunction: "ok",
  linkSymbols: "ok",
  viewSource: "ok",
  ptr: "ok",
  read: "ok",
  toBuffer: "ok",
  toArrayBuffer: "ok",
  CString: "ok",
  CStringCall: "ok",
  FFIType: "number",
  suffix: "string",
};

const disabled = {
  BunFFI: "undefined",
  dlopen: "ERR_FFI_DISABLED",
  nativeDlopen: "ERR_FFI_DISABLED",
  cc: "ERR_FFI_DISABLED",
  JSCallback: "ERR_FFI_DISABLED",
  CFunction: "ERR_FFI_DISABLED",
  linkSymbols: "ERR_FFI_DISABLED",
  viewSource: "ERR_FFI_DISABLED",
  ptr: "ERR_FFI_DISABLED",
  read: "ERR_FFI_DISABLED",
  toBuffer: "ERR_FFI_DISABLED",
  toArrayBuffer: "ERR_FFI_DISABLED",
  CString: "ERR_FFI_DISABLED",
  CStringCall: "ERR_FFI_DISABLED",
  // Plain constants stay available.
  FFIType: "number",
  suffix: "string",
};

async function run(args: string[], env: Record<string, string | undefined> = bunEnv, cwd?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The probe prints one JSON line last; debug builds may log lines before it.
  const lastLine = stdout.trimEnd().split("\n").at(-1) ?? "";
  const results = lastLine.startsWith("{") ? JSON.parse(lastLine) : stdout;
  return { results, stderr, exitCode };
}

// A macro runs at bundle time. Bun.build() runs it in a separate VM on a
// bundler thread, which has no parent VM to inherit the flags from.
// process.dlopen is only probed on request (PROBE_PROCESS_DLOPEN=1).
const macroFiles = {
  "macro.ts": /* ts */ `
    import { ptr } from "bun:ffi";
    const attempt = (fn: () => unknown) => {
      try {
        fn();
        return "ok";
      } catch (e: any) {
        return (e && e.code) || "threw";
      }
    };
    export function probe() {
      return {
        BunFFI: typeof Bun.FFI,
        ptr: attempt(() => ptr(new Uint8Array(8))),
        processDlopen:
          process.env.PROBE_PROCESS_DLOPEN === "1"
            ? attempt(() => (process as any).dlopen({ exports: {} }, "/does-not-exist-" + process.pid + ".node"))
            : "skipped",
      };
    }
  `,
  "entry.ts": /* ts */ `
    import { probe } from "./macro.ts" with { type: "macro" };
    export const result = probe();
  `,
  "build.ts": /* ts */ `
    const build = await Bun.build({ entrypoints: ["./entry.ts"], target: "bun", outdir: "./out" });
    if (!build.success) throw new AggregateError(build.logs, "build failed");
    const { result } = await import("./out/entry.js");
    console.log(JSON.stringify(result));
  `,
};

describe.concurrent("--no-ffi-cc / --no-addons", () => {
  it("bun:ffi works by default", async () => {
    const { results, stderr, exitCode } = await run(["-e", probe]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: enabled, exitCode: 0 });
  });

  it("--no-ffi-cc disables every bun:ffi function and Bun.FFI", async () => {
    const { results, stderr, exitCode } = await run(["--no-ffi-cc", "-e", probe]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("--no-addons disables every bun:ffi function and Bun.FFI", async () => {
    const { results, stderr, exitCode } = await run(["--no-addons", "-e", probe]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("BUN_OPTIONS=--no-ffi-cc disables bun:ffi", async () => {
    const { results, stderr, exitCode } = await run(["-e", probe], { ...bunEnv, BUN_OPTIONS: "--no-ffi-cc" });
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("import from bun:ffi still resolves when disabled", async () => {
    const { results, stderr, exitCode } = await run([
      "--no-ffi-cc",
      "-e",
      'import { dlopen, FFIType, suffix } from "bun:ffi"; console.log(JSON.stringify({ dlopen: typeof dlopen, FFIType: typeof FFIType.int, suffix: typeof suffix }));',
    ]);
    expect({ results, stderr, exitCode }).toMatchObject({
      results: { dlopen: "function", FFIType: "number", suffix: "string" },
      exitCode: 0,
    });
  });

  it("the uncaught error names the flags", async () => {
    const { results, stderr, exitCode } = await run([
      "--no-ffi-cc",
      "-e",
      'require("bun:ffi").dlopen("libfoo", { f: { args: [], returns: "int" } })',
    ]);
    expect(results).toBe("");
    expect(stderr).toContain(
      "error: bun:ffi is not available because FFI was disabled with --no-ffi-cc or --no-addons.",
    );
    expect(stderr).toContain('code: "ERR_FFI_DISABLED"');
    expect(exitCode).toBe(1);
  });

  // The Worker runs the probe and posts the JSON back to the parent. A worker
  // that fails before it posts is reported on stdout instead of hanging.
  const workerHost = (execArgv: string) => /* js */ `
    const { Worker } = require("node:worker_threads");
    const source = ${JSON.stringify(probeWith("require('node:worker_threads').parentPort.postMessage"))};
    const worker = new Worker(source, { eval: true, execArgv: ${execArgv} });
    let reported = false;
    worker.on("message", msg => {
      reported = true;
      console.log(msg);
      worker.terminate();
    });
    worker.on("error", e => {
      reported = true;
      console.log("worker error: " + (e.code ?? e.message));
      worker.terminate();
    });
    worker.on("exit", code => {
      if (!reported) console.log("worker exited with " + code + " before posting");
    });
  `;

  it("a Worker has bun:ffi by default", async () => {
    const { results, stderr, exitCode } = await run(["-e", workerHost("undefined")]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: enabled, exitCode: 0 });
  });

  it("--no-ffi-cc stays in effect inside a Worker with an empty execArgv", async () => {
    const { results, stderr, exitCode } = await run(["--no-ffi-cc", "-e", workerHost("[]")]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("--no-addons stays in effect inside a Worker with an empty execArgv", async () => {
    const { results, stderr, exitCode } = await run(["--no-addons", "-e", workerHost("[]")]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("a Worker can disable bun:ffi for itself with execArgv: ['--no-ffi-cc']", async () => {
    const { results, stderr, exitCode } = await run(["-e", workerHost('["--no-ffi-cc"]')]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("a Worker can disable bun:ffi for itself with execArgv: ['--no-addons']", async () => {
    const { results, stderr, exitCode } = await run(["-e", workerHost('["--no-addons"]')]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("a Worker cannot re-enable bun:ffi that its parent disabled", async () => {
    const { results, stderr, exitCode } = await run(["--no-ffi-cc", "-e", workerHost('["--smol"]')]);
    expect({ results, stderr, exitCode }).toMatchObject({ results: disabled, exitCode: 0 });
  });

  it("Bun stays inspectable when FFI is disabled", async () => {
    const { results, stderr, exitCode } = await run([
      "--no-ffi-cc",
      "-e",
      'for (const key in Bun) void Bun[key]; Bun.inspect(Bun); console.log(JSON.stringify({ hasFFIKey: Object.keys(Bun).includes("FFI"), FFI: typeof Bun.FFI }));',
    ]);
    expect({ results, stderr, exitCode }).toMatchObject({
      results: { hasFFIKey: true, FFI: "undefined" },
      exitCode: 0,
    });
  });

  it("a macro run by Bun.build() has bun:ffi by default", async () => {
    using dir = tempDir("no-ffi-cc-macro", macroFiles);
    const { results, stderr, exitCode } = await run(["build.ts"], bunEnv, String(dir));
    expect({ results, stderr, exitCode }).toMatchObject({
      results: { BunFFI: "object", ptr: "ok", processDlopen: "skipped" },
      exitCode: 0,
    });
  });

  it("--no-ffi-cc also applies to a macro run by Bun.build()", async () => {
    using dir = tempDir("no-ffi-cc-macro", macroFiles);
    const { results, stderr, exitCode } = await run(["--no-ffi-cc", "build.ts"], bunEnv, String(dir));
    expect({ results, stderr, exitCode }).toMatchObject({
      results: { BunFFI: "undefined", ptr: "ERR_FFI_DISABLED", processDlopen: "skipped" },
      exitCode: 0,
    });
  });

  it("--no-addons also applies to a macro run by Bun.build(), including process.dlopen", async () => {
    using dir = tempDir("no-ffi-cc-macro", macroFiles);
    const { results, stderr, exitCode } = await run(
      ["--no-addons", "build.ts"],
      { ...bunEnv, PROBE_PROCESS_DLOPEN: "1" },
      String(dir),
    );
    expect({ results, stderr, exitCode }).toMatchObject({
      results: { BunFFI: "undefined", ptr: "ERR_FFI_DISABLED", processDlopen: "ERR_DLOPEN_DISABLED" },
      exitCode: 0,
    });
  });
});
