import { $ } from "bun";
import { describe, expect, test } from "bun:test";

describe("null byte injection protection", () => {
  describe("Bun.spawn", () => {
    test("throws error when command contains null byte", async () => {
      const command = "echo\0evil";
      expect(() => {
        Bun.spawn([command]);
      }).toThrow(/must be a string without null bytes/);
    });

    test("throws error when argument contains null byte", async () => {
      const arg = "x.html\0.txt";
      expect(() => {
        Bun.spawn(["echo", arg]);
      }).toThrow(/must be a string without null bytes/);
    });

    test("throws error with ERR_INVALID_ARG_VALUE code for args with null byte", async () => {
      const arg = "test\0value";
      try {
        Bun.spawn(["echo", arg]);
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/args\[1\]/);
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("throws error for null byte in env key", async () => {
      expect(() => {
        Bun.spawn(["echo", "hello"], {
          env: {
            "MY\0VAR": "value",
          },
        });
      }).toThrow(/must be a string without null bytes/);
    });

    test("throws error for null byte in env value", async () => {
      expect(() => {
        Bun.spawn(["echo", "hello"], {
          env: {
            MY_VAR: "val\0ue",
          },
        });
      }).toThrow(/must be a string without null bytes/);
    });

    test("throws error for null byte in argv0", async () => {
      try {
        Bun.spawn({ cmd: ["echo", "hello"], argv0: "AAA\0BBB" });
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/options\.argv0/);
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("throws error for null byte in cwd", async () => {
      try {
        Bun.spawn({ cmd: ["echo", "hello"], cwd: "/tmp\0/etc" });
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/options\.cwd/);
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("works normally with valid arguments", async () => {
      await using proc = Bun.spawn(["echo", "hello"], { stdout: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      expect(stdout.trim()).toBe("hello");
      expect(await proc.exited).toBe(0);
    });

    test("works with spread process.env", async () => {
      await using proc = Bun.spawn(["echo", "hello"], {
        env: { ...process.env },
        stdout: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      expect(stdout.trim()).toBe("hello");
      expect(await proc.exited).toBe(0);
    });
  });

  describe("Bun.spawnSync", () => {
    test("throws error when command contains null byte", () => {
      const command = "echo\0evil";
      expect(() => {
        Bun.spawnSync([command]);
      }).toThrow(/must be a string without null bytes/);
    });

    test("throws error when argument contains null byte", () => {
      const arg = "x.html\0.txt";
      expect(() => {
        Bun.spawnSync(["echo", arg]);
      }).toThrow(/must be a string without null bytes/);
    });

    test("throws error for null byte in argv0", () => {
      try {
        Bun.spawnSync({ cmd: ["echo", "hello"], argv0: "AAA\0BBB" });
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/options\.argv0/);
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("throws error for null byte in cwd", () => {
      try {
        Bun.spawnSync({ cmd: ["echo", "hello"], cwd: "/tmp\0/etc" });
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/options\.cwd/);
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("works normally with valid argv0", () => {
      // argv0 kept as "echo": busybox dispatches applets by argv[0].
      const result = Bun.spawnSync({ cmd: ["echo", "hello"], argv0: "echo" });
      expect(result.stdout.toString().trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    test("works normally with valid arguments", () => {
      const result = Bun.spawnSync(["echo", "hello"]);
      expect(result.stdout.toString().trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Shell ($)", () => {
    test("throws error when interpolated string contains null byte", () => {
      const name = "x.html\0.txt";
      expect(() => $`echo ${name}`).toThrow(/must be a string without null bytes/);
    });

    test("throws error with ERR_INVALID_ARG_VALUE code for shell args with null byte", () => {
      const arg = "test\0value";
      try {
        $`echo ${arg}`;
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("throws error when array element contains null byte", () => {
      const args = ["valid", "x\0y", "also valid"];
      expect(() => $`echo ${args}`).toThrow(/must be a string without null bytes/);
    });

    test("throws error when object with raw property contains null byte", () => {
      const raw = { raw: "test\0value" };
      expect(() => $`echo ${raw}`).toThrow(/must be a string without null bytes/);
    });

    test("works normally with valid arguments", async () => {
      const name = "hello.txt";
      const result = await $`echo ${name}`.text();
      expect(result.trim()).toBe("hello.txt");
    });

    test("throws error when .cwd() option contains null byte", () => {
      try {
        $`echo hello`.cwd("/tmp\0/etc");
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/cwd must be a string without null bytes/);
      }
    });

    test("throws error when .env() value contains null byte", () => {
      try {
        $`echo hello`.env({ X: "safe\0tail" });
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("throws error when .env() key contains null byte", () => {
      try {
        $`echo hello`.env({ "MY\0VAR": "value" });
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/must be a string without null bytes/);
      }
    });

    test("throws error when $.cwd() default contains null byte", () => {
      const sh = new $.Shell();
      sh.cwd("/tmp\0/etc");
      try {
        sh`echo hello`;
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(e.message).toMatch(/cwd must be a string without null bytes/);
      }
    });

    test(".cwd() and .env() accept valid values", async () => {
      const result = await $`echo ok`
        .cwd(process.cwd())
        .env({ ...process.env })
        .text();
      expect(result.trim()).toBe("ok");
    });
  });
});
