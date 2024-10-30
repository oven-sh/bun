import { test, describe, spawn } from "./harness/index";
import * as os from "node:os";

describe({ module: "node:os" }, () => {
  describe({ property: "EOL", comptime: true }, () => {
    test({ os: "posix" }, () => {
      expect(os.EOL).toBe("\n");
    });

    test({ os: "windows" }, () => {
      expect(os.EOL).toBe("\r\n");
    });
  });

  test({ function: "platform", comptime: true }, () => {
    test(() => {
      expect(os.platform()).toMatch(/^(darwin|linux|win32)$/);
    });

    test({ exhaustive: true, os: "posix", command: "uname" }, async () => {
      const { stdout } = await spawn(["uname", "-s"]);
      const expected = stdout.trim().toLowerCase();

      return () => {
        expect(os.platform()).toMatch(expected);
      };
    });

    test({ exhaustive: true, os: "windows", command: "wmic" }, async () => {
      const { stdout } = await spawn(["wmic", "os", "get", "osname"]);
      const expected = stdout.trim().toLowerCase();

      return () => {
        expect(os.platform()).toMatch(expected);
      };
    });
  });

  describe({ function: "arch", comptime: true }, () => {
    test(() => {
      expect(os.arch()).toBeOneOf(["x64", "arm64"]);
    });

    test({ exhaustive: true, os: "posix", command: "uname" }, async () => {
      const { stdout } = await spawn(["uname", "-m"]);
      const expected = stdout.trim();

      return () => {
        expect(os.arch()).toMatch(expected);
      };
    });

    test({ exhaustive: true, os: "windows", command: "wmic" }, async () => {
      const { stdout } = await spawn(["wmic", "os", "get", "osarchitecture"]);
      const expected = stdout.trim();

      return () => {
        expect(os.arch()).toMatch(expected);
      };
    });
  });

  test({ function: "endianness", comptime: true }, () => {
    expect(os.endianness()).toBeOneOf(["LE", "BE"]);
  });

  describe({ function: "freemem", comptime: true }, () => {
    test(() => {
      expect(os.freemem()).toBeGreaterThan(0);
    });

    test({ exhaustive: true, os: "posix", command: "free" }, async () => {
      const { stdout } = await spawn(["free", "-b"]);
      const expected = stdout.trim();

      return () => {
        expect(os.freemem()).toMatch(expected);
      };
    });
  });
});
