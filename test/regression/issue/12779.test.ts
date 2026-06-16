// https://github.com/oven-sh/bun/issues/12779
// `bun build --sourcemap external` (space-separated) treated "external" as an
// entry point instead of the --sourcemap value.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

describe("bun build --sourcemap accepts a space-separated value", () => {
  async function build(dir: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "index.js", "--outdir", "dist", ...args],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each([
    {
      mode: "external",
      hasMap: true,
      comment: (out: string) => expect(out).not.toContain("sourceMappingURL"),
    },
    {
      mode: "linked",
      hasMap: true,
      comment: (out: string) => expect(out).toContain("//# sourceMappingURL=index.js.map"),
    },
    {
      mode: "inline",
      hasMap: false,
      comment: (out: string) => expect(out).toContain("//# sourceMappingURL=data:application/json;base64,"),
    },
    {
      mode: "none",
      hasMap: false,
      comment: (out: string) => expect(out).not.toContain("sourceMappingURL"),
    },
  ])("--sourcemap $mode", async ({ mode, hasMap, comment }) => {
    using dir = tempDir("issue-12779-" + mode, {
      "index.js": 'console.log("hello");\n',
    });

    const spaced = await build(String(dir), ["--sourcemap", mode]);
    expect({ stderr: spaced.stderr, exitCode: spaced.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const outJs = path.join(String(dir), "dist", "index.js");
    const outMap = path.join(String(dir), "dist", "index.js.map");
    expect(fs.existsSync(outJs)).toBe(true);
    expect(fs.existsSync(outMap)).toBe(hasMap);
    comment(fs.readFileSync(outJs, "utf8"));

    // The `=` form must produce identical output.
    fs.rmSync(path.join(String(dir), "dist"), { recursive: true, force: true });
    const eq = await build(String(dir), ["--sourcemap=" + mode]);
    expect({ stderr: eq.stderr, exitCode: eq.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(fs.existsSync(outJs)).toBe(true);
    expect(fs.existsSync(outMap)).toBe(hasMap);
    comment(fs.readFileSync(outJs, "utf8"));
  });

  test("--sourcemap followed by an entry point still treats it as an entry point", async () => {
    using dir = tempDir("issue-12779-bare", {
      "index.js": 'console.log("hello");\n',
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--outdir", "dist", "--sourcemap", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(stdout).toContain("index.js");

    // bare --sourcemap defaults to linked
    const outJs = path.join(String(dir), "dist", "index.js");
    expect(fs.existsSync(outJs)).toBe(true);
    expect(fs.existsSync(path.join(String(dir), "dist", "index.js.map"))).toBe(true);
    expect(fs.readFileSync(outJs, "utf8")).toContain("//# sourceMappingURL=index.js.map");
  });
});
