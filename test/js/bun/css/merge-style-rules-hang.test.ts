import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Minifying a stylesheet with many rules that share the same selector merges
// them into one rule: the declarations are concatenated onto the first rule and
// the block is re-minified. Re-minifying after *every* pairwise merge re-walks
// the whole (growing) block, which is O(n²) in the number of merged rules.
//
// For declarations that the property handlers do not collapse — `Unparsed`
// values (here an `-o-linear-gradient()` with an out-of-range hex color the
// gradient parser rejects) and custom properties — the block grows to N and the
// repeated re-minify spends tens of seconds for a few thousand rules. A run of
// same-selector merges should cost O(n); this test bounds it with a subprocess
// timeout so a regression to quadratic fails by being killed rather than slow.
const N = 5000;

test("minifying many same-selector rules with non-collapsible declarations is linear, not quadratic", async () => {
  using dir = tempDir("css-merge-hang", {
    // `-o-linear-gradient(..., #18446744073709551615)`: 20-hex-digit color is
    // rejected by the hash-color parser, so the declaration stays `Unparsed`
    // and is not deduplicated when the rules merge.
    "entry.css":
      ".foo{background:-o-linear-gradient(top right,red,#fff,#18446744073709551615)}\n".repeat(N),
    "build-fixture.ts": `
      const result = await Bun.build({
        entrypoints: ["./entry.css"],
        target: "browser",
        minify: true,
        sourcemap: "external",
        throw: false,
      });
      const css = await result.outputs.find(o => o.path.endsWith(".css")).text();
      // All ${N} declarations survive the merge (the value is unparsed, so it is
      // not collapsed), proving the block really did grow to N and still got
      // minified in linear time.
      const count = css.split("background:").length - 1;
      console.log(JSON.stringify({ count, outputs: result.outputs.length }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build-fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ count: N, outputs: 1 });
  expect(exitCode).toBe(0);
}, 30_000);

// Custom properties are likewise never collapsed by the declaration handlers, so
// the same quadratic merge path is reachable without any parser edge case.
test("minifying many same-selector rules with custom properties is linear, not quadratic", async () => {
  using dir = tempDir("css-merge-hang-custom", {
    "entry.css": Array.from({ length: N }, (_, i) => `.foo{--v${i}:${i}}`).join("\n"),
    "build-fixture.ts": `
      const result = await Bun.build({
        entrypoints: ["./entry.css"],
        target: "browser",
        minify: true,
        throw: false,
      });
      const css = await result.outputs.find(o => o.path.endsWith(".css")).text();
      const count = css.split("--v").length - 1;
      console.log(JSON.stringify({ count, outputs: result.outputs.length }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build-fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ count: N, outputs: 1 });
  expect(exitCode).toBe(0);
}, 30_000);

// The merge-then-minify must still collapse overriding properties across the
// merged rules exactly as before — the deferred re-minify is only an
// optimization and must not change output.
test("merging same-selector rules still collapses overriding declarations", async () => {
  using dir = tempDir("css-merge-correctness", {
    "entry.css": [
      ".a{margin-left:1px}",
      ".a{margin:2px}",
      ".a{margin-top:3px}",
      ".b{color:red}",
      ".b{color:green}",
      ".c{padding:1px}",
      ".c{padding-left:2px}",
      ".c{padding:3px;color:red}",
      ".c{color:blue}",
      ".d{color:red!important}",
      ".d{color:blue}",
      ".d{color:green!important}",
    ].join("\n"),
    "build-fixture.ts": `
      const result = await Bun.build({
        entrypoints: ["./entry.css"],
        target: "browser",
        minify: true,
        throw: false,
      });
      console.log((await result.outputs.find(o => o.path.endsWith(".css")).text()).trim());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build-fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(".a{margin:3px 2px 2px}.b{color:green}.c{color:#00f;padding:3px}.d{color:#00f;color:green!important}");
  expect(exitCode).toBe(0);
}, 30_000);
