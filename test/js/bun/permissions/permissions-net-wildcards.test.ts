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

      expect(stdout.trim()).toBe("granted granted");
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

      expect(stdout.trim()).toBe("granted granted");
      expect(exitCode).toBe(0);
    });
  });
});
