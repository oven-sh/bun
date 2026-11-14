// The getters below return strings from the per-VM common string table
// (src/jsc/bindings/BunCommonStrings.h). The table is filled lazily and kept
// alive by a GC marking constraint, so every value is read before and after a
// full GC, from the main global, from node:vm contexts, and from a Worker.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const script = /* js */ `
  const { StringDecoder } = require("string_decoder");
  const { createSecretKey, generateKeyPairSync } = require("crypto");
  const { mock } = require("bun:test");
  const vm = require("vm");

  function read() {
    const sk = createSecretKey(Buffer.alloc(16));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const fn = mock(x => { if (x === 1) throw new Error("boom"); return x; });
    fn(0);
    try { fn(1); } catch {}
    const ws = new WebSocket("ws://127.0.0.1:1/");
    ws.onerror = () => {};
    const types = [];
    for (const t of ["blob", "arraybuffer", "nodebuffer"]) { ws.binaryType = t; types.push(ws.binaryType); }
    ws.close();
    return {
      textEncoder: new TextEncoder().encoding,
      textDecoder: new TextDecoder().encoding,
      textDecoderLatin1: new TextDecoder("latin1").encoding,
      textEncoderStream: new TextEncoderStream().encoding,
      textDecoderStream: new TextDecoderStream().encoding,
      stringDecoder: ["utf8", "hex", "base64", "base64url", "ascii", "latin1", "ucs2", "utf16le"].map(e => new StringDecoder(e).encoding),
      keyTypes: [sk.type, publicKey.type, privateKey.type],
      jwkKty: publicKey.export({ format: "jwk" }).kty,
      mockResults: fn.mock.results.map(r => r.type),
      binaryTypes: types,
      responseTypes: [Response.error().type, new Response("x").type],
      credentials: new Request("http://localhost/", { credentials: "include" }).credentials,
      request: (({ method, mode, cache, redirect }) => [method, mode, cache, redirect])(
        new Request("http://localhost/", { method: "POST", mode: "cors", cache: "no-store", redirect: "manual" }),
      ),
      cookie: ["strict", "lax", "none"].map(s => new Bun.Cookie("a", "b", { sameSite: s }).sameSite),
      requireNames: [require.name, require.resolve.name],
    };
  }

  const expected = {
    textEncoder: "utf-8",
    textDecoder: "utf-8",
    textDecoderLatin1: "windows-1252",
    textEncoderStream: "utf-8",
    textDecoderStream: "utf-8",
    stringDecoder: ["utf8", "hex", "base64", "base64url", "ascii", "latin1", "utf16le", "utf16le"],
    keyTypes: ["secret", "public", "private"],
    jwkKty: "OKP",
    mockResults: ["return", "throw"],
    binaryTypes: ["blob", "arraybuffer", "nodebuffer"],
    responseTypes: ["error", "default"],
    credentials: "include",
    request: ["POST", "cors", "no-store", "manual"],
    cookie: ["strict", "lax", "none"],
    requireNames: ["bound require", "bound resolve"],
  };

  function check(where) {
    const got = read();
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      console.error("mismatch in " + where, got);
      process.exit(1);
    }
  }

  check("main");
  Bun.gc(true);
  check("main after gc");

  for (let i = 0; i < 8; i++) {
    const context = vm.createContext({ TextEncoder, TextDecoder, Response, Bun, out: {} });
    vm.runInContext("out.encoding = new TextEncoder().encoding; out.type = Response.error().type; Bun.gc(true);", context);
    if (context.out.encoding !== "utf-8" || context.out.type !== "error") {
      console.error("mismatch in vm context", context.out);
      process.exit(1);
    }
  }
  Bun.gc(true);
  check("main after vm contexts");

  const worker = new Worker(URL.createObjectURL(new Blob([
    "const values = []; for (let i = 0; i < 4; i++) { values.push(new TextEncoder().encoding, Response.error().type); Bun.gc(true); } postMessage(values);",
  ], { type: "application/javascript" })));
  worker.onerror = e => {
    console.error("worker error", e.message ?? e);
    process.exit(1);
  };
  worker.onmessage = e => {
    const ok = e.data.every((v, i) => v === (i % 2 === 0 ? "utf-8" : "error"));
    if (!ok) {
      console.error("mismatch in worker", e.data);
      process.exit(1);
    }
    worker.terminate();
    console.log("ok");
  };
`;

test("common strings survive GC on every global of a VM and in a Worker", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
