import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { cp } from "fs/promises";
import { isArm64, isLinux, isMacOS, isWindows, tmpdirSync } from "harness";
import { tmpdir } from "os";
import path, { join } from "path";

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
// Linux and Windows on arm64 have never built this fixture, so the test stays off there.
const hostBuildsFixture = isMacOS || ((isLinux || isWindows) && !isArm64);

// Stable per-machine cache so persistent CI agents don't re-compile the
// entire tonic/tokio dependency tree (~50s) on every run.
const cacheDir = join(tmpdir(), "bun-test-tonic-cache");

// The server needs no protoc: src/helloworld.rs is the checked-in output of
// tonic-build for proto/helloworld.proto. The client reads the .proto, so a
// change to one file and not the other fails here, by name.
test("the server's generated module has the methods and fields of helloworld.proto", async () => {
  const generated = await Bun.file(join(import.meta.dir, "fixtures/tonic-server/src/helloworld.rs")).text();
  const proto = { methods: [] as string[], fields: [] as string[] };
  for (const definition of Object.values(packageDefinition)) {
    if ("format" in definition) {
      const { name, field } = definition.type as { name: string; field: { name: string; number: number }[] };
      for (const { name: fieldName, number } of field) proto.fields.push(`${name}.${fieldName} = ${number}`);
    } else {
      for (const method of Object.values(definition)) proto.methods.push(method.path);
    }
  }
  const rust = {
    methods: Array.from(generated.matchAll(/^ +"(\/[\w.]+\/\w+)" => \{$/gm), match => match[1]),
    fields: Array.from(generated.matchAll(/^pub struct (\w+) \{\n([^}]*)\}/gm)).flatMap(([, name, body]) =>
      Array.from(body.matchAll(/tag = "(\d+)"\)\]\n +pub (\w+):/g), ([, tag, field]) => `${name}.${field} = ${tag}`),
    ),
  };
  expect({ methods: rust.methods.sort(), fields: rust.fields.sort() }).toEqual({
    methods: proto.methods.sort(),
    fields: proto.fields.sort(),
  });
});

async function startServer(): Promise<Server> {
  const tmpDir = tmpdirSync();
  await cp(join(import.meta.dir, "fixtures/tonic-server"), tmpDir, { recursive: true });

  const server = Bun.spawn([cargoBin, "run", "--quiet", path.join(tmpDir, "server")], {
    cwd: tmpDir,
    env: {
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

describe.skipIf(!cargoBin || !hostBuildsFixture)("test tonic server", () => {
  let server: Server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server?.kill();
  });

  test("flow control should work in both directions", async () => {
    const hello_proto = grpc.loadPackageDefinition(packageDefinition).helloworld as any;

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
