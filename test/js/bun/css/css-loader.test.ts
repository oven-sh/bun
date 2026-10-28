import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The default export of a plain .css import is an empty object (esbuild
// parity), and `bun run` and `bun build --target=bun` agree on that shape.
describe.concurrent("css loader default export", () => {
  const entry = `import c from "./s.css";\nprocess.stdout.write(typeof c + " " + JSON.stringify(c));\n`;

  test("bun run", async () => {
    using dir = tempDir("css-loader-run", {
      "s.css": ".c { color: red }",
      "e.ts": entry,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "e.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("object {}");
    expect(exitCode).toBe(0);
  });

  test("bun build --target=bun then run matches bun run", async () => {
    using dir = tempDir("css-loader-build", {
      "s.css": ".c { color: red }",
      "e.ts": entry,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "e.ts", "--target=bun", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [, buildErr, buildCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildErr).toBe("");
    expect(buildCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), "out/e.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("object {}");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("bun build --no-bundle css", () => {
  // Minifying for browsers can add a prefixed copy of the ":fullscreen" rule.
  // Printing for browsers compiles the nesting and can lower the media range.
  const files = {
    "styles.css": [
      ".a { color: red; .b { color: blue; } }",
      ".d:fullscreen { color: red; }",
      "@media (width >= 800px) { .c { color: green; } }",
      "",
    ].join("\n"),
  };

  async function build(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...args, "styles.css"],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    // Only a bundled stylesheet starts with a comment naming its source file.
    return stdout.replace("/* styles.css */\n", "");
  }

  test("lowers css for the default (browser) target the same way a bundled build does", async () => {
    using dir = tempDir("no-bundle-css-browser", files);
    const [transpiled, bundled] = await Promise.all([build(String(dir), "--no-bundle"), build(String(dir))]);
    expect(transpiled).toBe(bundled);
    expect(transpiled).toContain(".a .b {");
  });

  test.each(["bun", "node"])("--target=%s leaves css alone the same way a bundled build does", async target => {
    using dir = tempDir(`no-bundle-css-${target}`, files);
    const [transpiled, bundled] = await Promise.all([
      build(String(dir), "--no-bundle", `--target=${target}`),
      build(String(dir), `--target=${target}`),
    ]);
    expect(transpiled).toBe(bundled);
    expect(transpiled).toBe(
      [
        ".a {",
        "  color: red;",
        "",
        "  & .b {",
        "    color: #00f;",
        "  }",
        "}",
        "",
        ".d:fullscreen {",
        "  color: red;",
        "}",
        "",
        "@media (width >= 800px) {",
        "  .c {",
        "    color: green;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });
});
