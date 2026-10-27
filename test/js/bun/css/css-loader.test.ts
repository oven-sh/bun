import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

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

  test("CSS Modules keep container names global", async () => {
    using dir = tempDir("css-module-container-names", {
      "card.module.css": `
        .host { container: page / inline-size; }
        .longhand { container-name: page; container-type: inline-size; }
        @container page (width < 700px) {
          .item { color: red; }
        }
      `,
      "entry.ts": `import styles from "./card.module.css"; console.log(styles);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.ts", "--target=browser", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const css = await Bun.file(join(String(dir), "out/entry.css")).text();
    expect(css).toContain("container: page / inline-size");
    expect(css).toContain("container-name: page");
    expect(css).toMatch(/@container page\s*\(/);
    expect(css).not.toMatch(/@container page_[\w-]+/);
  });
});
