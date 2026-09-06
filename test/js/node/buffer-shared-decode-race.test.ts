import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A worker flips bytes in a SharedArrayBuffer while the main thread decodes
// it as UTF-8. The decoder must not trust a byte it read earlier: the length
// pass and the conversion pass can see different bytes. An unfixed build
// panics on a debug assertion or writes past the end of the output buffer.
//
// The worker leaves every byte at 0x41 ("A") except the one it is on, which
// is briefly 0x80 (a continuation byte). The length pass counts 0x80 as
// zero UTF-16 units, so a conversion pass that sees 0x41 there writes one
// unit more than was allocated.
const fixture = String.raw`
  import { Worker, isMainThread, workerData, parentPort } from "node:worker_threads";
  import { transcode } from "node:buffer";
  import { StringDecoder } from "node:string_decoder";
  if (!isMainThread) {
    const u8 = new Uint8Array(workerData);
    parentPort.postMessage("go");
    for (let i = 0; ; i++) u8[(i >>> 1) & 63] = i & 1 ? 0x41 : 0x80;
  } else {
    const mode = process.argv[2];
    const iterations = Number(process.argv[3]);
    const sab = new SharedArrayBuffer(64);
    const buf = Buffer.from(sab).fill(0x41);
    const worker = new Worker(import.meta.path, { workerData: sab });
    worker.on("message", async () => {
      let total = 0;
      if (mode === "toString") {
        for (let i = 0; i < iterations; i++) total += buf.toString("utf8").length;
      } else if (mode === "transcode") {
        // A snapshot that holds the 0x80 byte is invalid UTF-8, which transcode rejects.
        for (let i = 0; i < iterations; i++) {
          try {
            total += transcode(buf, "utf8", "ucs2").length;
          } catch (e) {
            if (e.code !== "U_INVALID_CHAR_FOUND") throw e;
            total += 1;
          }
        }
      } else if (mode === "string_decoder") {
        const decoder = new StringDecoder("utf8");
        for (let i = 0; i < iterations; i++) total += decoder.write(buf).length + decoder.end(buf).length;
      } else if (mode === "TextDecoderStream") {
        const stream = new TextDecoderStream();
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        for (let i = 0; i < iterations; i++) {
          writer.write(buf);
          total += (await reader.read()).value.length;
        }
      } else if (mode === "textStream") {
        let enqueued = 0;
        const source = new ReadableStream({
          pull(controller) {
            controller.enqueue(buf);
            if (++enqueued >= iterations) controller.close();
          },
        });
        for await (const text of new Response(source).textStream()) total += text.length;
      }
      console.log("ok", total > 0);
      worker.terminate();
    });
  }
`;

for (const mode of ["toString", "transcode", "string_decoder", "TextDecoderStream", "textStream"]) {
  test.concurrent(`${mode} on a SharedArrayBuffer that another thread writes`, async () => {
    using dir = tempDir("buffer-shared-decode-race", { "fixture.mjs": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs", mode, "5000"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr carries the panic or the sanitizer report on a failing build.
    expect(stdout, stderr).toBe("ok true\n");
    expect(exitCode, stderr).toBe(0);
  });
}
