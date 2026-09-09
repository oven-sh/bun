// Bun ships a builtin undici shim, but it is only a fallback: when the real
// package is installed in node_modules, bare "undici" must resolve to the
// installed copy (https://github.com/oven-sh/bun/issues/36098).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import Module, { createRequire } from "node:module";
import { join } from "node:path";
// The Next.js compat alias always maps to the shim.
import { Agent as ShimAgent } from "next/dist/compiled/undici";
// test/node_modules has the real undici installed.
import { Agent, Dispatcher, MockAgent } from "undici";

describe.concurrent("undici prefer-installed resolution", () => {
  test("installed undici wins over the builtin shim", () => {
    // The shim's MockAgent is an empty class; the real package has the
    // interception API.
    const agent = new MockAgent();
    expect(typeof agent.disableNetConnect).toBe("function");
    expect(typeof agent.get).toBe("function");

    const resolved = require.resolve("undici");
    expect(resolved).not.toBe("undici");
    expect(resolved).toContain("node_modules");
  });

  test("installed undici has a dispatcher layer (#42084)", () => {
    // The shim's Dispatcher and Agent are empty classes.
    const proto = Object.getOwnPropertyNames(Dispatcher.prototype);
    expect(proto).toEqual(expect.arrayContaining(["dispatch", "close", "destroy", "request", "stream", "pipeline"]));
    expect(typeof new Agent().dispatch).toBe("function");
    expect(typeof new ShimAgent().dispatch).toBe("undefined");

    const esmRequire = createRequire(import.meta.url);
    expect(esmRequire.resolve("undici")).toContain("node_modules");
  });

  test("dynamic import agrees with the static import", async () => {
    const installed = await import("undici");
    expect(installed.Agent).toBe(Agent);

    // The module loader resolves the shim's key a second time for a dynamic
    // import. That must not turn it into the installed package.
    const shim = await import("next/dist/compiled/undici");
    expect(shim.Agent).toBe(ShimAgent);
  });

  test("next/dist/compiled/undici still maps to the shim", () => {
    // The Next.js compat alias bypasses node_modules on purpose.
    expect(require.resolve("next/dist/compiled/undici")).toBe("internal:undici");
  });

  test("require.resolve.paths treats undici as a regular package", () => {
    const paths = require.resolve.paths("undici");
    expect(Array.isArray(paths)).toBe(true);
    expect(paths!.length).toBeGreaterThan(0);
    // Real builtins still report no search paths.
    expect(require.resolve.paths("node:fs")).toBeNull();
  });

  test("undici is not reported as a builtin module", () => {
    expect(Module.isBuiltin("undici")).toBe(false);
    expect(Module.builtinModules).not.toContain("undici");
    expect(process.getBuiltinModule("undici")).toBeUndefined();
    expect(Module.isBuiltin("node:fs")).toBe(true);
    expect(process.getBuiltinModule("fs")).toBeDefined();
  });

  test("subpath imports mapping to undici prefer the installed package", async () => {
    using dir = tempDir("undici-subpath", {
      "package.json": `{ "name": "app", "imports": { "#undici": "undici" } }`,
      "node_modules/undici/package.json": `{ "name": "undici", "version": "99.0.0", "main": "index.js" }`,
      "node_modules/undici/index.js": `module.exports = { marker: "installed" };`,
      "main.mjs": `
        import u from "#undici";
        console.log(u.marker);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("installed\n");
    expect(exitCode).toBe(0);
  });

  test("subpath imports mapping to undici fall back to the shim", async () => {
    using dir = tempDir("undici-subpath-builtin", {
      "package.json": `{ "name": "app", "imports": { "#undici": "undici" } }`,
      "main.mjs": `
        import u from "#undici";
        console.log(typeof u.request, typeof u.MockAgent);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("function function\n");
    expect(exitCode).toBe(0);
  });

  test("require and import pick up a locally installed undici", async () => {
    using dir = tempDir("undici-installed", {
      "package.json": `{ "name": "app", "dependencies": { "undici": "*" } }`,
      "node_modules/undici/package.json": `{ "name": "undici", "version": "99.0.0", "main": "index.js" }`,
      "node_modules/undici/index.js": `
        class MockAgent {
          disableNetConnect() {}
          get() {}
        }
        module.exports = { MockAgent, marker: "installed" };
      `,
      "main.cjs": `
        const undici = require("undici");
        const agent = new undici.MockAgent();
        agent.disableNetConnect();
        console.log(undici.marker, require.resolve("undici").includes("node_modules"));
      `,
      "main.mjs": `
        import { MockAgent, marker } from "undici";
        new MockAgent().disableNetConnect();
        console.log(marker, import.meta.resolve("undici").includes("node_modules"));
      `,
    });

    for (const entry of ["main.cjs", "main.mjs"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("installed true\n");
      expect(exitCode).toBe(0);
    }
  });

  test("without an installed undici, the builtin shim is used", async () => {
    using dir = tempDir("undici-builtin", {
      "package.json": `{ "name": "app" }`,
      "main.cjs": `
        const undici = require("undici");
        console.log(require.resolve("undici"), typeof undici.request, typeof undici.MockAgent);
      `,
      "main.mjs": `
        import { request, MockAgent } from "undici";
        const dynamic = await import("undici");
        console.log(import.meta.resolve("undici"), typeof request, typeof MockAgent, dynamic.request === request);
      `,
    });

    for (const [entry, expected] of [
      ["main.cjs", "internal:undici function function\n"],
      ["main.mjs", "internal:undici function function true\n"],
    ]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(exitCode).toBe(0);
    }
  });

  test("bun build --target=bun bundles an installed undici", async () => {
    using dir = tempDir("undici-build-installed", {
      "package.json": `{ "name": "app", "dependencies": { "undici": "*" }, "imports": { "#undici": "undici" } }`,
      "node_modules/undici/package.json": `{ "name": "undici", "version": "99.0.0", "main": "index.js" }`,
      "node_modules/undici/index.js": `module.exports = { marker: "installed" };`,
      "entry.mjs": `
        import { marker } from "undici";
        import viaImports from "#undici";
        console.log(marker, viaImports.marker);
      `,
    });

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "entry.mjs", "--outfile=out.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // The installed package is an ordinary dependency, so it is inlined.
    const bundled = await Bun.file(join(String(dir), "out.mjs")).text();
    expect(bundled).toContain("installed");
    expect(bundled).not.toContain('"undici"');

    await using proc = Bun.spawn({
      cmd: [bunExe(), "out.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("installed installed\n");
    expect(exitCode).toBe(0);
  });

  test("bun build --target=bun keeps the shim external when undici is not installed", async () => {
    using dir = tempDir("undici-build-shim", {
      "package.json": `{ "name": "app", "imports": { "#undici": "undici" } }`,
      "entry.mjs": `
        import { request } from "undici";
        import viaImports from "#undici";
        console.log(typeof request, typeof viaImports.request);
      `,
    });

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "entry.mjs", "--outfile=out.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    const bundled = await Bun.file(join(String(dir), "out.mjs")).text();
    expect(bundled).toContain('"internal:undici"');
    expect(bundled).not.toContain("#undici");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "out.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("function function\n");
    expect(exitCode).toBe(0);
  });
});
