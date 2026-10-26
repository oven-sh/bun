import { estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import path from "node:path";
import { parseHeapSnapshot, summarizeByType } from "./heap";

type InspectorSnapshot = Bun.HeapSnapshot & { type: "Inspector" };

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
    const parsed = parseHeapSnapshot(snapshot as InspectorSnapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("FormData")?.size).toBeGreaterThan(
      // Test that FormData includes the size of the strings and the blobs
      1024 * 1024 * 8 + 1024 * 1024 * 2 + 1024 * 1024 * 2,
    );

    delete globalThis.formData;
  });

  it("Request", () => {
    var request = new Request("https://example.com", {
      body: Buffer.alloc(1024 * 1024 * 2, "yoo"),
    });
    globalThis.request = request;

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot as InspectorSnapshot);
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
    const parsed = parseHeapSnapshot(snapshot as InspectorSnapshot);
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
    const parsed = parseHeapSnapshot(snapshot as InspectorSnapshot);
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
    const parsed = parseHeapSnapshot(snapshot as InspectorSnapshot);
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
    const parsed = parseHeapSnapshot(snapshot as InspectorSnapshot);
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
    const parsed = parseHeapSnapshot(snapshot as InspectorSnapshot);
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

// A Map and a Set keep their entries in a table that is a cell of its own, and so do a bound
// function and a timer with their arguments past the ones they have fields for. The snapshot has
// to say that this cell references them: without that edge a leak through a Map has no retainer.
describe.concurrent("What a Map, a Set, a bound function and a timer hold is reachable from a root", () => {
  it.each(["Inspector", "GCDebugging", "V8"])("in the %s format", async format => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(__dirname, "heap-snapshot-retainers-fixture.ts"), format],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ArrayElement: true,
      MapKey: true,
      MapValue: true,
      SetMember: true,
      BoundArgument: true,
      TimerArgument: true,
      // Still held: by the table an iterator was created on, which the Map has since replaced.
      ValueInReplacedTable: true,
      // Held by a scope slot that has no name.
      ShadowedParameter: true,
      // Removed, and no iterator has the table: nothing holds them.
      DeletedValue: false,
      ClearedMember: false,
    });
    expect(exitCode).toBe(0);
  });
});

// A snapshot fails when the Vector of its edges cannot grow, which a real heap reaches at 51,821,028
// edges and gigabytes of memory.
describe.concurrent("a snapshot that cannot hold its edges throws", () => {
  const script = (objects: number) => `
    import { generateHeapSnapshotForDebugging } from "bun:jsc";
    globalThis.objects = Array.from({ length: ${objects} }, () => ({}));
    for (const snapshot of [generateHeapSnapshotForDebugging, () => Bun.generateHeapSnapshot()]) {
      try {
        console.log("returned", typeof snapshot());
      } catch (e) {
        console.log("threw", e.name, e.message);
      }
    }
  `;

  // The option makes the engine refuse an edge at that number of edges.
  it("at the limit that BUN_JSC_heapSnapshotBuilderEdgeLimitForTesting sets", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script(0)],
      env: { ...bunEnv, BUN_JSC_heapSnapshotBuilderEdgeLimitForTesting: "1000" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("threw RangeError Out of memory\nthrew RangeError Out of memory\n");
    expect(exitCode).toBe(0);
  });

  // ASAN's allocator can be told to refuse a large allocation: the Vector then cannot grow, as in a
  // real heap. With 70,000 objects the edges do not fit in 2 MB, and neither does what the snapshot
  // keeps for each object, so the snapshot also has to stop there. The allocator prints a warning
  // for each allocation it refuses.
  it.skipIf(!isASAN)("when the allocator refuses the memory for them", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script(70_000)],
      env: {
        ...bunEnv,
        Malloc: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=2", "detect_leaks=0"]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("threw RangeError Out of memory\nthrew RangeError Out of memory\n");
    expect(exitCode).toBe(0);
  });
});

it("console.takeHeapSnapshot() can be called repeatedly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        for (let i = 0; i < 3; i++) {
          console.takeHeapSnapshot();
          Bun.gc(true);
        }
        console.error("OK");
      `,
    ],
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("OK\n");
  expect(exitCode).toBe(0);
});
