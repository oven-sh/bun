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
    // new File still has to report it.
    expect(estimateShallowMemoryUsageOf(new File([file], name))).toBeGreaterThanOrEqual(payload.byteLength);

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

  it("File reports its bytes to the GC when constructed", async () => {
    // Every File below is garbage as soon as it is constructed. Only the
    // reported payload makes JSC collect during the loop; the cells alone
    // (a few dozen bytes per 1 MiB payload) never reach a collection threshold.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
          const { heapStats } = require("bun:jsc");
          const payload = Buffer.alloc(1024 * 1024, "abc");
          const created = 256;
          for (let i = 0; i < created; i++) {
            new File([payload], "file.bin");
          }
          console.log(JSON.stringify({ created, alive: heapStats().objectTypeCounts.Blob ?? 0 }));
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
    const { created, alive } = JSON.parse(stdout);
    // Seen: 6-23 alive (release through loaded debug+ASAN) once the payload is reported,
    // and created + 1 when it is not, since nothing else ever triggers a collection.
    expect(alive).toBeLessThan(created / 2);
    expect(exitCode).toBe(0);
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
