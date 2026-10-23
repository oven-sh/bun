import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// The fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) executes
// fuzzer-generated scripts in-process. APIs that intentionally kill the
// process outside of normal exception handling must be stubbed out before the
// loop starts, otherwise every fuzz case reaching them is reported as a
// crash. process.execve is one of those: on success it replaces the process
// image, which would silently end the REPRL loop.
test("REPRL loop survives a payload that calls process.execve", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl-execve.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("STATUS_WRITES=2 LIVE=true");
  expect(exitCode).toBe(0);
});

declare const fuzzilli: unknown;
// `bun fuzzilli` is compiled in only with --fuzzilli=on (bun run build:debug:fuzzilli).
// The same flag adds a fuzzilli() global.
const isFuzzilliBuild = typeof fuzzilli === "function";

// Runs the programs in one `bun fuzzilli` child. Fuzzilli sends "exec" and a u64
// length on fd 100 and the source on fd 102. The child answers "HELO" and then
// one u32 status per program on fd 101. Regular files stand in for the pipes.
async function runReprl(programs: string[], env: Record<string, string | undefined>) {
  const sources = programs.map(source => Buffer.from(source, "utf8"));
  const control = [Buffer.from("HELO")];
  for (const source of sources) {
    const size = Buffer.alloc(8);
    size.writeBigUInt64LE(BigInt(source.length));
    control.push(Buffer.from("exec"), size);
  }
  using dir = tempDir("fuzzilli-reprl", {
    "control.bin": Buffer.concat(control),
    "programs.bin": Buffer.concat(sources),
    "status.bin": "",
  });
  const file = (name: string) => path.join(String(dir), name);

  const stdio: any[] = ["ignore", "pipe", "pipe"];
  stdio[100] = Bun.file(file("control.bin"));
  stdio[101] = Bun.file(file("status.bin"));
  stdio[102] = Bun.file(file("programs.bin"));

  await using proc = Bun.spawn({ cmd: [bunExe(), "fuzzilli"], env, cwd: String(dir), stdio });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const status = fs.readFileSync(file("status.bin"));
  const statuses: number[] = [];
  for (let offset = 4; offset + 4 <= status.length; offset += 4) {
    statuses.push(status.readUInt32LE(offset));
  }
  return {
    handshake: status.subarray(0, 4).toString("latin1"),
    statuses,
    stdout,
    // The fuzz build prints a [COV] and a [FUZZILLI] banner. Every other line is an error.
    stderr: stderr.split("\n").filter(line => line && !line.includes("[COV]") && !line.includes("[FUZZILLI]")),
    exitCode,
  };
}

// Fuzzilli picks string literals at random, so a fuzz program can ask for any
// package name. No node_modules is above the REPRL wrapper, and that is where
// bun auto-installs. The fuzzer must still reach that code, but the child must
// not download packages unless the campaign names a registry for it.
describe.skipIf(!isFuzzilliBuild)("bun fuzzilli auto-install", () => {
  const programs = [
    `require("a");`,
    `require.resolve("b");`,
    `Bun.resolveSync("c", "/tmp");`,
    `import("d").catch(e => console.log("import: " + e.message));`,
    `console.log("cache: " + process.env.BUN_INSTALL_CACHE_DIR);`,
  ];
  // An uncaught exception is exit code 1, which REPRL encodes as 1 << 8.
  const statuses = [0x100, 0x100, 0x100, 0, 0];

  function startRegistry() {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      },
    });
    return { requests, server, url: server.url.href };
  }

  function childEnv(extra: Record<string, string>) {
    const env = { ...bunEnv };
    delete env.BUN_CONFIG_REGISTRY;
    delete env.BUN_INSTALL_CACHE_DIR;
    return { ...env, ...extra };
  }

  // The tests share /tmp/bun-fuzzilli-reprl.js, which every child writes again, so they run in turn.
  // "ignored" is a value that the package manager skips: a registry with no scheme, an empty path.
  describe.each([
    ["unset", "unset"],
    ["ignored", "ignored"],
    ["set", "set"],
    ["set", "unset"],
    ["unset", "set"],
  ])("BUN_CONFIG_REGISTRY %s, BUN_INSTALL_CACHE_DIR %s", (registry, cache) => {
    test("only a registry that the campaign names gets requests", async () => {
      const local = startRegistry();
      await using _server = local.server;
      using ownCache = tempDir("fuzzilli-reprl-cache", {});

      // npm's variable ranks below BUN_CONFIG_REGISTRY. The child defaults that one to an
      // address that nothing listens on, so the local registry sees nothing through npm's.
      const inherited: Record<string, string> = { NPM_CONFIG_REGISTRY: local.url };
      if (registry !== "unset") inherited.BUN_CONFIG_REGISTRY = registry === "set" ? local.url : "localhost:4873";
      if (cache !== "unset") inherited.BUN_INSTALL_CACHE_DIR = cache === "set" ? String(ownCache) : "";

      const result = await runReprl(programs, childEnv(inherited));
      expect(local.requests).toEqual(registry === "set" ? ["/a", "/b", "/c", "/d"] : []);
      expect(result.stdout).toContain("uncaught:ResolveMessage: Cannot find module 'a'");
      expect(result.stdout).toContain("uncaught:ResolveMessage: Cannot find module 'b'");
      expect(result.stdout).toContain("uncaught:ResolveMessage: Cannot find package 'c'");
      expect(result.stdout).toContain("import: Cannot find package 'd'");
      // The default is not the cache of the user that runs the fuzzer.
      expect(result.stdout).toContain(`cache: ${cache === "set" ? ownCache : "/tmp/bun-fuzzilli-install-cache"}\n`);
      expect(result).toMatchObject({ handshake: "HELO", statuses, stderr: [], exitCode: 0 });
    });
  });
});
