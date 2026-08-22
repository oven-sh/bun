import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import * as utils from "../test-utils";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

describe.skipIf(!isEnabled)("Valkey: OpenTelemetry", () => {
  const spans: any[] = [];
  // The pipeline is process-global; leave nothing behind for later files.
  afterAll(() => Bun.otel.shutdown());
  beforeEach(() => {
    if (ctx.redis?.connected) ctx.redis.close?.();
    ctx.redis = createClient(ConnectionType.TCP);
    Bun.otel.start({
      serviceName: "valkey-otel-test",
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { redis: "always" },
    });
  });

  async function collect() {
    await Bun.sleep(0);
    await Bun.otel.forceFlush();
    return spans.splice(0, spans.length).filter(s => s.scope.name === "bun.redis");
  }

  test("one CLIENT span per command with db semconv; values and credentials are not recorded", async () => {
    const redis = ctx.redis;
    await redis.set("otel:key", "secret-value");
    await redis.get("otel:key");
    await redis.send("AUTH", ["hunter2"]).catch(() => {});
    const got = (await collect()).filter(s => ["SET", "GET", "AUTH"].includes(s.attributes["db.operation.name"]));
    // semconv: `{operation} {db.namespace}` (the SELECT index, 0 by default).
    expect(got.map(s => [s.name, s.attributes["db.query.text"], s.status.code])).toEqual([
      ["SET 0", "SET otel:key ...", 0],
      ["GET 0", "GET otel:key", 0],
      ["AUTH 0", undefined, 2],
    ]);
    expect(JSON.stringify(got)).not.toContain("secret-value");
    expect(JSON.stringify(got)).not.toContain("hunter2");
    const url = new URL(utils.DEFAULT_REDIS_URL);
    expect(got[0]).toMatchObject({
      kind: 2,
      attributes: {
        "db.system.name": "redis",
        "db.namespace": "0",
        "db.operation.name": "SET",
        "server.address": url.hostname,
        "server.port": Number(url.port),
      },
    });
  });

  test("commands issued inside an active span are its children", async () => {
    const redis = ctx.redis;
    const tracer = Bun.otel.tracer("test");
    await tracer.startActiveSpan("parent", async parent => {
      await redis.incr("otel:counter");
      parent.end();
    });
    const [incr] = (await collect()).filter(s => s.attributes["db.operation.name"] === "INCR");
    expect(incr.parentSpanId).toEqual(expect.any(String));
  });
});
