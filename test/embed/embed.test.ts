// libbun — Bun hosted in another program through the C API in
// packages/bun-embed/bun_embed.h. The library is a separate build target
// (`bun run build --target=libbun`, macOS only for now) that lands next to the
// executable; without it these tests skip.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isMacOS, tempDir } from "harness";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const libbun = join(dirname(bunExe()), "libbun.dylib");
const cc = Bun.which("cc") || Bun.which("clang");
const canRun = isMacOS && existsSync(libbun) && !!cc;

// An ASAN libbun needs the sanitizer runtime (and the dyld shim next to the
// library) loaded before it is dlopen'd, so the host links them as dependents.
function asanLinkFlags(): string[] {
  if (!isASAN) return [];
  const otool = Bun.spawnSync({ cmd: ["otool", "-L", libbun], stdout: "pipe" }).stdout.toString();
  const deps = otool
    .split("\n")
    .slice(1)
    .map(l => l.trim().split(" ")[0])
    .filter(d => d.includes("libclang_rt.asan") || d.includes("asan-dyld-shim"))
    .map(d => d.replace("@rpath", dirname(libbun)));
  return [...deps, ...deps.map(d => `-Wl,-rpath,${dirname(d)}`)];
}

let hostExe: string | undefined;
function host(): string {
  if (hostExe) return hostExe;
  const dir = tempDir("bun-embed-host", {});
  hostExe = join(String(dir), "host");
  const build = Bun.spawnSync({
    cmd: [cc!, join(import.meta.dir, "host.c"), "-o", hostExe, ...asanLinkFlags()],
    env: bunEnv,
    stderr: "pipe",
  });
  if (build.exitCode !== 0) throw new Error(`building host.c failed:\n${build.stderr}`);
  return hostExe;
}

async function runHost(mode: string, bunArgs: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [host(), libbun, mode, "bun", ...bunArgs],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!canRun)("bun_embed_run", () => {
  test("returns process.exit()'s code and the host keeps running", async () => {
    const { stdout, exitCode } = await runHost("run", [
      "-e",
      `process.on("exit", c => console.log("exit listener", c)); console.log("env", process.env.BUN_EMBED_TEST_VAR); process.exit(3);`,
    ]);
    expect(stdout).toBe(
      `version=${Bun.version}\nenv from-envp\nexit listener 3\non_exit=3 user=u\nexit=3\nhost alive\n`,
    );
    expect(exitCode).toBe(0);
  });

  test("returns 0 when the event loop drains, 1 on an uncaught error", async () => {
    const drained = await runHost("run", ["-e", `setTimeout(() => console.log("done"), 5)`]);
    expect(drained.stdout).toBe(`version=${Bun.version}\ndone\non_exit=0 user=u\nexit=0\nhost alive\n`);
    expect(drained.exitCode).toBe(0);

    const threw = await runHost("run", ["-e", `throw new Error("boom")`]);
    expect(threw.stderr).toContain("boom");
    expect(threw.stdout).toBe(`version=${Bun.version}\non_exit=1 user=u\nexit=1\nhost alive\n`);
    expect(threw.exitCode).toBe(0);
  });

  test("bun_embed_request_exit stops a server from another thread", async () => {
    using dir = tempDir("bun-embed-serve", {
      "serve.ts": `
        const server = Bun.serve({ port: 0, fetch: () => new Response("hello from embedded bun") });
        process.on("exit", c => console.log("exit listener", c));
        await Bun.write(process.env.READY_FILE!, String(server.port));
      `,
    });
    const READY_FILE = join(String(dir), "ready");
    const STOP_FILE = join(String(dir), "stop");
    const running = runHost("serve", [join(String(dir), "serve.ts")], { READY_FILE, STOP_FILE });

    // The script writes its port once the server is listening.
    let port = "";
    while (!port) {
      port = existsSync(READY_FILE) ? await Bun.file(READY_FILE).text() : "";
      if (!port) await Bun.sleep(10);
    }
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("hello from embedded bun");

    await Bun.write(STOP_FILE, "");
    const { stdout, exitCode } = await running;
    expect(stdout).toBe(`version=${Bun.version}\nexit listener 7\non_exit=7 user=u\nexit=7\nhost alive\n`);
    expect(exitCode).toBe(0);
    // The runtime was torn down: nothing listens any more.
    expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  test("a second run in the same process is refused", async () => {
    const { stdout, exitCode } = await runHost("twice", ["-e", `process.exit(3)`]);
    expect(stdout).toBe(`version=${Bun.version}\nfirst=3 second=-1\n`);
    expect(exitCode).toBe(0);
  });

  test("a command that exits without an event loop reports through on_exit", async () => {
    const { stdout, exitCode } = await runHost("park", ["--version"]);
    expect(stdout).toBe(`version=${Bun.version}\n${Bun.version}\non_exit=0 user=u\nhost alive\n`);
    expect(exitCode).toBe(0);
  });
});
