// Temporary: measures when Metal fails a command buffer.
import { test } from "bun:test";
import { bunExe, isArm64, isMacOS } from "harness";
import { cpus, freemem, hostname, release, totalmem } from "node:os";
import { join } from "node:path";
import { bunEnv, run } from "./subprocess";

const isVirtual = (await navigator.gpu.requestAdapter())?.info.device.includes("paravirtual");

const watch = `
  const watched = async () => {
    const device = await requestDevice();
    device.onuncapturederror = event => (event.preventDefault(), console.log("error", event.error.message.split("\\n")[0]));
    return device;
  };
  async function use(device, workgroups) {
    const start = performance.now();
    try {
      await keepBusy(device, workgroups).mapAsync(GPUMapMode.READ);
    } catch (error) {
      const ms = performance.now() - start;
      console.log(error.name, ms < 100 ? "<100ms" : ms < 1000 ? "<1s" : ">1s", (await device.lost).message.split("\\n")[0]);
      process.exit(0);
    }
  }`;
const victims = {
  fresh: `${watch}
    for (let i = 0; i < 4; i++) await use(await watched(), 100);
    console.log("ok");`,
  steady: `${watch}
    const device = await watched();
    for (const end = performance.now() + 500; performance.now() < end; ) await use(device, 1000);
    console.log("ok");`,
};

const clear = `
  const device = await requestDevice();
  const buffers = Array.from({ length: 8 }, () => device.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.COPY_DST }));
  const clear = () => device.queue.submit(buffers.map(buffer => {
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(buffer);
    return encoder.finish();
  }));`;
const upload = `
  const device = await requestDevice();
  const texture = device.createTexture({ size: [1024, 1024], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST });
  const upload = () => device.queue.writeTexture({ texture }, new Uint8Array(4 << 20), { bytesPerRow: 4096 }, [1024, 1024]);`;
const done = "await device.queue.onSubmittedWorkDone();";
const neighbors = {
  "exits idle": `await requestDevice(); process.exit(0);`,
  "exits with a dispatch under way": `keepBusy(await requestDevice(), 5000); process.exit(0);`,
  "exits 2 ms into a dispatch": `keepBusy(await requestDevice(), 20000); Bun.sleepSync(2); process.exit(0);`,
  "is killed with a dispatch under way": `keepBusy(await requestDevice(), 5000); process.kill(process.pid, "SIGKILL");`,
  "exits after an empty submit": `(await requestDevice()).queue.submit([]); process.exit(0);`,
  "exits with a first clear under way": `${clear} clear(); process.exit(0);`,
  "ends 1 ms into a second clear": `${clear} clear(); ${done} clear(); await Bun.sleep(1);`,
  "waits for clears": `${clear} clear(); ${done} clear(); ${done}`,
  "destroys buffers with a clear under way": `${clear} clear(); for (const it of buffers) it.destroy(); ${done}`,
  "destroys a device with a clear under way": `${clear} clear(); device.destroy();`,
  "destroys a device with a dispatch under way": `const device = await requestDevice(); keepBusy(device, 5000); device.destroy();`,
  "exits with an upload recorded": `${upload} upload(); process.exit(0);`,
  "exits with uploads under way": `${upload} for (let i = 0; i < 4; i++) upload(); device.queue.submit([]); process.exit(0);`,
  "waits for uploads": `${upload} for (let i = 0; i < 8; i++) upload(); device.queue.submit([]); ${done}`,
  "waits for a long dispatch": `await keepBusy(await requestDevice(), 65535).mapAsync(GPUMapMode.READ);`,
  "waits for 24 devices": `
    const devices = await Promise.all(Array.from({ length: 24 }, requestDevice));
    await Promise.all(devices.map(device => keepBusy(device).mapAsync(GPUMapMode.READ)));`,
  "exits right after a compile": `prepare(await requestDevice()); process.exit(0);`,
};
const groups = [
  "with or without a driver",
  "the process (ends while a device|waits for|prints|stops|reports)",
  "sleeps while it waits|does not wait for what was submitted later",
  "sleeps once|does not miss|sleeps through",
  "destroys a device even if",
  "ends though a listener",
  "sleeps under --hot",
  "gets back the memory of (buffers|textures|small)",
  "gets back the memory of (3|4|what|uploads)",
  "the garbage collector (leaves|does not make)",
  "the garbage collector collects",
  "knows how much",
  "a worker has a GPU",
  "a worker (is terminated|calls|throws|runs)",
  "what can compile",
  "other contexts",
  "ends while a pipeline compiles",
];

async function runScript(script: string) {
  const { stdout, stderr, exitCode } = await run({ "index.js": script });
  return stdout.trim().replaceAll("\n", " / ") + (exitCode === 1 ? ` exit 1 ${stderr.slice(0, 160)}` : "");
}

async function runTests(...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=30000", join(import.meta.dir, "webgpu-lifetime.test.ts"), ...args],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const lines = (await proc.stderr.text()).split("\n");
  const failures = lines.filter(line => /^(\(fail\)|✗) |^\+.*(Metal|nternal error|Error:)/.test(line));
  return failures.map(line => line.slice(0, 150)).join(" / ") || "pass";
}

async function probe(title: string, milliseconds: number, lanes: [string, number, () => Promise<string>][]) {
  const counts: Record<string, number> = {};
  const end = performance.now() + milliseconds;
  await Promise.all(
    lanes.flatMap(([name, count, action]) =>
      Array.from({ length: count }, async () => {
        while (performance.now() < end) {
          const key = `${name}: ${await action()}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }),
    ),
  );
  console.log("PROBE", hostname(), new Date().toISOString().slice(11, 19), "|", title, JSON.stringify(counts));
}

const victimLanes = (count: number) =>
  Object.entries(victims).map(([name, script]) => [name, count, () => runScript(script)]) as Parameters<
    typeof probe
  >[2];

export function probeMetal(part: "tests" | "groups" | "neighbors") {
  const it = test.skipIf(!(isMacOS && isArm64) && !process.env.PROBE);
  const scale = Number(process.env.PROBE ?? (isVirtual ? 1 : 0.4));

  it("machine", async () => {
    const info = await runScript(`const { device, description } = (await requestDevice()).adapterInfo; console.log(device, description);`);
    console.log("PROBE", hostname(), release(), cpus().length, cpus()[0].model, totalmem() / 2 ** 30, freemem() / 2 ** 30, info);
  });

  if (part === "tests") {
    it("the file", () => probe("the file", 40_000 * scale, [["tests", 1, runTests]]), 90_000);
    it.each(["gets back the memory", "a worker", "what can compile", "beforeExit"])(
      "without %s",
      name => probe("without " + name, 20_000 * scale, [["tests", 1, () => runTests("-t", `^(?!.*${name})`)]]),
      90_000,
    );
  } else if (part === "groups") {
    it.each(groups)(
      "%s",
      name => probe(name, 7000 * scale, [...victimLanes(2), ["tests", 1, () => runTests("-t", name)]]),
      60_000,
    );
  } else {
    it.each([1, 10])("%d", count => probe(count + " of each", 6500 * scale, victimLanes(count)), 60_000);
    it.each(Object.entries(neighbors))(
      "%s",
      (name, script) => probe(name, 6500 * scale, [...victimLanes(2), ["neighbor", 3, () => runScript(script)]]),
      60_000,
    );
  }

  test.skipIf(!(isMacOS && isArm64))(
    "log",
    async () => {
      const predicate = `(sender CONTAINS[c] "paravirt" OR sender CONTAINS "IOGPU" OR sender == "Metal" OR sender CONTAINS "AGX") AND messageType IN {16, 17}`;
      await using proc = Bun.spawn({
        cmd: ["/usr/bin/log", "show", "--style", "compact", "--last", "3m", "--predicate", predicate],
        timeout: 20_000,
      });
      const counts: Record<string, number> = {};
      for (const line of (await proc.stdout.text()).split("\n")) {
        const key = line.slice(24, 220).replaceAll(/\[\d+:[0-9a-f]+\]|0x[0-9a-f]+/g, "#");
        counts[key] = (counts[key] ?? 0) + 1;
      }
      for (const [line, count] of Object.entries(counts).slice(0, 25)) console.log("PROBE LOG", count, line);
    },
    30_000,
  );
}
