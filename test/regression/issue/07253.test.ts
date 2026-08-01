// https://github.com/oven-sh/bun/issues/7253
//
// expect().toStrictEqual() failure on two URL objects printed `Expected: URL {}` /
// `Received: URL {}`, hiding the actual difference. The jest/snapshot formatter
// (forEachPropertyOrdered) only collected own property names, but URL exposes all
// of its state via accessors on the prototype, so nothing was found. The same bug
// made Bun.inspect(url, { sorted: true }) print `URL {}`.

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

test("toStrictEqual failure diff for URL shows the differing fields", async () => {
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

test("toEqual failure diff for URL shows the differing fields", async () => {
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

test("Bun.inspect with sorted: true enumerates URL prototype accessors", () => {
  const out = Bun.inspect(new URL("https://bun.sh/docs"), { sorted: true, colors: false });
  expect(out).not.toBe("URL {}");
  expect(out).toContain(`href: "https://bun.sh/docs"`);
  expect(out).toContain(`hostname: "bun.sh"`);
  expect(out).toContain(`pathname: "/docs"`);
});

test("Bun.inspect with sorted: true does not walk the prototype for non-DOM objects", () => {
  expect(Bun.inspect(new Number(7), { sorted: true, colors: false })).not.toContain("toFixed");
  expect(Bun.inspect({ a: 1 }, { sorted: true, colors: false })).not.toContain("toString");
});
