import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { chmod, cp, mkdir, rename } from "fs/promises";
import { tmpdirSync } from "harness";
import { tmpdir } from "os";
import path, { join } from "path";
import unzipper from "unzipper";

const protoVersion = "31.0";

const releases = {
  "win32_x86_32": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-win32.zip`,
  "win32_x86_64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-win64.zip`,
  "linux_x86_32": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-linux-x86_32.zip`,
  "linux_x86_64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-linux-x86_64.zip`,
  "darwin_x86_64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-osx-x86_64.zip`,
  "darwin_arm64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-osx-aarch_64.zip`,
};

const platform = process.platform;
const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : "x86_32";
const release = platform + "_" + arch;
const binPath = join("bin", platform === "win32" ? "protoc.exe" : "protoc");

// Load proto
const packageDefinition = protoLoader.loadSync(join(import.meta.dir, "fixtures/tonic-server/proto/helloworld.proto"), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

type Server = { address: string; kill: () => Promise<void> };

const cargoBin = Bun.which("cargo") as string;

// Stable per-machine cache so persistent CI agents don't re-download protoc and
// re-compile the entire tonic/tokio dependency tree (~50s) on every run.
const cacheDir = join(tmpdir(), "bun-test-tonic-cache");

async function getProtocZipBytes(): Promise<Uint8Array> {
  const cachedPath = join(cacheDir, `protoc-${protoVersion}-${release}.zip`);
  const cached = Bun.file(cachedPath);
  if (await cached.exists()) {
    return await cached.bytes();
  }
  const bytes = await fetch(releases[release]).then(res => res.bytes());
  await mkdir(cacheDir, { recursive: true });
  // Write-then-rename so a concurrent/crashed run never leaves a truncated zip behind.
  const partial = `${cachedPath}.${process.pid}.tmp`;
  await Bun.write(partial, bytes);
  await rename(partial, cachedPath);
  return bytes;
}

async function startServer(): Promise<Server> {
  const tmpDir = tmpdirSync();
  await cp(join(import.meta.dir, "fixtures/tonic-server"), tmpDir, { recursive: true });
  const protocZip = await unzipper.Open.buffer(await getProtocZipBytes());

  const protocPath = join(tmpDir, "protoc");
  await mkdir(protocPath, { recursive: true });
  await protocZip.extract({ path: protocPath });
  const protocExec = join(protocPath, binPath);
  await chmod(protocExec, 0o755);

  const server = Bun.spawn([cargoBin, "run", "--quiet", path.join(tmpDir, "server")], {
    cwd: tmpDir,
    env: {
      PROTOC: protocExec,
      PATH: process.env.PATH,
      CARGO_HOME: process.env.CARGO_HOME,
      RUSTUP_HOME: process.env.RUSTUP_HOME,
      RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN,
      // Keep cargo's target dir outside the throwaway tmpDir so registry deps
      // (tonic, tokio, prost, ...) compile once per machine instead of once per run.
      CARGO_TARGET_DIR: join(cacheDir, "target"),
    },
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
  });

  {
    // Drain stderr immediately so a chatty compile can't fill the pipe buffer
    // and wedge the child before it gets to print "Listening on".
    const stderrPromise = server.stderr.text();
    const reader = server.stdout.getReader();
    const decoder = new TextDecoder();
    async function killServer() {
      try {
        server.kill();
        await server.exited;
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
    const marker = "Listening on ";
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (value) text += decoder.decode(value, { stream: true });
      const markerIndex = text.indexOf(marker);
      const lineEnd = markerIndex < 0 ? -1 : text.indexOf("\n", markerIndex + marker.length);
      if (lineEnd >= 0) {
        return {
          address: text.slice(markerIndex + marker.length, lineEnd).trim(),
          kill: killServer,
        };
      }
      if (done) break;
    }
    // stdout closed without a "Listening on" line: cargo/rustup failed or the
    // build errored. Surface stderr so the failure is diagnosable instead of
    // awaiting a never-settled promise until the hook times out.
    const [stderr, exitCode] = await Promise.all([stderrPromise, server.exited]);
    await killServer();
    throw new Error(`tonic server exited (${exitCode}) before reporting an address:\n${stderr || text}`);
  }
}

describe.skipIf(!cargoBin || !releases[release])("test tonic server", () => {
  let server: Server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server?.kill();
  });

  test("flow control should work in both directions", async () => {
    const hello_proto = grpc.loadPackageDefinition(packageDefinition).helloworld;

    // Create client
    const client = new hello_proto.Greeter(server.address, grpc.credentials.createInsecure());
    const payload = Buffer.alloc(1024 * 1024, "bun").toString();
    for (let i = 0; i < 20; i++) {
      const { promise, reject, resolve } = Promise.withResolvers<string>();
      // Call SayHello
      client.SayHello({ name: payload }, (err, response) => {
        if (err) reject(err);
        else resolve(response.message);
      });
      const result = await promise;
      expect(result.length).toBe(payload.length);
      expect(result).toBe(payload);
    }
    await client.close();
  }, 20_000); // debug can take some time
});
