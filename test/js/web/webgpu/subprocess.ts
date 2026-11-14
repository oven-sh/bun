import { bunExe, bunEnv as defaultEnv, isASAN, tempDir } from "harness";

// As in CI. With ASAN the process ends in exit(), which runs the destructors of a driver whose threads may be at work.
export const bunEnv = isASAN ? { ...defaultEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" } : defaultEnv;
// The timer and the finalizers would wake an event loop that has missed something.
export const withoutGCTimer = { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" };
export const withoutGC = { ...withoutGCTimer, BUN_JSC_useGC: "0" };

const helpers = `
  import { readdirSync, readFileSync } from "node:fs";
  /** On Linux, the devices that have waited for the GPU and are not destroyed. */
  export const countWatchers = () => readdirSync("/proc/self/task").filter(thread => {
    try { return readFileSync(\`/proc/self/task/\${thread}/comm\`, "utf8") === "GPUQueue\\n"; } catch {}
  }).length;
  export const requestDevice = async () => (await navigator.gpu.requestAdapter()).requestDevice();
  export const slowModule = (device, seed, rounds = 10000) => device.createShaderModule({ code: \`
    @group(0) @binding(0) var<storage, read_write> out: array<u32, 64>;
    @compute @workgroup_size(64) fn main(@builtin(local_invocation_index) index: u32) {
      var x = index + \${seed};
      for (var i = 0; i < \${rounds}; i++) { x = x * 1664525 + 1013904223; }
      out[index] = x;
    }\` });
  export const compile = (device, seed) =>
    device.createComputePipelineAsync({ layout: "auto", compute: { module: slowModule(device, seed) } });
  /** Submits when it is called, and returns a buffer to map once the GPU is done. */
  export function prepare(device, workgroups = 100) {
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: slowModule(device, 0) } });
    const resource = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const result = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }] }));
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(resource, result);
    const commands = encoder.finish();
    return () => (device.queue.submit([commands]), result);
  }
  export const keepBusy = (device, workgroups) => prepare(device, workgroups)();
  /** One of each thing that can be under way. */
  export function startEverything(device) {
    device.onuncapturederror = event => event.preventDefault();
    device.createBuffer({ size: 4, usage: 0 });
    globalThis.range = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true }).getMappedRange();
    device.pushErrorScope("validation");
    return [
      keepBusy(device).mapAsync(GPUMapMode.READ),
      device.queue.onSubmittedWorkDone(),
      compile(device, 1),
      compile(device, 2),
      slowModule(device, 3).getCompilationInfo(),
      device.popErrorScope(),
      navigator.gpu.requestAdapter(),
    ];
  }`;
const imports = `import { compile, countWatchers, keepBusy, prepare, requestDevice, slowModule, startEverything } from "./helpers.js";\n`;

export async function run(files: Record<string, string>, args = ["index.js"], env = bunEnv) {
  using dir = tempDir("webgpu", {
    ...Object.fromEntries(Object.entries(files).map(([name, source]) => [name, imports + source])),
    "helpers.js": helpers,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
export const printed = (stdout: string) => ({ stdout: stdout + "\n", stderr: "", exitCode: 0 });

/** Two files for `require()`, which runs a macro on the thread and in the realm of the program. */
export const withMacro = (name: string, macro: string) => ({
  [`${name}.js`]: `
    import { macro } from "./${name}-macro.js" with { type: "macro" };
    console.log(macro());`,
  [`${name}-macro.js`]: `export const macro = ${macro};`,
});
// A debug build prints a line for each call of a macro.
export const withoutMacroLog = (stdout: string) => stdout.replaceAll("[macro] call macro\n", "");

// Each upload fills a staging buffer. Dawn submits after four, and takes back those that the GPU is done with.
export const uploads = `
  const pixels = new Uint8Array(4 << 20);
  function prepareUploads(device) {
    const texture = device.createTexture({ size: [1024, 1024], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST });
    const upload = count => {
      while (count--) device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 4096 }, [1024, 1024]);
    };
    upload(1);
    device.queue.submit([]);
    return upload;
  }`;
