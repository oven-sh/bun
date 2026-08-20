import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import domain from "node:domain";
import { EventEmitter } from "node:events";
import http from "node:http";

describe("node:domain", () => {
  it("exports the Domain class", () => {
    expect(typeof domain.Domain).toBe("function");
    const d = domain.create();
    expect(d).toBeInstanceOf(domain.Domain);
    expect(d).toBeInstanceOf(EventEmitter);
    expect(domain.createDomain()).toBeInstanceOf(domain.Domain);
    expect(d.members).toEqual([]);
  });

  it("run sets the active domain and process.domain", () => {
    const d = domain.create();
    let activeInRun: unknown, processInRun: unknown, thisInRun: unknown;
    d.run(function (this: unknown) {
      activeInRun = domain.active;
      processInRun = process.domain;
      thisInRun = this;
    });
    expect(activeInRun).toBe(d);
    expect(processInRun).toBe(d);
    expect(thisInRun).toBe(d);
    expect(process.domain).toBeUndefined();
  });

  it("run routes a thrown error to the domain's error event", () => {
    const d = domain.create();
    const err = new Error("boom");
    let seen: any;
    d.on("error", (e: any) => {
      seen = e;
    });
    d.run(() => {
      throw err;
    });
    expect(seen).toBe(err);
    expect(seen.domain).toBe(d);
    expect(seen.domainThrown).toBe(false);
    // Node sets no domainEmitter for run()-thrown errors.
    expect(seen.domainEmitter).toBeUndefined();
  });

  it("add and remove track members and route emitter errors", () => {
    const d = domain.create();
    const ee = new EventEmitter();
    d.add(ee);
    expect(d.members).toEqual([ee]);
    expect(ee.domain).toBe(d);

    const err = new Error("emitted");
    let seen: any;
    d.on("error", (e: any) => {
      seen = e;
    });
    ee.emit("error", err);
    expect(seen).toBe(err);
    expect(seen.domainEmitter).toBe(ee);

    d.remove(ee);
    expect(d.members).toEqual([]);
    expect(ee.domain).toBe(null);
  });

  it("http client responses do not accumulate in domain.members", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    const d = domain.create();
    d.on("error", () => {});
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve, reject) => {
        d.run(() => {
          http
            .get(`http://localhost:${server.port}/`, res => {
              res.resume();
              res.on("close", resolve);
            })
            .on("error", reject);
        });
      });
    }
    expect(d.members).toEqual([]);
  });

  it("process.domain is null after requiring node:domain", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `require("node:domain");
         console.log(JSON.stringify([typeof process.domain, process.domain === null]));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["object", true]);
    expect(exitCode).toBe(0);
  });
});
