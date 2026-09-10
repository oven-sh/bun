import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A worker rewrites a SharedArrayBuffer while the main thread decodes it as
// UTF-8. The decoder must not trust a byte it read earlier: the length pass
// and the conversion pass can see different bytes.
//
// The worker fills the buffer with 0x80 (a continuation byte), then with
// 0x61 ("a"). The length pass counts a 0x80 byte as zero UTF-16 units, so a
// conversion pass that sees 0x61 there writes one unit per byte more than
// was allocated. An unfixed build segfaults in release and reports a
// heap-buffer-overflow under ASAN.
const fixture = String.raw`
  import { Worker, isMainThread, workerData, parentPort } from "node:worker_threads";
  import { transcode } from "node:buffer";
  import { StringDecoder } from "node:string_decoder";
  if (!isMainThread) {
    const u8 = new Uint8Array(workerData);
    parentPort.postMessage("go");
    for (;;) {
      u8.fill(0x80);
      u8.fill(0x61);
    }
  } else {
    const mode = process.argv[2];
    const iterations = Number(process.argv[3]);
    const sab = new SharedArrayBuffer(4096);
    const buf = Buffer.from(sab).fill(0x61);
    const worker = new Worker(import.meta.path, { workerData: sab });
    worker.on("message", async () => {
      let total = 0;
      if (mode === "toString") {
        for (let i = 0; i < iterations; i++) total += buf.toString("utf8").length;
      } else if (mode === "transcode") {
        // A snapshot of the 0x80 fill is invalid UTF-8, which transcode rejects.
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
      cmd: [bunExe(), "fixture.mjs", mode, "500"],
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
