import { estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";
import { parseHeapSnapshot, summarizeByType } from "./heap";

describe("Native types report their size correctly", () => {
  it("FormData", () => {
    var formData = new FormData();
    globalThis.formData = formData;
    let original = estimateShallowMemoryUsageOf(formData);
    formData.append("a", Buffer.alloc(1024 * 1024 * 8, "abc").toString());
    const afterBuffer = estimateShallowMemoryUsageOf(formData);
    expect(afterBuffer).toBeGreaterThan(original + 1024 * 1024 * 8);
    formData.append("a", new Blob([Buffer.alloc(1024 * 1024 * 2, "yooa")]));
    const afterBlob = estimateShallowMemoryUsageOf(formData);
    expect(afterBlob).toBeGreaterThan(afterBuffer + 1024 * 1024 * 2);
    formData.append("a", new Blob([Buffer.alloc(1024 * 1024 * 2, "yooa")]));
    const afterBlob2 = estimateShallowMemoryUsageOf(formData);
    expect(afterBlob2).toBeGreaterThan(afterBlob + 1024 * 1024 * 2);

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("FormData")?.size).toBeGreaterThan(
      // Test that FormData includes the size of the strings and the blobs
      1024 * 1024 * 8 + 1024 * 1024 * 2 + 1024 * 1024 * 2,
    );

    delete globalThis.formData;
  });

  it("File", () => {
    const payload = Buffer.alloc(1024 * 1024, "abc");
    const name = "file.bin";
    const blobSize = estimateShallowMemoryUsageOf(new Blob([payload]));
    expect(blobSize).toBeGreaterThanOrEqual(payload.byteLength);

    // A File is a Blob plus a name, so it reports at least what the same Blob does.
    const file = new File([payload], name);
    expect(estimateShallowMemoryUsageOf(file)).toBeGreaterThanOrEqual(blobSize + name.length);

    const type = "application/x-custom-type";
    const typedBlobSize = estimateShallowMemoryUsageOf(new Blob([payload], { type }));
    expect(estimateShallowMemoryUsageOf(new File([payload], name, { type }))).toBeGreaterThanOrEqual(
      typedBlobSize + name.length,
    );

    // No bytes, only a name.
    const longName = Buffer.alloc(64 * 1024, "n").toString();
    expect(estimateShallowMemoryUsageOf(new File([], longName))).toBeGreaterThanOrEqual(longName.length);

    // A single Blob part shares the source's store instead of copying it; the
    // new File still has to report it (and not just repeat what the source reported).
    expect(estimateShallowMemoryUsageOf(new File([file], name))).toBeGreaterThanOrEqual(payload.byteLength);

    // Over a file-backed or S3-backed store the name lives on the File itself
    // instead of in the store.
    expect(estimateShallowMemoryUsageOf(new File([Bun.file(import.meta.path)], longName))).toBeGreaterThanOrEqual(
      longName.length,
    );
    const s3 = new Bun.S3Client({ accessKeyId: "id", secretAccessKey: "secret", bucket: "bucket" }).file("key");
    expect(estimateShallowMemoryUsageOf(new File([s3], longName))).toBeGreaterThanOrEqual(longName.length);

    class MyFile extends File {}
    const subclassed = new MyFile([payload], name);
    expect(subclassed).toBeInstanceOf(MyFile);
    expect(estimateShallowMemoryUsageOf(subclassed)).toBeGreaterThanOrEqual(payload.byteLength);

    // FormData entries carry the File's reported size, like the Blob entries above.
    const formData = new FormData();
    const emptyFormDataSize = estimateShallowMemoryUsageOf(formData);
    formData.append("file", file);
    expect(estimateShallowMemoryUsageOf(formData)).toBeGreaterThanOrEqual(emptyFormDataSize + payload.byteLength);
    expect(estimateShallowMemoryUsageOf(formData.get("file") as File)).toBeGreaterThanOrEqual(payload.byteLength);
  });

  // `new File()` and S3 files are the two Blob wrappers created outside the
  // generated Blob constructor. Bun lowers JSC's minimum allocation budget per GC
  // cycle (largeHeapSize) to 8 MiB, which is what a fresh process with almost
  // nothing live gets, so 512 instances that each own ~64 KB (a payload, or the
  // credentials an S3 file copies) are worth several collections, but only if the
  // wrapper reports that size when it is created: the cells themselves are a few
  // dozen bytes each and never get near the budget. `className` is the heap type
  // both the prototype and the instances are counted under.
  describe.concurrent.each([
    {
      className: "Blob",
      setup: /* js */ `const payload = Buffer.alloc(64 * 1024, "abc");`,
      construct: /* js */ `new File([payload], "file.bin")`,
    },
    {
      className: "S3File",
      setup: /* js */ `
        const client = new Bun.S3Client({
          accessKeyId: "id",
          secretAccessKey: "secret",
          endpoint: "http://localhost:1",
          bucket: Buffer.alloc(64 * 1024, "b").toString(),
        });
      `,
      construct: /* js */ `client.file("key")`,
    },
  ])("$construct", ({ className, setup, construct }) => {
    it("reports its size to the GC when constructed", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          /* js */ `
            const { heapStats } = require("bun:jsc");
            ${setup}
            const count = () => heapStats().objectTypeCounts[${JSON.stringify(className)}];
            // Stays referenced: creating it also creates the lazily allocated prototype.
            const warmup = ${construct};
            // heapStats() runs a full collection itself if none has happened yet
            // (BUN_GC_TIMER_DISABLE=1 skips the startup one). Taking the baseline
            // here absorbs that, so the counts below are plain live-cell counts.
            const before = count();
            const held = ${construct};
            const withHeld = count();
            const created = 512;
            for (let i = 0; i < created; i++) {
              ${construct};
            }
            const alive = count() - withHeld;
            console.log(JSON.stringify({ before, withHeld, created, alive, kept: [warmup.name, held.name] }));
          `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const stderrLines = stderr
        .split("\n")
        .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
        .join("\n");
      expect(stderrLines).toBe("");
      const { before, withHeld, created, alive } = JSON.parse(stdout);
      // Positive control: the counter really counts these instances.
      expect(withHeld).toBe(before + 1);
      // Seen: 10-25 alive when the size is reported on construction; roughly one
      // budget's worth (~125 of these) is what can pile up after the last
      // collection, so the budget would have to double before the bound is at
      // risk. Exactly `created` survive when the size is not reported.
      expect(alive).toBeLessThan(created / 2);
      expect(exitCode).toBe(0);
    });
  });

  it("Request", () => {
    var request = new Request("https://example.com", {
      body: Buffer.alloc(1024 * 1024 * 2, "yoo"),
    });
    globalThis.request = request;

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("Request")?.size).toBeGreaterThan(1024 * 1024 * 2);
    expect(summariesMap.get("Request")?.size).toBeLessThan(1024 * 1024 * 4);

    delete globalThis.request;
  });

  it("Response", () => {
    var response = new Response(Buffer.alloc(1024 * 1024 * 4, "yoo"), {
      headers: {
        "Content-Type": "text/plain",
      },
    });
    globalThis.response = response;

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("Response")?.size).toBeGreaterThan(1024 * 1024 * 4);

    delete globalThis.response;
  });

  it("URL (heap size reporting bug)", () => {
    for (let i = 0; i < 500; i++) {
      // need to use String.repeat(4096) here to ensure lots of tiny strings get allocated and joined.
      // need to assign it to a global to ensure JSC and Bun do not eliminate it.
      globalThis.url = new URL("Hello, 世界! 🌍".repeat(4096), "https://developer.mozilla.org");
    }

    // Expected: < 9007199254740991
    // Received: 18446744073706270000
    expect(heapStats().extraMemorySize).toBeLessThan(Number.MAX_SAFE_INTEGER);

    delete globalThis.url;
  });

  it("URL", () => {
    const searchParams = new URLSearchParams();
    for (let i = 0; i < 1000; i++) {
      searchParams.set(`a${i}`, `b${i}`);
    }

    var url = new URL("https://example.com");
    globalThis.url = url;
    url.search = searchParams.toString();

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("URL")?.size).toBeGreaterThan(searchParams.toString().length);

    delete globalThis.url;
  });

  it("URLSearchParams", () => {
    const searchParams = new URLSearchParams();
    globalThis.searchParams = searchParams;
    const original = estimateShallowMemoryUsageOf(searchParams);
    for (let i = 0; i < 1000; i++) {
      searchParams.set(`a${i}`, `b${i}`);
    }
    const after = estimateShallowMemoryUsageOf(searchParams);
    expect(after).toBeGreaterThan(original + 1000 * 2);

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("URLSearchParams")?.size).toBeGreaterThan(
      // toString() is greater because of the "?" and "&"
      [...searchParams.keys(), ...searchParams.values()].join("").length,
    );

    delete globalThis.searchParams;
  });

  it("Headers", () => {
    const headers = new Headers();
    const original = estimateShallowMemoryUsageOf(headers);
    for (let i = 0; i < 1000; i++) {
      headers.set(`a${i}`, `b${i}`);
    }
    const after = estimateShallowMemoryUsageOf(headers);
    expect(after).toBeGreaterThan(original + 1000 * 2);

    globalThis.headers = headers;

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    // Test that Headers includes the size of the strings
    expect(summariesMap.get("Headers")?.size).toBeGreaterThan([...headers.keys(), ...headers.values()].join("").length);

    delete globalThis.headers;
  });

  it("WebSocket + ServerWebSocket + Request", async () => {
    using server = Bun.serve({
      port: 0,
      websocket: {
        open(ws) {},
        drain(ws) {},
        message(ws, message) {
          const before = estimateShallowMemoryUsageOf(ws);
          ws.send(message);
          const after = estimateShallowMemoryUsageOf(ws);
          const bufferedAmount = ws.getBufferedAmount();
          if (bufferedAmount > 0) {
            expect(after).toBeGreaterThan(before + bufferedAmount);
          }
        },
      },

      fetch(req, server) {
        const before = estimateShallowMemoryUsageOf(req);
        server.upgrade(req);
        const after = estimateShallowMemoryUsageOf(req);

        // We detach the request context from the request object on upgrade.
        expect(after).toBeLessThan(before);

        return new Response("hello");
      },
    });
    const ws = new WebSocket(server.url);
    const original = estimateShallowMemoryUsageOf(ws);
    globalThis.ws = ws;

    const { promise, resolve } = Promise.withResolvers();
    ws.onopen = () => {
      // Send more than we can possibly send in a single message
      ws.send(Buffer.alloc(1024 * 128, "hello"));
    };
    ws.onmessage = event => {
      resolve(event.data);
    };
    await promise;

    const after = estimateShallowMemoryUsageOf(ws);
    expect(after).toBeGreaterThan(original + 1024 * 128);

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("WebSocket")?.size).toBeGreaterThan(1024 * 128);

    delete globalThis.ws;
  });
});

describe("CommonJS Module cached slots are visible in heap snapshots", () => {
  it("reports children and _compile as property edges", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(__dirname, "commonjs-module-heap-snapshot-fixture.cjs")],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // Every WriteBarrier slot appendHidden'd in visitChildren needs a matching
    // analyzePropertyNameEdge, or it retains memory with no visible retainer path.
    // Without it these names still appear, but only as CustomGetterSetter accessor edges.
    const targetsByName = JSON.parse(stdout);
    expect(targetsByName["_compile"]).toContain("Function");
    expect(targetsByName["children"]).toContain("Array");
    expect(exitCode).toBe(0);
  });
});
