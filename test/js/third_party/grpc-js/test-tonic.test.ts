import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, rm } from "fs/promises";
import { tmpdirSync } from "harness";
import path from "path";
import unzipper from "unzipper";

const protoVersion = "31.0";

const releases = {
  "win32_x86_32": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-win32.zip`,
  "win32_x86_64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-win32.zip`,
  "linux_x86_32": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-linux-x86_32.zip`,
  "linux_x86_64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-linux-x86_64.zip`,
  "darwin_x86_64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-osx-x86_64.zip`,
  "darwin_arm64": `https://github.com/protocolbuffers/protobuf/releases/download/v${protoVersion}/protoc-${protoVersion}-osx-aarch_64.zip`,
};

const platform = process.platform;
const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : "x86_32";
const release = platform + "_" + arch;

// Load proto
const packageDefinition = protoLoader.loadSync(
  path.join(import.meta.dir, "fixtures/tonic-server/proto/helloworld.proto"),
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  },
);

type Server = { address: string; kill: () => void };

const cargoBin = Bun.which("cargo") as string;
async function startServer(): Promise<Server> {
  const tmpDir = tmpdirSync();
  await cp(path.join(import.meta.dir, "fixtures/tonic-server"), tmpDir, { recursive: true });
  const protocZip = await unzipper.Open.buffer(await fetch(releases[release]).then(res => res.bytes()));

  const protocPath = path.join(tmpDir, "protoc");
  await mkdir(protocPath, { recursive: true });
  await protocZip.extract({ path: protocPath });
  await chmod(path.join(protocPath, "bin/protoc"), 0o755);

  const server = Bun.spawn([cargoBin, "run", "--quiet", path.join(tmpDir, "server")], {
    cwd: tmpDir,
    env: {
      PROTOC: path.join(protocPath, "bin/protoc"),
      PATH: process.env.PATH,
    },
    stdout: "pipe",
    stdin: "ignore",
    stderr: "inherit",
  });

  {
    const { promise, reject, resolve } = Promise.withResolvers<Server>();
    const reader = server.stdout.getReader();
    const decoder = new TextDecoder();
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
          kill: async () => {
            server.kill();
            await rm(tmpDir, { recursive: true, force: true });
          },
        });
        break;
      } else {
        server.kill();
        reject(new Error("Server not started"));
        break;
      }
    }
    return await promise;
  }
}

describe.skipIf(!cargoBin)("test tonic server", () => {
  let server: Server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.kill();
  });

  test("flow control should work in both directions", async () => {
    const hello_proto = grpc.loadPackageDefinition(packageDefinition).helloworld;

    // Create client
    const client = new hello_proto.Greeter(server.address, grpc.credentials.createInsecure());
    const payload = Buffer.alloc(1024 * 1024, "bun").toString();
    for (let i = 0; i < 100; i++) {
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
  });
});
