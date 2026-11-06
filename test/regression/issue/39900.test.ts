import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/39900
// A macro that awaits crypto.subtle.digest() hung forever.

const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(4096))).toString("base64url");

const files = {
  "macro.ts": `export async function sha() {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(4096));
  return Buffer.from(digest).toString("base64url");
}
`,
  "index.ts": `import { sha } from "./macro.ts" with { type: "macro" };
console.log(sha());
`,
};

test.concurrent("macro that awaits crypto.subtle.digest resolves under bun run", async () => {
  using dir = tempDir("39900-run", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // A debug build also logs "[macro] call sha" to stdout.
  expect(stdout).toContain(`${expected}\n`);
  expect(exitCode).toBe(0);
});

// The keep-alive the WebCrypto work queue releases from the pool thread must
// land on a loop that still ticks once the macro returned, or the process
// never exits.
test.concurrent("macro that starts crypto.subtle.digest without awaiting still exits", async () => {
  using dir = tempDir("39900-unawaited", {
    "macro.ts": `export function start() {
  crypto.subtle.digest("SHA-256", new Uint8Array(4096)).then(() => console.log("settled"));
  return 1;
}
`,
    "index.ts": `import { start } from "./macro.ts" with { type: "macro" };
console.log(start());
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("1\n");
  expect(stdout).toContain("settled\n");
  expect(exitCode).toBe(0);
});

test.concurrent("macro that awaits crypto.subtle.digest resolves under Bun.build", async () => {
  using dir = tempDir("39900-build", {
    ...files,
    "build.ts": `const result = await Bun.build({ entrypoints: ["./index.ts"] });
if (!result.success) throw new AggregateError(result.logs);
console.log(await result.outputs[0].text());
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain(expected);
  expect(exitCode).toBe(0);
});

// Same wait, other producers whose completion was posted without regard to
// the loop the macro was waiting on (JSC's DeferredWorkTimer, WebCore's
// postTaskTo from the same or another thread): each hung the same way.
const producers = {
  "crypto.subtle.digest of under 64 bytes": `const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(16));
  return "ok " + digest.byteLength;`,
  "WebAssembly.instantiate": `const { instance } = await WebAssembly.instantiate(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  return "ok " + typeof instance.exports;`,
  "Atomics.waitAsync": `const { value } = Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  return "ok " + (await value);`,
  "crypto.subtle.sign": `const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "ok " + (await crypto.subtle.sign("HMAC", key, new Uint8Array(8))).byteLength;`,
  MessageChannel: `const { port1, port2 } = new MessageChannel();
  const data = await new Promise(resolve => {
    port2.onmessage = e => resolve(e.data);
    port1.postMessage("ok channel");
  });
  port1.close();
  port2.close();
  return data;`,
  BroadcastChannel: `const a = new BroadcastChannel("39900"), b = new BroadcastChannel("39900");
  const data = await new Promise(resolve => {
    b.onmessage = e => resolve(e.data);
    a.postMessage("ok broadcast");
  });
  a.close();
  b.close();
  return data;`,
  Worker: `const worker = new Worker(new URL("./worker.js", import.meta.url).href);
  const data = await new Promise((resolve, reject) => {
    worker.onmessage = e => resolve(e.data);
    worker.onerror = reject;
  });
  await worker.terminate();
  return data;`,
  "a MessagePort transferred to a Worker": `const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL("./port-worker.js", import.meta.url).href);
  worker.postMessage(port2, [port2]);
  const data = await new Promise((resolve, reject) => {
    port1.onmessage = e => resolve(e.data);
    worker.onerror = reject;
  });
  port1.close();
  await worker.terminate();
  return data;`,
  "a BroadcastChannel message from a Worker": `const channel = new BroadcastChannel("39900-worker");
  const received = new Promise(resolve => (channel.onmessage = e => resolve(e.data)));
  const worker = new Worker(new URL("./broadcast-worker.js", import.meta.url).href);
  const data = await received;
  channel.close();
  await worker.terminate();
  return data;`,
};

for (const [name, body] of Object.entries(producers)) {
  test.concurrent(`macro that awaits ${name} resolves`, async () => {
    using dir = tempDir("39900-producer", {
      "macro.ts": `export async function value() {\n  ${body}\n}\n`,
      "worker.js": `postMessage("ok worker");`,
      "port-worker.js": `onmessage = e => e.data.postMessage("ok port");`,
      "broadcast-worker.js": `const channel = new BroadcastChannel("39900-worker");
channel.postMessage("ok broadcast worker");
channel.close();`,
      "index.ts": `import { value } from "./macro.ts" with { type: "macro" };
console.log(JSON.stringify(value()));
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^"ok .*"$/m);
    expect(exitCode).toBe(0);
  });
}
