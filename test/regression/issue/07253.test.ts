// https://github.com/oven-sh/bun/issues/7253

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runFailingTest(source: string) {
  using dir = tempDir("issue-07253", { "url.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "url.test.ts"],
    env: { ...bunEnv, NO_COLOR: "1", FORCE_COLOR: "0" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("toStrictEqual failure diff for URL shows the differing fields", async () => {
  const { stderr, exitCode } = await runFailingTest(`
    import { expect, test } from "bun:test";
    test("url", () => {
      expect(new URL("https://www.google.com")).toStrictEqual(new URL("https://github.com"));
    });
  `);

  expect(stderr).not.toContain("URL {}");
  expect(stderr).toContain(`"href": "https://www.google.com/"`);
  expect(stderr).toContain(`"href": "https://github.com/"`);
  expect(stderr).toContain(`"host": "www.google.com"`);
  expect(stderr).toContain(`"host": "github.com"`);
  expect(exitCode).toBe(1);
});

test.concurrent("toEqual failure diff for URL shows the differing fields", async () => {
  const { stderr, exitCode } = await runFailingTest(`
    import { expect, test } from "bun:test";
    test("url", () => {
      expect(new URL("https://a.example/?x=1")).toEqual(new URL("https://b.example/?y=2"));
    });
  `);

  expect(stderr).not.toContain("URL {}");
  expect(stderr).toContain(`"href": "https://a.example/?x=1"`);
  expect(stderr).toContain(`"href": "https://b.example/?y=2"`);
  expect(stderr).toContain(`"search": "?x=1"`);
  expect(stderr).toContain(`"search": "?y=2"`);
  expect(exitCode).toBe(1);
});

test.concurrent("toStrictEqual failure diff for Headers shows entries, not prototype methods", async () => {
  const { stderr, exitCode } = await runFailingTest(`
    import { expect, test } from "bun:test";
    test("headers", () => {
      expect(new Headers({ a: "1" })).toStrictEqual(new Headers({ b: "2" }));
    });
  `);

  expect(stderr).not.toContain("Headers {}");
  expect(stderr).not.toContain("[Function: append]");
  expect(stderr).toContain(`"a": "1"`);
  expect(stderr).toContain(`"b": "2"`);
  expect(exitCode).toBe(1);
});

test("Bun.inspect with sorted: true enumerates URL prototype accessors", () => {
  const out = Bun.inspect(new URL("https://bun.sh/docs"), { sorted: true, colors: false });
  expect(out).not.toBe("URL {}");
  expect(out).toContain(`href: "https://bun.sh/docs"`);
  expect(out).toContain(`hostname: "bun.sh"`);
  expect(out).toContain(`pathname: "/docs"`);
});

test("Bun.inspect with sorted: true does not walk the prototype for non-DOM objects", () => {
  class C {
    method() {}
  }
  expect(Bun.inspect(new C(), { sorted: true, colors: false })).not.toContain("method");
});
