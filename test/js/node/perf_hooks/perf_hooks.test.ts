import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import perf from "perf_hooks";

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

test("globalThis.PerformanceObserver is the node:perf_hooks PerformanceObserver", () => {
  expect(globalThis.PerformanceObserver).toBe(perf.PerformanceObserver);
  const types = globalThis.PerformanceObserver.supportedEntryTypes;
  for (const nodeType of ["http", "net", "dns"]) {
    expect(types).toContain(nodeType);
  }
});

// Instrumentation written against globalThis.PerformanceObserver must receive the
// same node-only entries (http/net/dns) that the node:perf_hooks observer gets.
test("globalThis.PerformanceObserver delivers node-only entry types", async () => {
  // The global is resolved as a bare identifier (not via globalThis.) so that
  // scope resolution exercises the lazy custom accessor. node:perf_hooks is not
  // loaded until after the observer is constructed.
  const src = `
    const http = require("node:http");

    const srv = http.createServer((q, r) => r.end("hello"));
    srv.listen(0, "127.0.0.1", () => {
      const viaGlobal = [];
      const viaModule = [];
      const og = new PerformanceObserver(list => {
        for (const e of list.getEntries()) viaGlobal.push(e.entryType + ":" + e.name);
      });
      og.observe({ entryTypes: ["http", "net"] });
      const ModulePO = require("node:perf_hooks").PerformanceObserver;
      const om = new ModulePO(list => {
        for (const e of list.getEntries()) viaModule.push(e.entryType + ":" + e.name);
      });
      om.observe({ entryTypes: ["http", "net"] });

      const req = http.request(
        { host: "127.0.0.1", port: srv.address().port, path: "/x", agent: false },
        res => {
          res.resume();
          res.on("end", () => {
            // Observers dispatch on a fresh tick; let the buffered entries flush.
            setImmediate(() => {
              setImmediate(() => {
                og.disconnect();
                om.disconnect();
                srv.close();
                process.stdout.write(
                  JSON.stringify({
                    sameClass: PerformanceObserver === ModulePO,
                    viaGlobal: viaGlobal.sort(),
                    viaModule: viaModule.sort(),
                  }),
                );
              });
            });
          });
        },
      );
      req.on("error", err => {
        process.stderr.write(String(err));
        process.exit(1);
      });
      req.end();
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout);
  expect(result).toEqual({
    sameClass: true,
    viaGlobal: ["http:HttpClient", "http:HttpRequest", "net:connect"],
    viaModule: ["http:HttpClient", "http:HttpRequest", "net:connect"],
  });
  expect(exitCode).toBe(0);
});
