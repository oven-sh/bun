// Two threads spawn at the same moment. Each spawns short-lived children, whose stdout it reads
// to EOF, next to long-lived ones, which exit only when their stdin is closed. Those stdins are
// closed only after every short-lived child's stdout reached EOF, so a stdout pipe end that also
// ended up in a long-lived child of the other thread hangs this script.
//
// argv[2]: "workers" (two Workers spawn) or "main" (the main thread and one Worker spawn).
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const PAIRS = 4;

function spawner(index: number) {
  const shortLived: Bun.Subprocess<"ignore", "pipe", "ignore">[] = [];
  const longLived: Bun.Subprocess<"pipe", "ignore", "ignore">[] = [];
  const spawnShort = () =>
    shortLived.push(
      Bun.spawn({ cmd: [process.execPath, "--revision"], stdin: "ignore", stdout: "pipe", stderr: "ignore" }),
    );
  const spawnLong = () =>
    longLived.push(
      Bun.spawn({
        cmd: [process.execPath, "-e", "process.stdin.resume()"],
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
  return {
    spawn(): Promise<string[]> {
      for (let pair = 0; pair < PAIRS; pair++) {
        // The threads alternate the order, so that one creates a short-lived child's pipe while
        // the other creates a long-lived child.
        if ((index + pair) % 2 === 0) (spawnShort(), spawnLong());
        else (spawnLong(), spawnShort());
      }
      return Promise.all(shortLived.map(child => child.stdout.text()));
    },
    async release() {
      for (const child of longLived) child.stdin.end();
      await Promise.all(longLived.map(child => child.exited));
    },
  };
}

if (isMainThread) {
  const workerCount = process.argv[2] === "main" ? 1 : 2;
  const workers = Array.from(
    { length: workerCount },
    (_, index) => new Worker(import.meta.path, { workerData: { index } }),
  );
  const local = workerCount === 1 ? spawner(1) : undefined;
  const next = (worker: Worker, type: string) =>
    new Promise<any>((resolve, reject) => {
      const onMessage = (message: any) => {
        if (message.type !== type) return;
        worker.off("message", onMessage);
        resolve(message);
      };
      worker.on("message", onMessage);
      worker.once("error", reject);
    });

  await Promise.all(workers.map(worker => next(worker, "ready")));
  const eof = workers.map(worker => next(worker, "eof").then(message => message.stdout as string[]));
  for (const worker of workers) worker.postMessage("spawn");
  if (local) eof.push(local.spawn());
  const stdout = await Promise.all(eof);
  const exited = workers.map(worker => next(worker, "exited"));
  for (const worker of workers) worker.postMessage("release");
  await Promise.all([...exited, local?.release()]);
  console.log(JSON.stringify(stdout));
  await Promise.all(workers.map(worker => worker.terminate()));
} else {
  const self = spawner((workerData as { index: number }).index);
  parentPort!.on("message", async (message: "spawn" | "release") => {
    if (message === "spawn") {
      parentPort!.postMessage({ type: "eof", stdout: await self.spawn() });
    } else {
      await self.release();
      parentPort!.postMessage({ type: "exited" });
    }
  });
  parentPort!.postMessage({ type: "ready" });
}
