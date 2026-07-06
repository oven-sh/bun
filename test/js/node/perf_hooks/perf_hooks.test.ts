import { expect, test } from "bun:test";
import http from "node:http";
import perf, { PerformanceEntry, PerformanceObserver } from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

test("doesn't throw", () => {
  expect(() => performance.mark("test")).not.toThrow();
  expect(() => performance.measure("test", "test")).not.toThrow();
  expect(() => performance.clearMarks()).not.toThrow();
  expect(() => performance.clearMeasures()).not.toThrow();
  expect(() => performance.getEntries()).not.toThrow();
  expect(() => performance.getEntriesByName("test")).not.toThrow();
  expect(() => performance.getEntriesByType("measure")).not.toThrow();
  expect(() => performance.now()).not.toThrow();
  expect(() => performance.timeOrigin).not.toThrow();
  expect(() => performance.markResourceTiming()).not.toThrow();
});

test("observed net and http entries are PerformanceEntry objects with toJSON()", async () => {
  const entries: any[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const observer = new PerformanceObserver(list => {
    entries.push(...list.getEntries());
    // 'connect' from the client socket, 'HttpRequest' from the server and
    // 'HttpClient' from the client request.
    if (entries.length >= 3) resolve();
  });
  observer.observe({ entryTypes: ["net", "http"] });

  const server = http.createServer((req, res) => res.end("ok"));
  server.on("error", reject);

  let port: number;
  try {
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    port = (server.address() as any).port;

    await new Promise<void>((done, fail) => {
      http
        .get({ host: "127.0.0.1", port }, res => {
          res.on("error", fail);
          res.on("end", done);
          res.resume();
        })
        .on("error", fail);
    });

    await promise;
  } finally {
    observer.disconnect();
    server.close();
  }

  const byName = Object.fromEntries(entries.map(entry => [entry.name, entry]));
  expect(Object.keys(byName).sort()).toEqual(["HttpClient", "HttpRequest", "connect"]);

  for (const entry of entries) {
    expect(entry).toBeInstanceOf(PerformanceEntry);
    expect(entry.constructor.name).toBe("PerformanceNodeEntry");
    expect(Object.getPrototypeOf(Object.getPrototypeOf(entry))).toBe(PerformanceEntry.prototype);
    expect(entry.startTime).toBeNumber();
    expect(entry.duration).toBeNumber();
    // Serializing what you observe is the whole point of observing it.
    expect(entry.toJSON()).toEqual({
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
      detail: entry.detail,
    });
    expect(JSON.parse(JSON.stringify(entry))).toEqual(JSON.parse(JSON.stringify(entry.toJSON())));

    // Node keeps the fields on the prototype, with `detail` and `toJSON`
    // non-enumerable, so an entry has no own keys and enumerates four.
    expect(Object.keys(entry)).toEqual([]);
    const enumerated: string[] = [];
    for (const key in entry) enumerated.push(key);
    expect(enumerated.sort()).toEqual(["duration", "entryType", "name", "startTime"]);
  }

  expect(byName.connect.entryType).toBe("net");
  expect(byName.connect.detail).toEqual({ host: "127.0.0.1", port: port! });

  expect(byName.HttpRequest.entryType).toBe("http");
  expect(byName.HttpRequest.detail.res.statusCode).toBe(200);

  expect(byName.HttpClient.entryType).toBe("http");
  expect(byName.HttpClient.detail.req.method).toBe("GET");
});
