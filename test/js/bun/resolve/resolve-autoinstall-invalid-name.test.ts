import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// When auto-install is enabled, the resolver must not attempt to install a
// package whose name is not a valid npm package name. Attempting to do so
// reentrantly ticks the JS event loop from inside the resolver, which has led
// to crashes when reached via mock.module() / vi.mock() / Bun.resolveSync()
// with arbitrary user-provided strings.
test("resolver does not attempt auto-install for invalid npm package names", async () => {
  let requests = 0;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });

  using dir = tempDir("resolve-autoinstall-invalid-name", {
    "index.js": `
      const specifiers = [
        "function f2() {\\n    const v6 = new ArrayBuffer();\\n}",
        "has spaces",
        "(parens)",
        "{braces}",
        "line1\\nline2",
        "foo\\tbar",
        "a\\u0000b",
      ];
      for (const s of specifiers) {
        try {
          Bun.resolveSync(s, import.meta.dir);
        } catch {}
      }
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(requests).toBe(0);
  expect(exitCode).toBe(0);
});

test("resolver still attempts auto-install for valid npm package names", async () => {
  let requests = 0;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });

  using dir = tempDir("resolve-autoinstall-valid-name", {
    "index.js": `
      try {
        Bun.resolveSync("some-package-that-does-not-exist-abc123", import.meta.dir);
      } catch {}
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(requests).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});

// Only the rest that is the bare name of a Node.js builtin names a module ("bun:fs" is "fs").
test.concurrent.each([
  ["by default in a directory without node_modules", []],
  ["with --install=force", ["--install=force"]],
])(
  "auto-install does not ask the registry for the rest of a literal bun: specifier that is not a builtin, %s",
  async (_, flags) => {
    const asked: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        asked.push(new URL(req.url).pathname);
        return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      },
    });

    using dir = tempDir("resolve-autoinstall-bun-prefix", {
      "imported.mjs": `import sql from "bun:sql";`,
      "required.mjs": `import sql from "bun:sql";`,
      "index.mjs": `
        const forms = [
          () => import("bun:sql"),
          () => require("bun:sql"),
          () => import("bun:sql@1.0.0"),
          () => require("bun:@scope/pkg"),
          // import() transpiles the module on a worker thread, require() on this thread.
          () => import("./imported.mjs"),
          () => require("./required.mjs"),
          () => import("bun:fs"),
          () => import("a-package-the-registry-does-not-have"),
        ];
        for (const load of forms) {
          try {
            await load();
            console.log("loaded");
          } catch (error) {
            console.log("not found: " + error.specifier);
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "index.mjs"],
      env: {
        ...bunEnv,
        BUN_CONFIG_REGISTRY: server.url.href,
        NPM_CONFIG_REGISTRY: server.url.href,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ outcome: stdout.trim().split(/\r?\n/), stderr, asked, exitCode }).toEqual({
      outcome: [
        "not found: bun:sql",
        "not found: bun:sql",
        "not found: bun:sql@1.0.0",
        "not found: bun:@scope/pkg",
        "not found: bun:sql",
        "not found: bun:sql",
        "loaded",
        "not found: a-package-the-registry-does-not-have",
      ],
      stderr: "",
      // Auto-install is on: it asks for the one name that can be a package.
      asked: ["/a-package-the-registry-does-not-have"],
      exitCode: 0,
    });
  },
);
