import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import fs from "node:fs";
import { join } from "node:path";

// $.sandbox() — sandboxed shells (experimental).
//
// Blocked operations exit with code 1 and a "... not permitted in sandbox"
// message on stderr; exceeded limits reject the promise with a descriptive
// message. These exact strings are part of the contract under test.

function sandboxDir() {
  return tempDir("shell-sandbox", {
    "data/file.txt": "hello sandbox\n",
    "data/other.txt": "other\n",
    "secret.txt": "SECRET\n",
  });
}

describe("$.sandbox", () => {
  describe("option validation", () => {
    test("rejects non-object options", () => {
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox()).toThrow(TypeError);
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox("abc")).toThrow(TypeError);
      expect(() => $.sandbox(null)).toThrow(TypeError);
    });

    test("rejects unknown keys", () => {
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ commandz: {} })).toThrow("$.sandbox: unknown option 'commandz'");
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ commands: { allowed: [] } })).toThrow("$.sandbox: unknown option 'commands.allowed'");
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ fs: { readonly: true } })).toThrow("$.sandbox: unknown option 'fs.readonly'");
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ limits: { timeoutMs: 5 } })).toThrow("$.sandbox: unknown option 'limits.timeoutMs'");
    });

    test("rejects malformed command lists", () => {
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ commands: { allow: "echo" } })).toThrow(
        "$.sandbox: commands.allow must be an array of strings",
      );
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ commands: { deny: [1] } })).toThrow(
        "$.sandbox: commands.deny must be an array of strings",
      );
    });

    test("rejects unknown command names at invocation", () => {
      const box = $.sandbox({ commands: { allow: ["curl"] } });
      expect(() => box`echo hi`).toThrow(/unknown command "curl" in commands\.allow/);
      const box2 = $.sandbox({ commands: { deny: ["not-a-builtin"] } });
      expect(() => box2`echo hi`).toThrow(/unknown command "not-a-builtin" in commands\.deny/);
    });

    test("rejects relative and NUL-containing fs paths", () => {
      expect(() => $.sandbox({ fs: { read: ["relative/path"] } })).toThrow(
        '$.sandbox: fs.read paths must be absolute, got "relative/path"',
      );
      expect(() => $.sandbox({ fs: { write: [""] } })).toThrow("$.sandbox: fs.write paths must be absolute");
      expect(() => $.sandbox({ fs: { read: ["/a\0b"] } })).toThrow("$.sandbox: fs.read paths must not contain NUL");
    });

    test("network can only be false", () => {
      expect(() => $.sandbox({ network: false })).not.toThrow();
      expect(() => $.sandbox({ network: true })).toThrow(/network access cannot be enabled yet/);
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ network: "on" })).toThrow("$.sandbox: network must be a boolean");
    });

    test("rejects non-positive-integer limits", () => {
      for (const bad of [0, -5, 1.5, NaN, Infinity]) {
        expect(() => $.sandbox({ limits: { timeout: bad } })).toThrow(
          "$.sandbox: limits.timeout must be a positive integer",
        );
        expect(() => $.sandbox({ limits: { maxOutputBytes: bad } })).toThrow(
          "$.sandbox: limits.maxOutputBytes must be a positive integer",
        );
      }
      // @ts-expect-error intentionally wrong
      expect(() => $.sandbox({ limits: { timeout: "100" } })).toThrow(
        "$.sandbox: limits.timeout must be a positive integer",
      );
    });

    test("policy is copied: later mutation of the options object has no effect", async () => {
      using dir = sandboxDir();
      const options = { fs: { read: [] as string[] } };
      const box = $.sandbox(options);
      options.fs.read.push(String(dir));
      const result = await box`ls ${join(String(dir), "data")}`.quiet().nothrow();
      expect(result.stderr.toString()).toContain("read access not permitted in sandbox");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("command policy", () => {
    test("external commands are blocked, even nonexistent ones", async () => {
      const box = $.sandbox({});
      for (const cmd of ["git", "definitely-not-a-real-command-12345", "bun"]) {
        const result = await box`${{ raw: cmd }} --version`.quiet().nothrow();
        expect(result.stderr.toString()).toBe(`bun: ${cmd}: external commands are not permitted in sandbox\n`);
        expect(result.stdout.toString()).toBe("");
        expect(result.exitCode).toBe(1);
      }
    });

    test("deny blocks a builtin, others still run", async () => {
      using dir = sandboxDir();
      const box = $.sandbox({ commands: { deny: ["rm"] }, fs: { write: [String(dir)] } });
      const denied = await box`rm ${join(String(dir), "data", "file.txt")}`.quiet().nothrow();
      expect(denied.stderr.toString()).toBe("bun: rm: command not permitted in sandbox\n");
      expect(denied.exitCode).toBe(1);
      expect(fs.existsSync(join(String(dir), "data", "file.txt"))).toBe(true);

      const allowed = await box`echo still works`.quiet();
      expect(allowed.stdout.toString()).toBe("still works\n");
      expect(allowed.exitCode).toBe(0);
    });

    test("allow restricts to the listed builtins", async () => {
      const box = $.sandbox({ commands: { allow: ["echo", "true"] } });
      expect((await box`echo hi && true`.quiet()).stdout.toString()).toBe("hi\n");

      const blocked = await box`pwd`.quiet().nothrow();
      expect(blocked.stderr.toString()).toBe("bun: pwd: command not permitted in sandbox\n");
      expect(blocked.exitCode).toBe(1);
    });

    test("deny wins over allow", async () => {
      const box = $.sandbox({ commands: { allow: ["echo"], deny: ["echo"] } });
      const result = await box`echo hi`.quiet().nothrow();
      expect(result.stderr.toString()).toBe("bun: echo: command not permitted in sandbox\n");
      expect(result.exitCode).toBe(1);
    });

    test("environment assignments cannot re-enable external commands", async () => {
      const box = $.sandbox({});
      const result = await box`PATH=/usr/bin:/bin git status`.quiet().nothrow();
      expect(result.stderr.toString()).toBe("bun: git: external commands are not permitted in sandbox\n");
      expect(result.exitCode).toBe(1);

      const exported = await box`export PATH=/usr/bin:/bin && git status`.quiet().nothrow();
      expect(exported.stderr.toString()).toBe("bun: git: external commands are not permitted in sandbox\n");
      expect(exported.exitCode).toBe(1);
    });

    test("which resolves permitted builtins only and never probes PATH", async () => {
      const box = $.sandbox({ commands: { deny: ["rm"] } });
      expect((await box`which echo`.quiet()).stdout.toString()).toBe("echo: shell builtin\n");

      const denied = await box`which rm`.quiet().nothrow();
      expect(denied.stdout.toString()).toBe("which: rm not found\n");
      expect(denied.exitCode).toBe(1);

      // `bun` exists on PATH in every test environment; the sandbox must not
      // reveal it.
      const external = await box`which bun`.quiet().nothrow();
      expect(external.stdout.toString()).toBe("which: bun not found\n");
      expect(external.exitCode).toBe(1);
    });
  });

  describe("filesystem policy", () => {
    test("no fs grants: commands that touch no files still work", async () => {
      const box = $.sandbox({});
      const result = await box`echo a && basename /x/y.txt && seq 2`.quiet();
      expect(result.stdout.toString()).toBe("a\ny.txt\n1\n2\n");
      expect(result.exitCode).toBe(0);
    });

    test("no fs grants: listing the cwd is denied", async () => {
      using dir = sandboxDir();
      const box = $.sandbox({});
      const result = await box.cwd(String(dir))`ls`.quiet().nothrow();
      expect(result.stderr.toString()).toBe("ls: .: read access not permitted in sandbox\n");
      expect(result.exitCode).toBe(1);
    });

    test("read grant allows inside, denies outside and the parent", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { read: [data] } });

      const inside = await box`ls ${data}`.quiet();
      expect(inside.stdout.toString().split(/\r?\n/).filter(Boolean).sort()).toEqual(["file.txt", "other.txt"]);

      const parent = await box`ls ${String(dir)}`.quiet().nothrow();
      expect(parent.stderr.toString()).toBe(`ls: ${String(dir)}: read access not permitted in sandbox\n`);
      expect(parent.exitCode).toBe(1);
    });

    test("write grant implies read", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { write: [data] } });
      const result = await box`ls ${data}`.quiet();
      expect(result.exitCode).toBe(0);
    });

    test("redirect writes respect the write prefixes", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { write: [data] } });

      await box`echo content > ${join(data, "out.txt")}`.quiet();
      expect(fs.readFileSync(join(data, "out.txt"), "utf8")).toBe("content\n");

      const outside = join(String(dir), "evil.txt");
      const denied = await box`echo stolen > ${outside}`.quiet().nothrow();
      expect(denied.stderr.toString()).toBe(`bun: ${outside}: write access not permitted in sandbox\n`);
      expect(denied.exitCode).toBe(1);
      expect(fs.existsSync(outside)).toBe(false);

      const append = await box`echo x >> ${outside}`.quiet().nothrow();
      expect(append.stderr.toString()).toBe(`bun: ${outside}: write access not permitted in sandbox\n`);
      expect(append.exitCode).toBe(1);
    });

    test("read grants do not allow writes", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { read: [data] } });
      const target = join(data, "new.txt");
      const result = await box`echo x > ${target}`.quiet().nothrow();
      expect(result.stderr.toString()).toBe(`bun: ${target}: write access not permitted in sandbox\n`);
      expect(result.exitCode).toBe(1);
      expect(fs.existsSync(target)).toBe(false);
    });

    test("stdin redirects respect the read prefixes", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { read: [data] } });

      expect((await box`echo ok < ${join(data, "file.txt")}`.quiet()).exitCode).toBe(0);

      const secret = join(String(dir), "secret.txt");
      const denied = await box`echo ok < ${secret}`.quiet().nothrow();
      expect(denied.stderr.toString()).toBe(`bun: ${secret}: read access not permitted in sandbox\n`);
      expect(denied.exitCode).toBe(1);
    });

    test("touch/mkdir/rm/mv are write-gated", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { write: [data] } });

      // Inside the grant everything works.
      const inside =
        await box`touch ${join(data, "a.txt")} && mkdir ${join(data, "sub")} && mv ${join(data, "a.txt")} ${join(data, "sub")} && rm -r ${join(data, "sub")}`
          .quiet()
          .nothrow();
      expect(inside.stderr.toString()).toBe("");
      expect(inside.exitCode).toBe(0);

      const outside = String(dir);
      const touch = await box`touch ${join(outside, "t.txt")}`.quiet().nothrow();
      expect(touch.stderr.toString()).toBe(`touch: ${join(outside, "t.txt")}: write access not permitted in sandbox\n`);
      expect(touch.exitCode).toBe(1);

      const mkdir = await box`mkdir ${join(outside, "d")}`.quiet().nothrow();
      expect(mkdir.stderr.toString()).toBe(`mkdir: ${join(outside, "d")}: write access not permitted in sandbox\n`);
      expect(mkdir.exitCode).toBe(1);

      const rm = await box`rm ${join(outside, "secret.txt")}`.quiet().nothrow();
      expect(rm.stderr.toString()).toBe(`rm: ${join(outside, "secret.txt")}: write access not permitted in sandbox\n`);
      expect(rm.exitCode).toBe(1);
      expect(fs.existsSync(join(outside, "secret.txt"))).toBe(true);

      // mv out of the sandbox is blocked on the target; mv in from outside is
      // blocked on the source.
      const mvOut = await box`mv ${join(data, "file.txt")} ${join(outside, "stolen.txt")}`.quiet().nothrow();
      expect(mvOut.stderr.toString()).toBe(
        `mv: ${join(outside, "stolen.txt")}: write access not permitted in sandbox\n`,
      );
      expect(mvOut.exitCode).toBe(1);
      expect(fs.existsSync(join(data, "file.txt"))).toBe(true);

      const mvIn = await box`mv ${join(outside, "secret.txt")} ${data}`.quiet().nothrow();
      expect(mvIn.stderr.toString()).toBe(
        `mv: ${join(outside, "secret.txt")}: write access not permitted in sandbox\n`,
      );
      expect(mvIn.exitCode).toBe(1);
    });

    test("conditional file tests answer as nonexistent outside the grants", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { read: [data] } });

      const allowed = await box`[[ -f ${join(data, "file.txt")} ]] && echo yes || echo no`.quiet();
      expect(allowed.stdout.toString()).toBe("yes\n");

      // secret.txt exists but is outside the read grant: the probe must not
      // reveal it.
      const denied = await box`[[ -f ${join(String(dir), "secret.txt")} ]] && echo yes || echo no`.quiet();
      expect(denied.stdout.toString()).toBe("no\n");
    });
  });

  describe("escape attempts", () => {
    test("dot-dot traversal is canonicalized before the check", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { read: [data] } });

      const sneaky = join(data, "..", "secret.txt");
      const result = await box`echo ok < ${sneaky}`.quiet().nothrow();
      expect(result.stderr.toString()).toBe(`bun: ${sneaky}: read access not permitted in sandbox\n`);
      expect(result.exitCode).toBe(1);

      const lsDotDot = await box`ls ${join(data, "..")}`.quiet().nothrow();
      expect(lsDotDot.stderr.toString()).toBe(`ls: ${join(data, "..")}: read access not permitted in sandbox\n`);
      expect(lsDotDot.exitCode).toBe(1);
    });

    test("cd cannot leave the granted prefixes", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { read: [data], write: [data] } });

      const up = await box.cwd(data)`cd .. && echo escaped > escaped.txt`.quiet().nothrow();
      expect(up.stderr.toString()).toBe("cd: ..: read access not permitted in sandbox\n");
      expect(up.exitCode).toBe(1);
      expect(fs.existsSync(join(String(dir), "escaped.txt"))).toBe(false);

      // cd within the grant, then relative operations resolve against it.
      const inside = await box.cwd(data)`cd . && echo rel > rel.txt`.quiet();
      expect(inside.exitCode).toBe(0);
      expect(fs.readFileSync(join(data, "rel.txt"), "utf8")).toBe("rel\n");
    });

    test.skipIf(isWindows)("symlinks cannot smuggle reads outside the sandbox", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      fs.symlinkSync(String(dir), join(data, "updir"));
      fs.symlinkSync(join(String(dir), "secret.txt"), join(data, "secret-link"));
      const box = $.sandbox({ fs: { read: [data] } });

      // Enumerating through a symlinked directory is denied...
      const viaDir = await box`ls ${join(data, "updir")}`.quiet().nothrow();
      expect(viaDir.stderr.toString()).toBe(`ls: ${join(data, "updir")}: read access not permitted in sandbox\n`);
      expect(viaDir.exitCode).toBe(1);

      // ...as is reading through a symlinked file...
      const viaFile = await box`echo ok < ${join(data, "secret-link")}`.quiet().nothrow();
      expect(viaFile.stderr.toString()).toBe(
        `bun: ${join(data, "secret-link")}: read access not permitted in sandbox\n`,
      );
      expect(viaFile.exitCode).toBe(1);

      // ...and probing through one.
      const probe = await box`[[ -f ${join(data, "secret-link")} ]] && echo yes || echo no`.quiet();
      expect(probe.stdout.toString()).toBe("no\n");
    });

    test.skipIf(isWindows)("symlinked write targets are blocked", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      fs.symlinkSync(join(String(dir), "secret.txt"), join(data, "write-link"));
      const box = $.sandbox({ fs: { write: [data] } });

      const result = await box`echo overwritten > ${join(data, "write-link")}`.quiet().nothrow();
      expect(result.stderr.toString()).toBe(
        `bun: ${join(data, "write-link")}: write access not permitted in sandbox\n`,
      );
      expect(result.exitCode).toBe(1);
      expect(fs.readFileSync(join(String(dir), "secret.txt"), "utf8")).toBe("SECRET\n");
    });

    test("glob expansion cannot enumerate outside the grants", async () => {
      using dir = sandboxDir();
      const data = join(String(dir), "data");
      const box = $.sandbox({ fs: { read: [data] } });

      // Inside: expands normally.
      const inside = await box.cwd(data)`echo *.txt`.quiet();
      expect(inside.stdout.toString().split(/\s+/).filter(Boolean).sort()).toEqual(["file.txt", "other.txt"]);

      // Outside: the walk is refused before touching the filesystem.
      const outside = await box`echo ${String(dir)}/*`.quiet().nothrow();
      expect(outside.stderr.toString()).toContain("read access not permitted in sandbox");
      expect(outside.stdout.toString()).not.toContain("secret");
      expect(outside.exitCode).toBe(1);
    });

    test("subshells and command substitution inherit the policy", async () => {
      using dir = sandboxDir();
      const box = $.sandbox({ fs: { read: [join(String(dir), "data")] } });

      const subshell = await box`(ls ${String(dir)})`.quiet().nothrow();
      expect(subshell.stderr.toString()).toBe(`ls: ${String(dir)}: read access not permitted in sandbox\n`);
      expect(subshell.exitCode).toBe(1);

      // The inner command is denied, so the substitution expands to nothing
      // (the outer echo still succeeds, matching POSIX semantics).
      const subst = await box`echo $(ls ${String(dir)})`.quiet().nothrow();
      expect(subst.stdout.toString()).toBe("\n");
      expect(subst.stdout.toString()).not.toContain("secret");

      const pipeline = await box`echo probe | ls ${String(dir)}`.quiet().nothrow();
      expect(pipeline.stderr.toString()).toBe(`ls: ${String(dir)}: read access not permitted in sandbox\n`);
      expect(pipeline.exitCode).toBe(1);
    });
  });

  describe("limits", () => {
    test("timeout rejects a runaway command", async () => {
      const box = $.sandbox({ limits: { timeout: 300 } });
      let error: any;
      try {
        await box`yes`.quiet();
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(error.message).toBe("Shell command timed out after 300ms (sandbox limits.timeout)");
      expect(error.exitCode).toBe(1);
    });

    test("timeout does not fire for fast commands", async () => {
      const box = $.sandbox({ limits: { timeout: 5000 } });
      const result = await box`echo quick`.quiet();
      expect(result.stdout.toString()).toBe("quick\n");
      expect(result.exitCode).toBe(0);
    });

    test("maxOutputBytes rejects a command that emits too much", async () => {
      const box = $.sandbox({ limits: { maxOutputBytes: 4096 } });
      let error: any;
      try {
        await box`yes`.quiet();
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(error.message).toBe("Shell command output exceeded 4096 bytes (sandbox limits.maxOutputBytes)");
      expect(error.exitCode).toBe(1);
    });

    test("maxOutputBytes allows output under the limit", async () => {
      const box = $.sandbox({ limits: { maxOutputBytes: 4096 } });
      const result = await box`seq 1 5`.quiet();
      expect(result.stdout.toString()).toBe("1\n2\n3\n4\n5\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("API shape", () => {
    test("returns a $-compatible tagged template function", async () => {
      const box = $.sandbox({});
      expect(typeof box).toBe("function");
      expect(typeof box.cwd).toBe("function");
      expect(typeof box.env).toBe("function");
      expect(typeof box.nothrow).toBe("function");
      expect((await box`echo shaped`.quiet()).stdout.toString()).toBe("shaped\n");
    });

    test("inherits cwd and env from the shell it derives from", async () => {
      using dir = sandboxDir();
      const parent = new $.Shell();
      parent.cwd(String(dir));
      parent.env({ SANDBOX_TEST_VAR: "inherited" });
      const box = parent.sandbox({});
      const result = await box`echo $SANDBOX_TEST_VAR && pwd`.quiet();
      const [envLine, pwdLine] = result.stdout.toString().split(/\r?\n/);
      expect(envLine).toBe("inherited");
      expect(fs.realpathSync(pwdLine)).toBe(fs.realpathSync(String(dir)));
    });

    test("a sandboxed shell cannot be re-sandboxed", () => {
      const box = $.sandbox({});
      expect(() => box.sandbox({})).toThrow("$.sandbox: this shell is already sandboxed");
    });

    test("sandboxing does not affect the shell it derives from", async () => {
      const shell = new $.Shell();
      shell.sandbox({ commands: { deny: ["echo"] } });
      expect((await shell`echo unaffected`.quiet()).stdout.toString()).toBe("unaffected\n");
    });

    test("text()/json() work on sandboxed shells", async () => {
      const box = $.sandbox({});
      expect(await box`echo '{"a": 1}'`.json()).toEqual({ a: 1 });
      expect(await box`echo plain`.text()).toBe("plain\n");
    });
  });
});
