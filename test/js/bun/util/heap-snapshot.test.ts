import { describe, it, expect } from "bun:test";
import { parseHeapSnapshot, summarizeByType } from "./heap";
import { estimateDirectMemoryUsageOf } from "bun:jsc";

describe("Native types report their size correctly", () => {
  it("FormData", () => {
    var formData = new FormData();
    globalThis.formData = formData;
    let original = estimateDirectMemoryUsageOf(formData);
    formData.append("a", Buffer.alloc(1024 * 1024 * 8, "abc").toString());
    const afterBuffer = estimateDirectMemoryUsageOf(formData);
    expect(afterBuffer).toBeGreaterThan(original + 1024 * 1024 * 8);
    formData.append("a", new Blob([Buffer.alloc(1024 * 1024 * 2, "yooa")]));
    const afterBlob = estimateDirectMemoryUsageOf(formData);
    expect(afterBlob).toBeGreaterThan(afterBuffer + 1024 * 1024 * 2);
    formData.append("a", new Blob([Buffer.alloc(1024 * 1024 * 2, "yooa")]));
    const afterBlob2 = estimateDirectMemoryUsageOf(formData);
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
    const original = estimateDirectMemoryUsageOf(searchParams);
    for (let i = 0; i < 1000; i++) {
      searchParams.set(`a${i}`, `b${i}`);
    }
    const after = estimateDirectMemoryUsageOf(searchParams);
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
    const original = estimateDirectMemoryUsageOf(headers);
    for (let i = 0; i < 1000; i++) {
      headers.set(`a${i}`, `b${i}`);
    }
    const after = estimateDirectMemoryUsageOf(headers);
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
          const before = estimateDirectMemoryUsageOf(ws);
          ws.send(message);
          const after = estimateDirectMemoryUsageOf(ws);
          const bufferedAmount = ws.getBufferedAmount();
          if (bufferedAmount > 0) {
            expect(after).toBeGreaterThan(before + bufferedAmount);
          }
        },
      },

      fetch(req, server) {
        const before = estimateDirectMemoryUsageOf(req);
        server.upgrade(req);
        const after = estimateDirectMemoryUsageOf(req);

        // We detach the request context from the request object on upgrade.
        expect(after).toBeLessThan(before);

        return new Response("hello");
      },
    });
    const ws = new WebSocket(server.url);
    const original = estimateDirectMemoryUsageOf(ws);
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

    const after = estimateDirectMemoryUsageOf(ws);
    expect(after).toBeGreaterThan(original + 1024 * 128);

    const snapshot = Bun.generateHeapSnapshot();
    const parsed = parseHeapSnapshot(snapshot);
    const summariesList = Array.from(summarizeByType(parsed));
    const summariesMap = new Map(summariesList.map(summary => [summary.name, summary]));

    expect(summariesMap.get("WebSocket")?.size).toBeGreaterThan(1024 * 128);

    delete globalThis.ws;
  });
});
