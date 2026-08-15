import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

$.nothrow();

async function mkdir(cwd: string, flags: string, operand: string) {
  const words = flags.split(" ").filter(Boolean);
  const { stdout, stderr, exitCode } = await $`mkdir ${words} ${operand}`.cwd(cwd).quiet();
  return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
}

describe.concurrent("bunshell mkdir", () => {
  describe("verbose", () => {
    // A verbose mkdir prints the path of every directory it creates, one per
    // line. `--verbose` is the long spelling of `-v`; the parser used to
    // accept only the misspelling `--vebose`.
    test.each([
      ["-v", "dir", ["dir"]],
      ["--verbose", "dir", ["dir"]],
      ["-pv", "a/b", ["a", "a/b"]],
      ["-p --verbose", "a/b", ["a", "a/b"]],
      ["--parents --verbose", "a/b", ["a", "a/b"]],
      ["--verbose --parents", "a/b", ["a", "a/b"]],
      ["--verbose -p", "a/b", ["a", "a/b"]],
    ])("mkdir %s %s prints %j", async (flags, operand, created) => {
      using dir = tempDir("mkdir-verbose", {});
      const cwd = String(dir);

      expect(await mkdir(cwd, flags, operand)).toEqual({
        stdout: created.map(name => `${join(cwd, name)}\n`).join(""),
        stderr: "",
        exitCode: 0,
      });
      expect(statSync(join(cwd, operand)).isDirectory()).toBeTrue();
    });

    test.each(["--parents", "-p", ""])("mkdir %s a/b prints nothing without a verbose flag", async flags => {
      using dir = tempDir("mkdir-quiet", { a: {} });
      const cwd = String(dir);

      expect(await mkdir(cwd, flags, "a/b")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(statSync(join(cwd, "a", "b")).isDirectory()).toBeTrue();
    });

    test.each(["--verbose --parents", "-pv"])(
      "mkdir %s on an existing directory creates and prints nothing",
      async flags => {
        using dir = tempDir("mkdir-verbose-existing", { dir: {} });
        const cwd = String(dir);

        expect(await mkdir(cwd, flags, "dir")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
        expect(readdirSync(cwd)).toEqual(["dir"]);
      },
    );

    test.each(["--verbose", "-v"])("mkdir %s on an existing directory fails and prints nothing", async flags => {
      using dir = tempDir("mkdir-verbose-eexist", { dir: {} });
      const cwd = String(dir);

      expect(await mkdir(cwd, flags, "dir")).toEqual({
        stdout: "",
        stderr: `mkdir: ${join(cwd, "dir")}: File exists\n`,
        exitCode: 1,
      });
    });

    test("the misspelling --vebose is rejected like any other unknown option", async () => {
      using dir = tempDir("mkdir-vebose", {});
      const cwd = String(dir);

      expect(await mkdir(cwd, "--vebose", "dir")).toEqual({
        stdout: "",
        stderr: expect.stringMatching(/^mkdir: illegal option -- /),
        exitCode: 1,
      });
      expect(readdirSync(cwd)).toEqual([]);
    });
  });
});
