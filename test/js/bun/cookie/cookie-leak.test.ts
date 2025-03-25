import { describe, expect, test } from "bun:test";

describe("CookieMap leaks", () => {
  const bun = process.argv[0];
  const cwd = import.meta.dir;
  const iters = 10000;
  const hundredMb = (1 << 20) * 100;

  test("CookieMap creation and manipulation", () => {
    const code = /* ts */ `
      let prev: number | undefined = undefined;
      for (let i = 0; i < ${iters}; i++) {
        Bun.gc(true);
        (function () {
          // Create a new CookieMap and perform various operations
          const cookieMap = new Bun.CookieMap();
          
          // Add cookies
          cookieMap.set("session", "abc123", {
            httpOnly: true,
            secure: true,
            maxAge: 3600
          });
          
          cookieMap.set("preference", "theme=dark", {
            maxAge: 86400
          });
          
          // Get cookies
          const session = cookieMap.get("session");
          const pref = cookieMap.get("preference");
          
          // Delete a cookie
          cookieMap.delete("session");
          
          // Get all changes
          const changes = cookieMap.getAllChanges();
          
          // Iterate over entries
          for (const [key, value] of cookieMap.entries()) {
            // Just access the values to ensure they're used
            const k = key;
            const v = value;
          }
        })();
        Bun.gc(true);
        const val = process.memoryUsage.rss();
        if (prev === undefined) {
          prev = val;
        } else {
          if (Math.abs(prev - val) >= ${hundredMb}) {
            throw new Error('uh oh: ' + Math.abs(prev - val))
          }
        }
      }
    `;

    const { exitCode } = Bun.spawnSync([bun, "--smol", "-e", code], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    expect(exitCode).toBe(0);
  });

  test("CookieMap parsing and serialization", () => {
    const code = /* ts */ `
      let prev: number | undefined = undefined;
      for (let i = 0; i < ${iters}; i++) {
        Bun.gc(true);
        (function () {
          // Create from cookie header string
          const cookieMap = new Bun.CookieMap("name=value; foo=bar; session=abc123; preference=dark");
          
          // Get and modify cookies
          cookieMap.set("session", "newvalue", {
            httpOnly: true,
            secure: true,
            partitioned: true,
            sameSite: "strict"
          });
          
          // Add and remove cookies
          cookieMap.set(new Bun.Cookie("temp", "test", { maxAge: 60 }));
          cookieMap.delete("foo");
          
          // Get all changes and convert to JSON
          const changes = cookieMap.getAllChanges();
          const json = cookieMap.toJSON();
          
          // Force cookie expiration checks
          for (const cookie of changes) {
            cookie.isExpired();
          }
        })();
        Bun.gc(true);
        const val = process.memoryUsage.rss();
        if (prev === undefined) {
          prev = val;
        } else {
          if (Math.abs(prev - val) >= ${hundredMb}) {
            throw new Error('uh oh: ' + Math.abs(prev - val))
          }
        }
      }
    `;

    const { exitCode } = Bun.spawnSync([bun, "--smol", "-e", code], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    expect(exitCode).toBe(0);
  });
});
