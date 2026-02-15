import { describe, it, expect } from "bun:test";
import { initgroups } from "node:process";
import { strictEqual, throws } from "node:assert";

describe("process.initgroups", () => {
  it("is a function", () => {
    expect(typeof initgroups).toBe("function");
  });

  it("throws on invalid arguments", () => {
    throws(() => initgroups(), {
      code: "ERR_INVALID_ARG_TYPE",
    });
    throws(() => initgroups(null), {
      code: "ERR_INVALID_ARG_TYPE",
    });
    throws(() => initgroups("root", null), {
      code: "ERR_INVALID_ARG_TYPE",
    });
  });

  it("throws on non-existent user", () => {
    // This might fail if the user actually exists, but "nonexistentuser12345" is unlikely
    throws(() => initgroups("nonexistentuser12345", 0), {
      code: "ERR_UNKNOWN_CREDENTIAL",
    });
  });

  it("throws on non-existent user (uid)", () => {
    // UID 99999999 is unlikely to exist
    throws(() => initgroups(99999999, 0), {
      code: "ERR_UNKNOWN_CREDENTIAL",
    });
  });

  // Note: Successful execution requires root privileges.
  // We can try to run it with the current user, but it might fail with EPERM.
  // If we are root, it should succeed.
  it("runs with current user (might fail with EPERM)", () => {
    try {
      const uid = process.getuid();
      const gid = process.getgid();
      // Resolving current username might be tricky without `os.userInfo()`, 
      // but we can try passing the UID if our implementation supports it (it does).
      // Wait, our implementation resolves UID to username internally.
      
      initgroups(uid, gid);
    } catch (err) {
      if (err.code === "EPERM") {
        // Expected if not root
        return;
      }
      throw err;
    }
  });
});
