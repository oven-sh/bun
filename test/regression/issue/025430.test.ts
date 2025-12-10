import { expect, test, describe } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test for https://github.com/oven-sh/bun/issues/25430
// HTTPS fetch in node:http server should not cause 100% CPU usage
describe("#25430 CPU spin after HTTPS fetch in node:http server", () => {
  test("CPU should be idle after HTTPS fetch completes", async () => {
    // Spawn a separate process to test CPU usage
    // The process makes HTTPS requests and then measures CPU usage
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");

        const server = http.createServer(async (req, res) => {
          // Make multiple HTTPS fetch requests to trigger connection pooling
          await Promise.all([
            fetch("https://example.com"),
            fetch("https://example.com"),
          ]);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });

        server.listen(0, async () => {
          const port = server.address().port;

          // Make a request to trigger the HTTPS fetches
          const response = await fetch("http://localhost:" + port);
          const data = await response.json();

          if (!data.ok) {
            console.error("Request failed");
            process.exit(1);
          }

          // Wait a moment for connections to settle into the pool
          await Bun.sleep(100);

          // Measure CPU usage over 500ms
          const startUsage = process.cpuUsage();
          await Bun.sleep(500);
          const endUsage = process.cpuUsage(startUsage);

          // Calculate CPU percentage
          const totalCpuTime = endUsage.user + endUsage.system;
          const elapsedMicros = 500 * 1000; // 500ms in microseconds
          const cpuPercent = (totalCpuTime / elapsedMicros) * 100;

          server.close();

          // CPU should be mostly idle (< 20% of elapsed time)
          // Before the fix, this would be ~100%
          if (cpuPercent >= 20) {
            console.error("CPU usage too high: " + cpuPercent.toFixed(2) + "%");
            process.exit(1);
          }

          console.log("CPU usage: " + cpuPercent.toFixed(2) + "% (OK)");
          process.exit(0);
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(exitCode).toBe(0);
  });

  test("Multiple sequential requests should not accumulate CPU usage", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require("node:http");

        const server = http.createServer(async (req, res) => {
          await fetch("https://example.com");
          res.writeHead(200);
          res.end("ok");
        });

        server.listen(0, async () => {
          const port = server.address().port;

          // Make multiple sequential requests
          for (let i = 0; i < 3; i++) {
            const response = await fetch("http://localhost:" + port);
            await response.text();
          }

          // Wait for connections to settle
          await Bun.sleep(100);

          // Measure CPU usage
          const startUsage = process.cpuUsage();
          await Bun.sleep(500);
          const endUsage = process.cpuUsage(startUsage);

          const totalCpuTime = endUsage.user + endUsage.system;
          const elapsedMicros = 500 * 1000;
          const cpuPercent = (totalCpuTime / elapsedMicros) * 100;

          server.close();

          if (cpuPercent >= 20) {
            console.error("CPU usage too high after sequential requests: " + cpuPercent.toFixed(2) + "%");
            process.exit(1);
          }

          console.log("CPU usage after sequential requests: " + cpuPercent.toFixed(2) + "% (OK)");
          process.exit(0);
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(exitCode).toBe(0);
  });
});
