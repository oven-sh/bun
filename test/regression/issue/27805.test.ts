import { expect, test } from "bun:test";
import { tracingChannel } from "node:diagnostics_channel";

// https://github.com/oven-sh/bun/issues/27805
test("TracingChannel.hasSubscribers returns correct value", () => {
  const noop = () => {};

  // Test with subscribe/unsubscribe via handlers object
  {
    const channel = tracingChannel("test:27805:1");
    expect(channel.hasSubscribers).toBe(false);

    const handlers = { start: noop };
    channel.subscribe(handlers);
    expect(channel.hasSubscribers).toBe(true);

    channel.unsubscribe(handlers);
    expect(channel.hasSubscribers).toBe(false);
  }

  // Test subscribing directly to a sub-channel
  {
    const channel = tracingChannel("test:27805:2");
    expect(channel.hasSubscribers).toBe(false);

    channel.start.subscribe(noop);
    expect(channel.hasSubscribers).toBe(true);

    channel.start.unsubscribe(noop);
    expect(channel.hasSubscribers).toBe(false);
  }

  // Test with asyncEnd sub-channel
  {
    const channel = tracingChannel("test:27805:3");
    expect(channel.hasSubscribers).toBe(false);

    const handlers = { asyncEnd: noop };
    channel.subscribe(handlers);
    expect(channel.hasSubscribers).toBe(true);

    channel.unsubscribe(handlers);
    expect(channel.hasSubscribers).toBe(false);

    channel.asyncEnd.subscribe(noop);
    expect(channel.hasSubscribers).toBe(true);

    channel.asyncEnd.unsubscribe(noop);
    expect(channel.hasSubscribers).toBe(false);
  }
});

test("TracingChannel.hasSubscribers works with traceSync", () => {
  const channel = tracingChannel("test:27805:4");
  const results: string[] = [];

  channel.subscribe({
    start(ctx: any) {
      results.push(`start:${ctx.name}`);
    },
    end(ctx: any) {
      results.push(`end:${ctx.name}`);
    },
    error(ctx: any) {
      results.push(`error:${ctx.error.message}`);
    },
  });

  expect(channel.hasSubscribers).toBe(true);

  const result = channel.traceSync(() => "ok:demo", { name: "demo" });
  expect(result).toBe("ok:demo");
  expect(results).toEqual(["start:demo", "end:demo"]);
});
