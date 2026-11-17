import { spawn } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "bun:test";

// The epoll ready buffer holds 1024 events. With more than that many active
// keep-alive sockets, a full poll must yield to a due timer instead of re-draining
// up to 48 expensive batches before the next event-loop turn.
const stressTest = process.platform === "linux" ? test : test.skip;

stressTest(
  "saturated Bun.serve sockets do not starve a 20ms timer",
  async () => {
    const fixture = join(import.meta.dir, "fixtures", "serve-timer-drain.fixture.ts");
    const server = spawn(process.execPath, [fixture, "server"], { stdio: ["ignore", "pipe", "pipe"] });
    let client: ReturnType<typeof spawn> | undefined;
    let stdout = "";
    let stderr = "";
    let resolvePort!: (port: number) => void;
    const portReady = new Promise<number>(resolve => {
      resolvePort = resolve;
    });
    const samples: { reqs: number; timerFires: number; msSinceLastTimerFire: number; maxGap: number }[] = [];
    server.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      for (;;) {
        const newline = stdout.indexOf("\n");
        if (newline < 0) break;
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        try {
          const report = JSON.parse(line);
          if (typeof report.port === "number") resolvePort(report.port);
          else if (typeof report.reqs === "number") samples.push(report);
        } catch {
          // Ignore partial or unrelated startup messages.
        }
      }
    });
    server.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      const port = await Promise.race([
        portReady,
        Bun.sleep(5000).then(() => {
          throw new Error("server did not start: " + stderr);
        }),
      ]);
      client = spawn(process.execPath, [fixture, "client", String(port), "1250"], {
        stdio: "ignore",
        env: { ...process.env, BUN_CONFIG_MAX_HTTP_REQUESTS: "65000" },
      });
      await Bun.sleep(8000);
      expect(samples.length).toBeGreaterThanOrEqual(3);
      expect(samples.reduce((sum, sample) => sum + sample.reqs, 0)).toBeGreaterThan(1000);
      expect(Math.max(...samples.map(sample => sample.maxGap))).toBeLessThan(1500);
      expect(samples.reduce((sum, sample) => sum + sample.timerFires, 0)).toBeGreaterThan(0);
    } finally {
      client?.kill();
      server.kill();
    }
  },
  20000,
);
