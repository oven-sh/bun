// One scenario per process: what the collector counts of a child's output that nobody has read, at each object
// that holds it. Prints one line of JSON.
import { edenGC, estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { writeFileSync } from "node:fs";

type Output = "stdout" | "stderr";
const scenario = process.argv[2];
const output = process.argv[3] as Output;
const size = Number(process.argv[4]);

/** The bytes JSC counts beside its own cells: what its pacing sees of native memory. */
const counted = () => heapStats().extraMemorySize;
const fullGC = () => Bun.gc(true);

const writes = (to: Output[]) => to.map(name => `process.${name}.write(Buffer.alloc(${size}, 120));`).join(" ");
const piped = (to: Output[]) =>
  ({
    stdout: to.includes("stdout") ? "pipe" : "ignore",
    stderr: to.includes("stderr") ? "pipe" : "ignore",
  }) as const;

/** Writes `size` bytes to each of `to` once its stdin has data, so the scenario chooses when the output arrives. */
function spawnWriter(to: Output[] = [output]) {
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", `process.stdin.once("data", () => { ${writes(to)} });`],
    env: process.env,
    stdin: "pipe",
    ...piped(to),
  });
  // Read now, while the Subprocess is new: a store into an old object has JSC visit it again.
  const { stdin, exited } = proc;
  return { proc, stdin, exited };
}

async function writeAndExit({ stdin, exited }: Pick<ReturnType<typeof spawnWriter>, "stdin" | "exited">) {
  stdin.write("go");
  await stdin.end();
  await exited;
}

/** The pipe can end after the exit is reported, so a count is polled for. */
async function until(condition: () => boolean, collect = () => {}) {
  const deadline = performance.now() + 3000;
  while (!condition() && performance.now() < deadline) {
    await Bun.sleep(10);
    collect();
  }
}

/** The reader's buffer doubles: it has room for all of the output once more than half has arrived. */
async function mostHasArrived(proc: Bun.Subprocess) {
  while (estimateShallowMemoryUsageOf(proc) < size) await Bun.sleep(10);
}

async function readAll(stream: ReadableStream) {
  return (await new Response(stream).arrayBuffer()).byteLength;
}

const scenarios: Record<string, () => Promise<object>> = {
  // Nothing touches the output: the Subprocess holds it.
  async never() {
    const writer = spawnWriter();
    fullGC();
    const base = counted();
    await writeAndExit(writer);
    await until(() => counted() - base >= size, fullGC);
    // A full collection counts again from nothing: this is what the Subprocess answers when it is marked.
    fullGC();
    return { held: counted() - base, pid: writer.proc.pid };
  },

  // The Subprocess is old when its output ends, and an eden collection does not visit an old object again: the
  // count comes from the report that names the Subprocess as the owner of the bytes.
  async owner() {
    const writer = spawnWriter();
    fullGC();
    const base = counted();
    await writeAndExit(writer);
    await until(() => counted() - base >= size, edenGC);
    return { held: counted() - base, pid: writer.proc.pid };
  },

  // As `owner`, but the script stores into the old Subprocess before its output ends: the first read of `exited`
  // keeps the promise there, as `proc.kill(); await proc.exited` does. JSC visits such an object again, without
  // counting what it owns.
  async lateExited() {
    const proc = Bun.spawn({
      cmd: [process.execPath, "-e", `process.stdin.once("data", () => { ${writes([output])} });`],
      env: process.env,
      stdin: "pipe",
      ...piped([output]),
    });
    const stdin = proc.stdin;
    fullGC();
    const base = counted();
    await writeAndExit({ stdin, exited: proc.exited });
    await until(() => counted() - base >= size, edenGC);
    return { held: counted() - base, pid: proc.pid };
  },

  // The same store, made by `await using` when it ends a child that still runs.
  async lateDispose() {
    let base = 0;
    let kept: Bun.Subprocess;
    {
      await using proc = Bun.spawn({
        cmd: [process.execPath, "-e", `${writes([output])} setInterval(() => {}, 1000);`],
        env: process.env,
        stdin: "ignore",
        ...piped([output]),
      });
      kept = proc;
      await mostHasArrived(proc);
      fullGC();
      base = counted();
    }
    await until(() => counted() - base >= size / 2, edenGC);
    return { held: counted() - base, pid: kept.pid };
  },

  // Both outputs end unread: one report, of their sum.
  async both() {
    const writer = spawnWriter(["stdout", "stderr"]);
    fullGC();
    const base = counted();
    await writeAndExit(writer);
    await until(() => counted() - base >= 2 * size, edenGC);
    const held = counted() - base;
    fullGC();
    return { held, afterFullGC: counted() - base, pid: writer.proc.pid };
  },

  // The output has arrived and its pipe is still open. The pipe keeps the Subprocess alive, so no collection could
  // free the bytes, and they are not counted yet.
  async inFlight() {
    const writer = spawnWriter();
    fullGC();
    const base = counted();
    writer.stdin.write("go");
    await writer.stdin.flush();
    await mostHasArrived(writer.proc);
    const held = counted() - base;
    fullGC();
    const afterFullGC = counted() - base;
    await writer.stdin.end();
    await writer.exited;
    return { held, afterFullGC };
  },

  // The script reads the output when it hears of the exit, as most do. Nothing was parked for a collection to
  // free, so nothing is reported: the bytes count once, as the array that holds them.
  async readAtExit() {
    const writer = spawnWriter();
    fullGC();
    const base = counted();
    await writeAndExit(writer);
    const bytes = await writer.proc[output].bytes();
    return { held: counted() - base, read: bytes.byteLength };
  },

  // The output is read as a property while the child runs, and nothing reads the stream until later. Its source
  // is old when the output ends, as the Subprocess is in `owner`.
  async touchEarly() {
    const writer = spawnWriter();
    const stream = writer.proc[output];
    fullGC();
    const base = counted();
    await writeAndExit(writer);
    await until(() => counted() - base >= size, edenGC);
    const held = counted() - base;
    const read = await readAll(stream);
    await until(() => counted() - base < size / 2, fullGC);
    return { held, read, afterRead: counted() - base };
  },

  // The output is read as a property after it ended, and nothing reads the stream until later.
  async touchLate() {
    const writer = spawnWriter();
    fullGC();
    const base = counted();
    await writeAndExit(writer);
    await until(() => counted() - base >= size, fullGC);
    const stream = writer.proc[output];
    fullGC();
    const held = counted() - base;
    const read = await readAll(stream);
    await until(() => counted() - base < size / 2, fullGC);
    return { held, read, afterRead: counted() - base };
  },

  // The child has an IPC channel, which can close after the exit is reported.
  async ipc() {
    const proc = Bun.spawn({
      cmd: [process.execPath, "-e", `process.stdin.once("data", () => { ${writes([output])} process.disconnect(); });`],
      env: process.env,
      stdin: "pipe",
      ipc() {},
      ...piped([output]),
    });
    const { stdin, exited } = proc;
    fullGC();
    const base = counted();
    await writeAndExit({ stdin, exited });
    await until(() => counted() - base >= size, edenGC);
    return { held: counted() - base, pid: proc.pid };
  },

  // The child exits while a grandchild still holds the pipe, and the grandchild writes the output afterwards:
  // the pipe ends when the script has long heard of the exit.
  async lateEof() {
    const marker = process.env.LATE_EOF_MARKER!;
    const stdio = JSON.stringify([
      "ignore",
      output === "stdout" ? "inherit" : "ignore",
      output === "stderr" ? "inherit" : "ignore",
    ]);
    const grandchild = `const fs = require("fs"); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(marker)})) { clearInterval(timer); ${writes([output])} } }, 5);`;
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: ${stdio}, detached: true }).unref();`,
      ],
      env: process.env,
      stdin: "ignore",
      ...piped([output]),
    });
    await proc.exited;
    fullGC();
    const base = counted();
    writeFileSync(marker, "");
    await until(() => counted() - base >= size, edenGC);
    return { held: counted() - base, pid: proc.pid };
  },

  // Nothing forces a collection here. The reports make JSC collect by itself, and that frees a Subprocess which
  // the script has dropped.
  async loop() {
    let collected = 0;
    const registry = new FinalizationRegistry(() => {
      collected++;
    });
    const spawns = Array.from({ length: 6 }, async () => {
      const writer = spawnWriter();
      registry.register(writer.proc, undefined);
      await writeAndExit(writer);
    });
    await Promise.all(spawns);
    await until(() => collected > 0);
    return { collected: collected > 0 };
  },

  // `spawnSync` returns the output as a Buffer, which JSC counts by itself.
  async sync() {
    fullGC();
    const base = counted();
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", writes([output])],
      env: process.env,
      ...piped([output]),
    });
    fullGC();
    return { held: counted() - base, read: result[output]!.byteLength };
  },

  // A Blob counts its own bytes, so the source of its stream does not.
  async blob() {
    const blob = new Blob([Buffer.alloc(size, 120)]);
    fullGC();
    const base = counted();
    const stream = blob.stream();
    fullGC();
    return { held: counted() - base, locked: stream.locked, size: blob.size };
  },
};

console.log(JSON.stringify(await scenarios[scenario]()));
