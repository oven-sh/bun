import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { existsSync } from "fs";

describe("systemd-resolved DNS backend", () => {
  const SOCKET_PATH = "/run/systemd/resolve/io.systemd.Resolve";
  const isAvailable = existsSync(SOCKET_PATH);
  
  test.skipIf(!isAvailable)("should use systemd-resolved when available", async () => {
    // Create a test script that uses DNS
    const testScript = `
      import dns from "dns/promises";
      
      const result = await dns.lookup("example.com");
      console.log(JSON.stringify(result));
    `;
    
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    
    const result = JSON.parse(stdout.trim());
    expect(result).toHaveProperty("address");
    expect(result).toHaveProperty("family");
  });
  
  test.skipIf(!isAvailable)("should resolve IPv4 addresses", async () => {
    const testScript = `
      import dns from "dns/promises";
      
      const result = await dns.lookup("google.com", { family: 4 });
      console.log(JSON.stringify(result));
    `;
    
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    
    const result = JSON.parse(stdout.trim());
    expect(result).toHaveProperty("address");
    expect(result.family).toBe(4);
  });
  
  test.skipIf(!isAvailable)("should resolve IPv6 addresses", async () => {
    const testScript = `
      import dns from "dns/promises";
      
      const result = await dns.lookup("google.com", { family: 6 });
      console.log(JSON.stringify(result));
    `;
    
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    
    const result = JSON.parse(stdout.trim());
    expect(result).toHaveProperty("address");
    expect(result.family).toBe(6);
  });
  
  test.skipIf(!isAvailable)("should handle multiple addresses", async () => {
    const testScript = `
      import dns from "dns/promises";
      
      const result = await dns.lookup("google.com", { all: true });
      console.log(JSON.stringify(result));
    `;
    
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    
    const result = JSON.parse(stdout.trim());
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    
    for (const entry of result) {
      expect(entry).toHaveProperty("address");
      expect(entry).toHaveProperty("family");
      expect([4, 6]).toContain(entry.family);
    }
  });
  
  test.skipIf(!isAvailable)("should handle DNS errors gracefully", async () => {
    const testScript = `
      import dns from "dns/promises";
      
      try {
        await dns.lookup("this-domain-definitely-does-not-exist-12345.example");
        console.log("SHOULD_NOT_REACH");
      } catch (err) {
        console.log(JSON.stringify({ error: err.code }));
      }
    `;
    
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    
    expect(exitCode).toBe(0);
    
    const result = JSON.parse(stdout.trim());
    expect(result.error).toBeDefined();
  });
  
  test("should fall back to libc when systemd-resolved is not available", async () => {
    if (isAvailable) {
      // If systemd-resolved is available, we can't test the fallback
      return;
    }
    
    const testScript = `
      import dns from "dns/promises";
      
      const result = await dns.lookup("example.com");
      console.log(JSON.stringify(result));
    `;
    
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", testScript],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    
    const result = JSON.parse(stdout.trim());
    expect(result).toHaveProperty("address");
    expect(result).toHaveProperty("family");
  });
});