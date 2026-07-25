// https://github.com/oven-sh/bun/issues/13853
// RegExp literal .source must preserve non-ASCII characters from the original
// source text. Bun's runtime transpiler used to rewrite /¶/u as /\u00B6/u
// (to keep the printed output ASCII-only for a Latin-1 source pipeline),
// which changed the observable value of RegExp.prototype.source and broke
// packages such as parsel-js/Puppeteer that string-replace on .source.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("RegExp literal .source preserves non-ASCII characters (#13853)", async () => {
  // Spawn a fresh process so the fixture is run through the runtime transpiler
  // (this test file itself is also transpiled, but the fixture's bytes are
  // what we want the assertion to observe).
  using dir = tempDir("issue-13853", {
    "index.js": `
      const results = {
        latin1_no_u: /\u00b6/.source,
        latin1_u: /\u00b6/u.source,
        latin1_v: /\u00b6/v.source,
        cjk: /\u8981\u66ff\u6362/u.source,
        astral: /\u{1d54f}/u.source,
        // via new RegExp the source text is already a runtime string,
        // so this was never broken; kept as a sanity check
        runtime: new RegExp("\u00b6", "u").source,
      };
      process.stdout.write(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "index.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const got = JSON.parse(stdout);
  expect(got).toEqual({
    latin1_no_u: "\u00b6",
    latin1_u: "\u00b6",
    latin1_v: "\u00b6",
    cjk: "\u8981\u66ff\u6362",
    astral: "\u{1d54f}",
    runtime: "\u00b6",
  });
  expect(exitCode).toBe(0);
});

test("parsel-js .source.replace pattern works (#13853)", async () => {
  // Minimal reduction of what Puppeteer's bundled parsel-js does for
  // ::-p-xpath() / ::-p-text(): build a RegExp with a literal PILCROW SIGN
  // placeholder, then .source.replace("\u00b6*", ".*") to derive a second
  // pattern. If .source escaped \u00b6 to "\\u00B6" the replace would miss
  // and the derived pattern would fail to capture the argument.
  using dir = tempDir("issue-13853-parsel", {
    "index.js": `
      const TOKEN = /::(?<name>[-\\w]+)(?:\\((?<argument>\u00b6*)\\))?/gu;
      const src = TOKEN.source.replace("(?<argument>\u00b6*)", "(?<argument>.*)");
      const derived = new RegExp(src, "gu");
      derived.lastIndex = 0;
      const m = derived.exec("::-p-xpath(//div)");
      process.stdout.write(JSON.stringify(m && m.groups));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "index.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ name: "-p-xpath", argument: "//div" });
  expect(exitCode).toBe(0);
});

test("transpiler cache round-trip preserves non-ASCII RegExp .source (#13853)", async () => {
  // The on-disk transpiler cache used to tag printer output as Latin-1, so a
  // non-ASCII RegExp literal would be corrupted when read back on a cache hit.
  // The file must exceed the 4 KiB minimum cache size.
  const pad = Buffer.alloc(8 * 1024, "a").toString();
  using dir = tempDir("issue-13853-cache", {
    "a.js": `/* ${pad} */\nprocess.stdout.write(/\u00b6\u65e5/u.source);\n`,
  });
  const cacheDir = join(String(dir), ".cache");
  const env = {
    ...bunEnv,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir,
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };

  // First run: cache miss, writes the cache entry.
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "a.js")],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("\u00b6\u65e5");
    expect(exitCode).toBe(0);
  }

  // Second run: cache hit, reads the entry back.
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "a.js")],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("\u00b6\u65e5");
    expect(exitCode).toBe(0);
  }
});

test("non-ASCII RegExp literal still matches correctly (#2005 stays fixed)", async () => {
  using dir = tempDir("issue-13853-match", {
    "index.js": `
      const text = "\u8fd9\u662f\u4e00\u6bb5\u8981\u66ff\u6362\u7684\u6587\u5b57";
      process.stdout.write(JSON.stringify({
        literal: text.replace(/\u8981\u66ff\u6362/, ""),
        ctor: text.replace(new RegExp("\u8981\u66ff\u6362"), ""),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(String(dir), "index.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    literal: "\u8fd9\u662f\u4e00\u6bb5\u7684\u6587\u5b57",
    ctor: "\u8fd9\u662f\u4e00\u6bb5\u7684\u6587\u5b57",
  });
  expect(exitCode).toBe(0);
});
