import { describe, expect, it } from "bun:test";

// process.initgroups is only available on non-Windows POSIX systems
const isWindows = process.platform === "win32";

describe("process.initgroups", () => {
  it("is undefined on Windows, a function on POSIX", () => {
    if (isWindows) {
      expect(process.initgroups).toBeUndefined();
    } else {
      expect(typeof process.initgroups).toBe("function");
    }
  });

  if (!isWindows) {
    it("has length 2", () => {
      expect(process.initgroups.length).toBe(2);
    });

    it("throws ERR_INVALID_ARG_TYPE when user argument is missing", () => {
      expect(() => process.initgroups()).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" })
      );
    });

    it("throws ERR_INVALID_ARG_TYPE when user is null", () => {
      expect(() => process.initgroups(null, 0)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" })
      );
    });

    it("throws ERR_INVALID_ARG_TYPE when user is a boolean", () => {
      expect(() => process.initgroups(true, 0)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" })
      );
    });

    it("throws ERR_INVALID_ARG_TYPE when extraGroup argument is missing", () => {
      expect(() => process.initgroups("root")).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" })
      );
    });

    it("throws ERR_INVALID_ARG_TYPE when extraGroup is null", () => {
      expect(() => process.initgroups("root", null)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" })
      );
    });

    it("throws ERR_UNKNOWN_CREDENTIAL for a non-existent string username", () => {
      expect(() => process.initgroups("__bun_nonexistent_user_12345__", 0)).toThrow(
        expect.objectContaining({ code: "ERR_UNKNOWN_CREDENTIAL" })
      );
    });

    it("throws ERR_UNKNOWN_CREDENTIAL for a non-existent numeric UID", () => {
      // UID 2147483647 is extremely unlikely to exist
      expect(() => process.initgroups(2147483647, 0)).toThrow(
        expect.objectContaining({ code: "ERR_UNKNOWN_CREDENTIAL" })
      );
    });

    it("succeeds or throws EPERM when called with current user (requires root to fully succeed)", () => {
      try {
        const uid = process.getuid();
        const gid = process.getgid();
        process.initgroups(uid, gid);
        // If we reach here, it succeeded (we are root or have capability)
      } catch (err) {
        // EPERM is expected when not running as root
        if (err.code !== "EPERM") {
          throw err;
        }
      }
    });
  }
});
