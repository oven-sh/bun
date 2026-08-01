import { expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("mock.module throws TypeError for non-string first argument", () => {
  // @ts-expect-error
  expect(() => mock.module(SharedArrayBuffer, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  // @ts-expect-error
  expect(() => mock.module({}, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  // @ts-expect-error
  expect(() => mock.module(123, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  // @ts-expect-error
  expect(() => mock.module(Symbol("test"), () => ({}))).toThrow("mock(module, fn) requires a module name string");
});

test("mock.module still works with valid string argument", async () => {
  mock.module("mock-module-non-string-test-fixture", () => ({ default: 42 }));
  const m = await import("mock-module-non-string-test-fixture");
  expect(m.default).toBe(42);
});

test("mock.module does not crash on specifiers that are not valid npm package names", () => {
  const specifiers = [
    "function f2() {\n    const v6 = new ArrayBuffer();\n    v6.transferToFixedLength();\n}",
    "foo\nbar",
    "foo\rbar",
    "has spaces",
    "(parens)",
    "{braces}",
    "[brackets]",
  ];
  for (const specifier of specifiers) {
    expect(() => mock.module(specifier, () => ({ default: 1 }))).not.toThrow();
  }
  for (const specifier of specifiers) {
    // @ts-expect-error missing callback on purpose
    expect(() => mock.module(specifier)).toThrow("mock(module, fn) requires a function");
  }
  Bun.gc(true);
});

test("mock.module throws TypeError without resolving when callback is missing", () => {
  // The resolver can reach the package-manager auto-install path and reentrantly
  // tick the JS event loop. When the caller forgets the callback, we must throw
  // before running the resolver at all.
  const specifiers = [
    // valid npm package name — bypasses the isNPMPackageName gate in the resolver
    "PbQ",
    "some-package-that-does-not-exist",
    "@scope/pkg",
    "function f3() {}",
    "() => 1",
  ];
  for (const specifier of specifiers) {
    // @ts-expect-error missing callback on purpose
    expect(() => mock.module(specifier)).toThrow("mock(module, fn) requires a function");
  }
  for (const specifier of specifiers) {
    // @ts-expect-error non-callable second argument on purpose
    expect(() => mock.module(specifier, 123)).toThrow("mock(module, fn) requires a function");
  }
  Bun.gc(true);
});

test("mock.module does not run the resolver when callback is missing", async () => {
  // When auto-install is enabled and the specifier is a valid npm package name,
  // the resolver reaches the package-manager path, reentrantly ticks the JS
  // event loop, and blocks waiting on the registry. If the callback is missing
  // we must throw before the resolver runs so none of that happens.
  let requests = 0;
  const { promise: gotRequest, resolve: onRequest } = Promise.withResolvers<void>();
  await using server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      onRequest();
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });

  using dir = tempDir("mock-module-no-callback-no-resolve", {
    "index.js": `
      const { vi } = Bun.jest();
      try { vi.mock("PbQ"); } catch (e) { console.error("ERR:", e.message); }
      try { vi.mock("some-valid-pkg-name-abc123"); } catch (e) { console.error("ERR:", e.message); }
      Bun.gc(true);
      console.log("done");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
      BUN_INSTALL_CACHE_DIR: String(dir) + "/.cache",
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Before the fix, the resolver blocks on the registry and the process never
  // exits on its own. Race the exit against the first registry request so the
  // test fails fast (instead of timing out) on a regression.
  const result = await Promise.race([
    Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]).then(([stdout, stderr, exitCode]) => ({
      kind: "exited" as const,
      stdout,
      stderr,
      exitCode,
    })),
    gotRequest.then(() => ({ kind: "request" as const })),
  ]);

  if (result.kind === "request") {
    proc.kill();
    throw new Error("mock.module ran the resolver and hit the registry when callback was missing");
  }

  expect(result.stderr).toContain("mock(module, fn) requires a function");
  expect(result.stdout).toContain("done");
  expect(requests).toBe(0);
  expect(result.exitCode).toBe(0);
});
