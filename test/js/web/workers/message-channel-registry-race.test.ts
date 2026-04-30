import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// MessagePortChannelRegistry is a process-global singleton shared by the main
// thread and every Worker thread. Its m_openChannels HashMap had no lock, so
// when two threads call new MessageChannel() concurrently (each doing two
// HashMap add()s, which rehashes the table as it grows), one thread reads
// freed backing storage and ASAN reports heap-use-after-free.
test("MessagePortChannelRegistry m_openChannels is guarded against concurrent access", async () => {
  using dir = tempDir("message-channel-registry-race", {
    "main.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);

      await new Promise<void>(resolve => {
        worker.onmessage = e => {
          if (e.data === "ready") resolve();
        };
      });

      // Hammer m_openChannels.add() from the main thread while the worker
      // does the same from its thread. The array keeps the channels alive
      // so the map only grows (maximising rehashes).
      const keepAlive: MessageChannel[] = [];
      for (let round = 0; round < 40; round++) {
        for (let i = 0; i < 500; i++) {
          keepAlive.push(new MessageChannel());
        }
        await new Promise<void>(r => setTimeout(r, 0));
      }

      worker.postMessage("stop");
      const workerCount = await new Promise<number>(resolve => {
        worker.onmessage = e => resolve(e.data);
      });
      await worker.terminate();

      console.log(JSON.stringify({ main: keepAlive.length, worker: workerCount }));
    `,
    "worker.ts": `
      declare var self: Worker;
      let stop = false;
      const keepAlive: MessageChannel[] = [];

      self.onmessage = e => {
        if (e.data === "stop") {
          stop = true;
          postMessage(keepAlive.length);
        }
      };

      postMessage("ready");

      const spin = () => {
        for (let i = 0; i < 500 && !stop; i++) {
          keepAlive.push(new MessageChannel());
        }
        if (!stop) setTimeout(spin, 0);
      };
      spin();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result).toEqual({ main: 20000, worker: expect.any(Number) });
  expect(result.worker).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
}, 60_000);
