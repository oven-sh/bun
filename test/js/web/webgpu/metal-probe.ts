// Temporary: measures when Metal fails to compile a valid pipeline.
import { test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { hostname, release } from "node:os";

const common = `
  const device = await (await navigator.gpu.requestAdapter()).requestDevice();
  const seedOf = n => (process.env.UNIQUE ? (process.pid * 8 + n + Number(process.env.UNIQUE)) % 2 ** 31 : n);
  const compile = n => device.createComputePipelineAsync({ layout: "auto", compute: { module: device.createShaderModule({ code: \`
    @group(0) @binding(0) var<storage, read_write> out: array<u32, 64>;
    @compute @workgroup_size(64) fn main(@builtin(local_invocation_index) index: u32) {
      var x = index + \${seedOf(n)};
      for (var i = 0; i < 10000; i++) { x = x * 1664525 + 1013904223; }
      out[index] = x;
    }\` }) } });`;
const files = {
  "probe.js": `${common}
    const attempt = () => compile(0).then(() => "ok", error => error.message.split("\\n")[0]);
    const first = await attempt();
    console.log(first === "ok" ? first : first + ", then " + (await attempt()) + ", then " + (await attempt()));`,
  "info.js": `${common}
    const { vendor, architecture, device: name, description } = device.adapterInfo;
    console.log(vendor, architecture, name, description);`,
  "exits.js": `${common}
    for (const n of [0, 1, 2]) compile(n).catch(() => {});
    process.exit(0);`,
  "terminates.js": `
    const worker = new Worker("./worker.js");
    worker.onmessage = () => worker.terminate();`,
  "worker.js": `${common}
    for (const n of [0, 1, 2]) compile(n).catch(() => {});
    postMessage("started");`,
};

export function probeMetal() {
  const unique = { UNIQUE: String(Date.now() % 1e9) };
  test.skipIf(!isMacOS && !process.env.PROBE).each([
    ["one at a time", 1, null, {}],
    ["8 at a time", 8, null, {}],
    ["8 at a time, unique", 8, null, unique],
    ["beside exits", 4, "exits.js", {}],
    ["beside exits, unique", 4, "exits.js", unique],
    ["beside exits, no cache", 4, "exits.js", { MTL_SHADER_CACHE_SIZE: "0" }],
    ["beside terminates", 4, "terminates.js", {}],
    ["beside terminates, unique", 4, "terminates.js", unique],
  ] as const)(
    "%s",
    async (title, lanes, neighbor, env) => {
      using dir = tempDir("metal-probe", files);
      const run = async (file: string) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), file],
          cwd: String(dir),
          env: { ...bunEnv, ...env },
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return `${stdout.trim()}${exitCode ? ` exit ${exitCode} ${proc.signalCode} ${stderr.slice(0, 200)}` : ""}`;
      };
      const counts: Record<string, number> = {};
      const end = performance.now() + 9000;
      const lane = async (file: string) => {
        while (performance.now() < end) {
          const key = `${file}: ${await run(file)}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      };
      await Promise.all([
        ...Array.from({ length: lanes }, () => lane("probe.js")),
        ...(neighbor ? Array.from({ length: 4 }, () => lane(neighbor)) : []),
      ]);
      console.log("PROBE", hostname(), release(), await run("info.js"), "|", title, JSON.stringify(counts));
    },
    60_000,
  );
}
