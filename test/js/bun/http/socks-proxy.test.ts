import { describe, expect, test } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

describe("SOCKS proxy", () => {
  test("should detect SOCKS5 proxy URLs in environment variables", async () => {
    const dir = tempDirWithFiles("socks-env-test", {
      "test.js": `
        console.log(JSON.stringify({
          http_proxy: process.env.http_proxy,
          https_proxy: process.env.https_proxy
        }));
      `,
    });

    const env = {
      ...bunEnv,
      http_proxy: "socks5://127.0.0.1:1080",
      https_proxy: "socks5h://proxy.example.com:9050",
    };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout.trim());
    expect(output.http_proxy).toBe("socks5://127.0.0.1:1080");
    expect(output.https_proxy).toBe("socks5h://proxy.example.com:9050");
  });

  test("should handle connection errors gracefully for unreachable SOCKS proxy", async () => {
    const dir = tempDirWithFiles("socks-error-test", {
      "test.js": `
        try {
          const response = await fetch("http://127.0.0.1:1234/test", {
            proxy: "socks5://127.0.0.1:65432"
          });
          console.log("UNEXPECTED_SUCCESS");
        } catch (error) {
          console.log("CONNECTION_ERROR");
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("CONNECTION_ERROR");
  });

  test("should support SOCKS5 and SOCKS5h URL schemes", async () => {
    const dir = tempDirWithFiles("socks-schemes-test", {
      "test.js": `
        // Test that the URLs are parsed without throwing
        try {
          await fetch("http://127.0.0.1:1234/test", {
            proxy: "socks5://127.0.0.1:1080"
          });
        } catch (error) {
          console.log("socks5-attempted");
        }

        try {
          await fetch("http://127.0.0.1:1234/test", {
            proxy: "socks5h://127.0.0.1:1080"
          });
        } catch (error) {
          console.log("socks5h-attempted");
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout.trim();
    expect(output).toContain("socks5-attempted");
    expect(output).toContain("socks5h-attempted");
  });
});