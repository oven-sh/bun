// Bun keys TLS parts over 1 KiB by digest in https.Agent#getName where Node embeds them verbatim. These tests are
// therefore Bun-only, which node-http.test.ts's header rules out for that file, so they live here.
import { describe, expect, test } from "bun:test";
import https from "node:https";

describe("https.Agent#getName with large TLS options", () => {
  const bigCA = Buffer.alloc(2048, "A").toString();
  const otherBigCA = Buffer.alloc(2048, "B").toString();
  const opts = (ca: unknown) => ({ host: "localhost", port: 443, ca });
  const expectDigested = (name: string) => {
    expect(name).toContain(":sha256:");
    expect(name.length).toBeLessThan(256);
  };

  test("large parts are keyed by digest; small parts and arrays keep Node's exact format", () => {
    const agent = new https.Agent();
    const a = agent.getName(opts(bigCA));
    expectDigested(a);
    expect(agent.getName(opts(bigCA))).toBe(a);
    expect(agent.getName(opts(otherBigCA))).not.toBe(a);
    expect(agent.getName(opts("small-ca"))).toContain(":small-ca:");
    expect(agent.getName(opts(["a", undefined, null, "b"]))).toContain(":a,,,b:");
  });

  test("the same material as a string, a Buffer or an array element shares one key", () => {
    const agent = new https.Agent();
    const a = agent.getName(opts(bigCA));
    expectDigested(a);
    expect(agent.getName(opts(Buffer.from(bigCA)))).toBe(a);
    expect(agent.getName(opts([bigCA]))).toBe(a);
    expect(agent.getName(opts(Buffer.from(otherBigCA)))).not.toBe(a);
  });

  test("mutating an array or Buffer is reflected on the next call; order matters", () => {
    const agent = new https.Agent();
    const ca = [bigCA];
    const one = agent.getName(opts(ca));
    ca.push(otherBigCA);
    const two = agent.getName(opts(ca));
    expectDigested(two);
    expect(two).not.toBe(one);
    expect(agent.getName(opts([otherBigCA, bigCA]))).not.toBe(two);
    const buf = Buffer.from(bigCA);
    const before = agent.getName(opts(buf));
    buf.fill("B");
    expect(agent.getName(opts(buf))).toBe(agent.getName(opts(otherBigCA)));
    expect(agent.getName(opts(buf))).not.toBe(before);
  });

  test("frozen agents, detached calls (agent-base subclasses) and dhparam", () => {
    const agent = Object.freeze(new https.Agent());
    const a = agent.getName(opts(bigCA));
    expectDigested(a);
    expect(https.Agent.prototype.getName.call({}, opts(bigCA))).toBe(a);
    expect(https.Agent.prototype.getName.call(undefined, opts(bigCA))).toBe(a);
    expectDigested(agent.getName({ host: "localhost", port: 443, dhparam: bigCA }));
  });
});
