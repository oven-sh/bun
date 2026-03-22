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
  });
});
