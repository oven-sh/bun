import { spawnSync } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

it("Should support printing 'hello world'", () => {
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), import.meta.dir + "/hello-wasi.wasm"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect({
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    exitCode: exitCode,
  }).toEqual({
    stdout: "hello world\n",
    stderr: "",
    exitCode: 0,
  });
});

// node:wasi path_open must resolve the guest path against the preopen's
// mapped host directory, not against process.cwd(). Every other path_*
// handler in src/js/node/wasi.ts does this; path_open used to call
// path.resolve(p) (no base), making a WASM program that path_opens an
// entry under its preopen fail with ENOENT at cwd.
// Regression guard for oven-sh/bun#30302.
it("node:wasi path_open resolves against the preopen host dir, not cwd", async () => {
  using dir = tempDir("wasi-preopen", {
    "work/input.txt": "hello from host file",
    // Deliberately place a wrong-looking file at `cwd/input.txt` so that
    // the buggy cwd-relative lookup would pick this up instead of erroring
    // — catches a regression that silently opens the wrong file.
    "input.txt": "wrong file — should never be read",
    "runner.mjs": `
      import fs from "node:fs";
      import { WASI } from "node:wasi";

      const workDir = process.argv[2];
      const wasmPath = process.argv[3];
      const wasi = new WASI({
        version: "preview1",
        preopens: { "/work": workDir },
      });
      const wasmBytes = fs.readFileSync(wasmPath);
      const module = await WebAssembly.compile(wasmBytes);
      const instance = await WebAssembly.instantiate(module, wasi.getImports(module));
      try {
        wasi.start(instance);
      } catch (err) {
        process.stderr.write("wasi.start threw: " + (err?.message ?? err) + "\\n");
        process.exit(2);
      }
    `,
  });

  const cwd = String(dir);
  const workDir = join(cwd, "work");
  const wasmPath = join(import.meta.dir, "preopen-wasi.wasm");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "runner.mjs", workDir, wasmPath],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The WASM program proc_exits(0) on success; non-zero encodes which step
  // failed. See test/js/bun/wasm/preopen-wasi.c.
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // The preopen points at <cwd>/work, so the output file must land there,
  // with "got: " prefixed to the host-dir input's contents.
  expect(await Bun.file(join(workDir, "output.txt")).text()).toBe("got: hello from host file");
});
