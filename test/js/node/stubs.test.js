import { describe, expect, test } from "bun:test";

const stubbed = [
  "node:v8",
  "node:trace_events",
  "node:repl",
  "node:inspector",
  "node:http2",
  "node:diagnostics_channel",
  "node:dgram",
  "node:cluster",
  
  "v8",
  "trace_events",
  "repl",
  "inspector",
  "http2",
  "diagnostics_channel",
  "dgram",
  "cluster",
];

for (let specifier of stubbed) {
  test(`stubbed CJS import.meta.require ${specifier}`, async () => {
    const mod = import.meta.require(specifier);

    expect(Object.keys(mod)).not.toHaveLength(0);
  });

  test(`stubbed CJS require ${specifier}`, async () => {
    const mod = require(specifier);

    expect(Object.keys(mod)).not.toHaveLength(0);
  });

  test(`stubbed import ${specifier}`, async () => {
    const mod = await import(specifier);
    expect(mod).toHaveProperty("default");
    expect(mod.default[Symbol.for("CommonJS")]).toBe(0);
  });
}
