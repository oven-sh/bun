// Bun ships a builtin undici shim, but it is only a fallback: when the real
// package is installed in node_modules, bare "undici" must resolve to the
// installed copy (https://github.com/oven-sh/bun/issues/36098).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
// test/node_modules has the real undici installed.
import { MockAgent } from "undici";

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

  test("next/dist/compiled/undici still maps to the shim", () => {
    // The Next.js compat alias bypasses node_modules on purpose.
    expect(require.resolve("next/dist/compiled/undici")).toBe("undici");
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
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("undici function function\n");
    expect(exitCode).toBe(0);
  });
});
