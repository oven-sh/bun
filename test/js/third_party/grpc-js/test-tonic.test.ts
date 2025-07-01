import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, rmSync } from "fs";
import { tmpdirSync } from "harness";
import path from "path";
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
  cpSync(path.join(import.meta.dir, "fixtures/tonic-server"), tmpDir, { recursive: true });
  const server = Bun.spawn([cargoBin, "run", "--quiet", path.join(tmpDir, "server")], {
    cwd: tmpDir,
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
          kill() {
            server.kill();
            rmSync(tmpDir, { recursive: true, force: true });
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

  afterAll(() => {
    server.kill();
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
