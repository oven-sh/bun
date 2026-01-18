import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("Network permission wildcards", () => {
  describe("Single-segment wildcard (*)", () => {
    test("*.example.com matches api.example.com", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "api.example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("*.example.com does NOT match a.b.example.com", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "a.b.example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("denied");
      expect(exitCode).toBe(0);
    });

    test("*.example.com does NOT match example.com", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("denied");
      expect(exitCode).toBe(0);
    });

    test("api.*.example.com matches api.v1.example.com", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=api.*.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "api.v1.example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });
  });

  describe("Multi-segment wildcard (**)", () => {
    test("**.example.com matches api.example.com", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=**.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "api.example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("**.example.com matches a.b.c.example.com", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=**.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "a.b.c.example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("**.example.com does NOT match example.com (requires at least one segment)", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=**.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("denied");
      expect(exitCode).toBe(0);
    });
  });

  describe("Port patterns", () => {
    test("example.com:* matches any port", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com:*",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com:80" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "example.com:8080" });
          console.log(result1.state, result2.state, result3.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted granted");
      expect(exitCode).toBe(0);
    });

    test("example.com:443 matches only port 443", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com:443",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "example.com:80" });
          console.log(result1.state, result2.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted denied");
      expect(exitCode).toBe(0);
    });

    test("example.com:80;443 matches ports 80 and 443", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com:80;443",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com:80" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "example.com:8080" });
          console.log(result1.state, result2.state, result3.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted denied");
      expect(exitCode).toBe(0);
    });

    test("example.com:8000-9000 matches port range", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com:8000-9000",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com:8500" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "example.com:8000" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "example.com:9000" });
          const result4 = Bun.permissions.querySync({ name: "net", host: "example.com:7999" });
          const result5 = Bun.permissions.querySync({ name: "net", host: "example.com:9001" });
          console.log(result1.state, result2.state, result3.state, result4.state, result5.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted granted denied denied");
      expect(exitCode).toBe(0);
    });
  });

  describe("Protocol prefixes", () => {
    test("https://example.com matches HTTPS requests", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=https://example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("https://*.example.com with wildcard and protocol", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=https://*.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "api.example.com:443" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });
  });

  describe("Combined patterns", () => {
    test("*.example.com:8000-9000 combines wildcard and port range", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.example.com:8000-9000",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "api.example.com:8500" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "api.example.com:80" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "example.com:8500" });
          console.log(result1.state, result2.state, result3.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted denied denied");
      expect(exitCode).toBe(0);
    });

    test("https://**.example.com:443 combines all features", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=https://**.example.com:443",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "a.b.c.example.com:443" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "api.example.com:443" });
          console.log(result1.state, result2.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted");
      expect(exitCode).toBe(0);
    });
  });

  describe("Multiple patterns (comma-separated)", () => {
    test("multiple hosts allowed via comma separation", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com,localhost,api.test.com",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "localhost" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "api.test.com" });
          const result4 = Bun.permissions.querySync({ name: "net", host: "other.com" });
          console.log(result1.state, result2.state, result3.state, result4.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted granted denied");
      expect(exitCode).toBe(0);
    });

    test("multiple wildcards allowed via comma separation", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.example.com,*.test.org",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "api.example.com" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "www.test.org" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "api.other.com" });
          console.log(result1.state, result2.state, result3.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted denied");
      expect(exitCode).toBe(0);
    });
  });

  describe("IPv6 addresses", () => {
    test("[::1] localhost IPv6 matching", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=[::1]",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "[::1]" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "[::1]:8080" });
          console.log(result1.state, result2.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted");
      expect(exitCode).toBe(0);
    });

    test("[::1]:8080 with specific port", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=[::1]:8080",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "[::1]:8080" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "[::1]:9000" });
          console.log(result1.state, result2.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted denied");
      expect(exitCode).toBe(0);
    });
  });

  describe("TLD and suffix wildcards", () => {
    test("*.com matches any .com domain", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.com",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "test.com" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "example.org" });
          const result4 = Bun.permissions.querySync({ name: "net", host: "sub.example.com" });
          console.log(result1.state, result2.state, result3.state, result4.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // *.com matches exactly one segment before .com
      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted denied denied");
      expect(exitCode).toBe(0);
    });

    test("**.com matches any depth of .com domain", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=**.com",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "sub.example.com" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "a.b.c.example.com" });
          const result4 = Bun.permissions.querySync({ name: "net", host: "example.org" });
          console.log(result1.state, result2.state, result3.state, result4.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted granted denied");
      expect(exitCode).toBe(0);
    });
  });

  describe("WebSocket and HTTP protocols", () => {
    test("ws://localhost matches WebSocket", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=ws://localhost",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "localhost" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("wss://*.example.com matches secure WebSocket with wildcard", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=wss://*.example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "api.example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("http://example.com matches HTTP protocol", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=http://example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "example.com:80" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });
  });

  describe("Double star in middle position", () => {
    test("api.**.example.com matches nested subdomains", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=api.**.example.com",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "api.v1.example.com" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "api.v1.v2.example.com" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "www.example.com" });
          console.log(result1.state, result2.state, result3.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted denied");
      expect(exitCode).toBe(0);
    });
  });

  describe("Port list with more than 2 ports", () => {
    test("example.com:80;443;8080 matches multiple ports", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com:80;443;8080",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "example.com:80" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "example.com:8080" });
          const result4 = Bun.permissions.querySync({ name: "net", host: "example.com:9000" });
          console.log(result1.state, result2.state, result3.state, result4.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted granted denied");
      expect(exitCode).toBe(0);
    });
  });

  describe("Actual network requests", () => {
    test("fetch is blocked without permission", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--no-prompt",
          "-e",
          `
          try {
            await fetch("https://example.com");
            console.log("SUCCESS");
          } catch (e) {
            console.log("BLOCKED:", e.code || e.name);
          }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toContain("BLOCKED");
      expect(exitCode).toBe(0);
    });

    test("fetch is allowed with matching wildcard", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.cloudflare.com",
          "-e",
          `
          try {
            const res = await fetch("https://workers.cloudflare.com/cf.json", { signal: AbortSignal.timeout(5000) });
            console.log("STATUS:", res.status);
          } catch (e) {
            console.log("ERROR:", e.code || e.name);
          }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Should get a status code, not be blocked
      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toMatch(/STATUS: \d+/);
      expect(exitCode).toBe(0);
    });

    test("Bun.serve is blocked without permission", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--no-prompt",
          "-e",
          `
          try {
            const server = Bun.serve({
              port: 0,
              fetch: () => new Response("ok"),
            });
            console.log("SERVER STARTED");
            server.stop();
          } catch (e) {
            console.log("BLOCKED:", e.code || e.name);
          }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toContain("BLOCKED");
      expect(exitCode).toBe(0);
    });

    test("Bun.serve is allowed with localhost permission", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          // Bun.serve binds to 0.0.0.0 by default, so we need to allow it
          "--allow-net=localhost,127.0.0.1,0.0.0.0",
          "-e",
          `
          try {
            const server = Bun.serve({
              port: 0,
              fetch: () => new Response("ok"),
            });
            console.log("SERVER STARTED on port", server.port);
            server.stop();
          } catch (e) {
            console.log("ERROR:", e.code || e.name);
          }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toMatch(/SERVER STARTED on port \d+/);
      expect(exitCode).toBe(0);
    });
  });

  describe("Edge cases", () => {
    test("pattern with no wildcard still works as exact match", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=specific.example.com:443",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "specific.example.com:443" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "other.example.com:443" });
          console.log(result1.state, result2.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted denied");
      expect(exitCode).toBe(0);
    });

    test("wildcard with port list", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=*.example.com:80;443",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "api.example.com:80" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "api.example.com:443" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "api.example.com:8080" });
          console.log(result1.state, result2.state, result3.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted denied");
      expect(exitCode).toBe(0);
    });

    test("0.0.0.0 matches all interfaces", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=0.0.0.0",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "0.0.0.0:3000" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });
  });

  describe("Backward compatibility", () => {
    test("exact host match still works", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "example.com" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("host without port matches host with port", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=example.com",
          "-e",
          `
          const result = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          console.log(result.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted");
      expect(exitCode).toBe(0);
    });

    test("localhost works with various ports", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=localhost",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "localhost" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "localhost:3000" });
          const result3 = Bun.permissions.querySync({ name: "net", host: "localhost:8080" });
          console.log(result1.state, result2.state, result3.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted granted");
      expect(exitCode).toBe(0);
    });

    test("IP address matching still works", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          "--allow-net=127.0.0.1",
          "-e",
          `
          const result1 = Bun.permissions.querySync({ name: "net", host: "127.0.0.1" });
          const result2 = Bun.permissions.querySync({ name: "net", host: "127.0.0.1:3000" });
          console.log(result1.state, result2.state);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe(""); // Verify no errors
      expect(stdout.trim()).toBe("granted granted");
      expect(exitCode).toBe(0);
    });
  });
});
