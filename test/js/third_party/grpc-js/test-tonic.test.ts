import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { chmod, cp, mkdir } from "fs/promises";
import { tmpdirSync } from "harness";
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
async function startServer(): Promise<Server> {
  const tmpDir = tmpdirSync();
  await cp(join(import.meta.dir, "fixtures/tonic-server"), tmpDir, { recursive: true });
  const protocZip = await unzipper.Open.buffer(await fetch(releases[release]).then(res => res.bytes()));

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
    },
    stdout: "pipe",
    stdin: "ignore",
    stderr: "inherit",
  });

  {
    const { promise, reject, resolve } = Promise.withResolvers<Server>();
    const reader = server.stdout.getReader();
    const decoder = new TextDecoder();
    async function killServer() {
      try {
        server.kill();
        await server.exited;
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const text = decoder.decode(value);
      if (text.includes("Listening on")) {
        const [_, address] = text.split("Listening on ");
        resolve({
          address: address?.trim(),
          kill: killServer,
        });
        break;
      } else {
        await killServer();
        reject(new Error("Server not started"));
        break;
      }
    }
    return await promise;
  }
}

describe.skipIf(!cargoBin || !releases[release])("test tonic server", () => {
  let server: Server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(() => {
    server.kill();
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
