// TEMPORARY measurement, not a test of bun. It is removed before this PR leaves draft.
//
// It prints, for the machine it runs on, how long the loopback needs to deliver a byte and a
// close, and how many setImmediate turns a streamed Bun.serve response runs before the server
// sees a client abort. Every line starts with LOOPBACK_PROBE and is JSON.
import { dlopen, ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, isMusl } from "harness";
import net from "node:net";
import os from "node:os";

const later = () => new Promise<void>(r => setImmediate(r));
const micros = () => Bun.nanoseconds() / 1e3;
const report = (label: string, data: unknown) => console.log("LOOPBACK_PROBE " + JSON.stringify({ label, data }));

function summary(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10;
  return { n: sorted.length, min: at(0), p50: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) };
}

// Raw sockets through libc, no event loop: after write(2) or close(2) returns on one end of a
// loopback TCP connection, spin on poll(2) with a zero timeout until the other end reports it.
function kernelHops(iterations: number) {
  const libc = dlopen(isMacOS ? "libSystem.B.dylib" : "libc.so.6", {
    socket: { args: ["int", "int", "int"], returns: "int" },
    bind: { args: ["int", "ptr", "int"], returns: "int" },
    listen: { args: ["int", "int"], returns: "int" },
    getsockname: { args: ["int", "ptr", "ptr"], returns: "int" },
    connect: { args: ["int", "ptr", "int"], returns: "int" },
    accept: { args: ["int", "ptr", "ptr"], returns: "int" },
    write: { args: ["int", "ptr", "u64"], returns: "i64" },
    read: { args: ["int", "ptr", "u64"], returns: "i64" },
    close: { args: ["int"], returns: "int" },
    poll: { args: ["ptr", "u64", "int"], returns: "int" },
  });
  const { socket, bind, listen, getsockname, connect, accept, write, read, close, poll } = libc.symbols;
  const AF_INET = 2;
  const SOCK_STREAM = 1;
  const POLLIN = 1;
  const addr = new Uint8Array(16);
  if (isMacOS) {
    addr[0] = 16;
    addr[1] = AF_INET;
  } else new DataView(addr.buffer).setUint16(0, AF_INET, true);
  addr.set([127, 0, 0, 1], 4);
  const listener = socket(AF_INET, SOCK_STREAM, 0);
  if (listener < 0 || bind(listener, ptr(addr), 16) !== 0 || listen(listener, 16) !== 0)
    throw new Error("listen failed");
  const len = new Uint32Array([16]);
  if (getsockname(listener, ptr(addr), ptr(len)) !== 0) throw new Error("getsockname failed");

  const pollfd = new Uint8Array(8);
  const pollView = new DataView(pollfd.buffer);
  const byte = new Uint8Array([120]);
  const sink = new Uint8Array(16);
  // Returns [microseconds, polls that found nothing] until `fd` is readable. 0 polls: it was there at once.
  const untilReadable = (fd: number): [number, number] => {
    pollView.setInt32(0, fd, true);
    pollView.setInt16(4, POLLIN, true);
    const start = micros();
    let empty = 0;
    while (poll(ptr(pollfd), 1, 0) <= 0) {
      empty++;
      if (micros() - start > 2_000_000) return [2_000_000, empty];
    }
    return [micros() - start, empty];
  };

  const data: number[] = [];
  const fin: number[] = [];
  const both: number[] = [];
  let dataLate = 0;
  let finLate = 0;
  try {
    for (let i = 0; i < iterations; i++) {
      const client = socket(AF_INET, SOCK_STREAM, 0);
      if (client < 0 || connect(client, ptr(addr), 16) !== 0) throw new Error("connect failed");
      const accepted = accept(listener, null, null);
      if (accepted < 0) throw new Error("accept failed");
      // The server writes, the client sees it.
      write(accepted, ptr(byte), 1);
      const [dataMicros, dataEmpty] = untilReadable(client);
      read(client, ptr(sink), 16);
      // The client closes, the server sees it.
      close(client);
      const [finMicros, finEmpty] = untilReadable(accepted);
      close(accepted);
      data.push(dataMicros);
      fin.push(finMicros);
      both.push(dataMicros + finMicros);
      if (dataEmpty) dataLate++;
      if (finEmpty) finLate++;
    }
  } finally {
    close(listener);
    libc.close();
  }
  return {
    unit: "microseconds after the syscall returned",
    data: summary(data),
    fin: summary(fin),
    dataPlusFin: summary(both),
    notThereAtFirstPoll: { data: dataLate, fin: finLate, of: iterations },
  };
}

// The client of the flaky test: read until `until`, then destroy.
async function abortAfter(port: number, until: string) {
  const sock = net.connect(port, "127.0.0.1");
  let raw = "";
  await new Promise<void>((resolve, reject) => {
    sock.on("connect", () => sock.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
    sock.on("data", d => {
      raw += d.toString("latin1");
      if (raw.includes(until)) resolve();
    });
    sock.on("error", reject);
    sock.on("close", () => resolve());
  });
  sock.destroy();
}

// The server of the flaky test with no bound on the rounds: how many `await later(); yield`
// rounds the generator runs before the server returns it, and how long that takes.
async function roundsUntilReturned(iterations: number) {
  const rounds: number[] = [];
  const roundsAtDestroy: number[] = [];
  const elapsed: number[] = [];
  let notReturned = 0;
  // On a slow machine, stop early and report what there is.
  const stopAt = Date.now() + 60_000;
  for (let i = 0; i < iterations && Date.now() < stopAt; i++) {
    const finished = Promise.withResolvers<void>();
    let count = 0;
    let start = 0;
    let end = 0;
    let completed = false;
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          (async function* () {
            try {
              start = micros();
              yield "first";
              const deadline = Date.now() + 3000;
              while (Date.now() < deadline) {
                await later();
                count++;
                yield "more";
              }
              completed = true;
            } finally {
              end = micros();
              finished.resolve();
            }
          })() as any,
        ),
    });
    await abortAfter(server.port!, "first");
    roundsAtDestroy.push(count);
    await finished.promise;
    if (completed) notReturned++;
    rounds.push(count);
    elapsed.push(end - start);
  }
  return {
    // Rounds run when the client destroyed its socket, and when the server returned the generator.
    roundsAtDestroy: summary(roundsAtDestroy),
    rounds: summary(rounds),
    // The test with the 50 round limit fails on each of these.
    over50: rounds.filter(r => r > 50).length,
    // The deadline of the new test ended the generator.
    notReturned,
    microseconds: summary(elapsed),
  };
}

// How long 50 rounds take when the client stays.
async function fiftyRounds(iterations: number) {
  const elapsed: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const finished = Promise.withResolvers<void>();
    let start = 0;
    let end = 0;
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          (async function* () {
            yield "first";
            start = micros();
            for (let round = 0; round < 50; round++) {
              await later();
              yield "more";
            }
            end = micros();
            finished.resolve();
          })() as any,
        ),
    });
    const sock = net.connect(server.port!, "127.0.0.1");
    sock.on("connect", () => sock.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
    sock.on("data", () => {});
    sock.on("error", () => {});
    await finished.promise;
    sock.destroy();
    elapsed.push(end - start);
  }
  return { microseconds: summary(elapsed) };
}

// Other processes that keep the CPUs and the loopback busy, like the parallel test batch does.
const busyNeighbor = `
  const body = Buffer.alloc(64 * 1024, "x");
  const server = Bun.serve({ port: 0, fetch: () => new Response(body) });
  console.log("ready");
  for (;;) await (await fetch(server.url)).arrayBuffer();
`;

async function withNeighbors<T>(count: number, run: () => Promise<T>): Promise<T> {
  const neighbors = Array.from({ length: count }, () =>
    Bun.spawn({ cmd: [bunExe(), "-e", busyNeighbor], env: bunEnv, stdout: "pipe", stderr: "ignore" }),
  );
  try {
    await Promise.all(neighbors.map(n => n.stdout.getReader().read()));
    return await run();
  } finally {
    for (const n of neighbors) n.kill("SIGKILL");
    await Promise.all(neighbors.map(n => n.exited));
  }
}

// macOS is the platform in question. Linux with glibc is the control.
test.skipIf(isASAN || !(isMacOS || (isLinux && !isMusl)))(
  "loopback abort latency probe (temporary)",
  async () => {
    const cpus = os.cpus().length;
    report("machine", {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpus,
      loadavg: os.loadavg(),
      version: Bun.version_with_sha,
    });
    const measure = async (phase: string, runs: number) => {
      for (const [label, run] of [
        ["kernel", () => kernelHops(1000)],
        ["fifty-rounds", () => fiftyRounds(60)],
        ["rounds-until-returned", () => roundsUntilReturned(runs)],
      ] as const) {
        // A measurement that fails must not fail the lane.
        try {
          report(phase + ":" + label, await run());
        } catch (e: any) {
          report(phase + ":" + label, { error: String(e?.message ?? e) });
        }
      }
    };
    await measure("idle", 300);
    try {
      await withNeighbors(Math.min(cpus, 12), () => measure("busy", 1500));
    } catch (e: any) {
      report("busy", { error: String(e?.message ?? e) });
    }
    expect(true).toBe(true);
  },
  240_000,
);
