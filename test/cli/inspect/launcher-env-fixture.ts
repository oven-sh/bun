// Launched with BUN_INSPECT (and BUN_INSPECT_NOTIFY) set, the way a debugger
// frontend launches the program it wants to debug. Reports whether those
// variables are still visible to the program itself, to a worker it starts, and
// to bun processes it spawns through node:child_process and Bun.spawn.
import { spawnSync } from "node:child_process";

const KEYS = ["BUN_INSPECT", "BUN_INSPECT_NOTIFY", "BUN_INSPECT_CONNECT_TO"];
const visible = () => Object.fromEntries(KEYS.map(key => [key, process.env[key] ?? null]));

if (!Bun.isMainThread) {
  postMessage(visible());
} else {
  const grandchildArgs = [
    "-e",
    `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(KEYS)}.map(key => [key, process.env[key] ?? null]))))`,
  ];

  function report(exitCode: number | null, stdout: string, stderr: string) {
    return exitCode === 0 ? { exitCode, env: JSON.parse(stdout) } : { exitCode, stderr: stderr.split("\n", 1)[0] };
  }

  const worker = new Worker(import.meta.url);
  const fromWorker = await new Promise((resolve, reject) => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => reject(event.error ?? new Error(event.message));
  });
  worker.terminate();

  // No `env` option on either call: each child gets whatever this process hands
  // to children by default.
  const viaChildProcess = spawnSync(process.execPath, grandchildArgs, { encoding: "utf8", timeout: 30_000 });
  const viaBunSpawn = Bun.spawnSync({ cmd: [process.execPath, ...grandchildArgs], timeout: 30_000 });

  await Bun.write(
    Bun.stdout,
    JSON.stringify({
      self: visible(),
      worker: fromWorker,
      "node:child_process": report(viaChildProcess.status, viaChildProcess.stdout, viaChildProcess.stderr),
      "Bun.spawn": report(viaBunSpawn.exitCode, viaBunSpawn.stdout.toString(), viaBunSpawn.stderr.toString()),
    }) + "\n",
  );
  // An attached frontend keeps the event loop alive, so end explicitly.
  process.exit(0);
}
