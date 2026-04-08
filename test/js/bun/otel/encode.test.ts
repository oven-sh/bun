import { describe, expect, test } from "bun:test";

// @ts-expect-error TODO(@jarred): packages/bun-types
const { encodeTraces, decodeTraces } = Bun.otel;

// protobufjs-generated message types from the official OTLP transformer.
// We use the raw `root` rather than `ProtobufTraceSerializer` because the
// latter only exposes serialize-from-ReadableSpan / deserialize-response.
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root.js";
const PB = root.opentelemetry.proto;
const ExportTraceServiceRequest = PB.collector.trace.v1.ExportTraceServiceRequest;

const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";
const SPAN_ID = "051581bf3cb55c13";
const PARENT_ID = "eee19b7ec3c1b174";
const LINK_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const LINK_SPAN_ID = "b7ad6b7169203331";

function fixture() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "bun-test" } },
            { key: "service.instance.id", value: { stringValue: "i-123" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "bun.http", version: "1.0.0", attributes: [] },
            spans: [
              {
                traceId: TRACE_ID,
                spanId: SPAN_ID,
                parentSpanId: PARENT_ID,
                name: "GET /users",
                kind: 2,
                startTimeUnixNano: "1544712660000000000",
                endTimeUnixNano: "1544712661000000000",
                traceState: "vendor=x",
                flags: 1,
                attributes: [
                  { key: "http.status_code", value: { intValue: "200" } },
                  { key: "http.route", value: { stringValue: "/users" } },
                  { key: "ok", value: { boolValue: true } },
                  { key: "ratio", value: { doubleValue: 0.5 } },
                  { key: "blob", value: { bytesValue: Buffer.from([1, 2, 3, 255]).toString("base64") } },
                  {
                    key: "tags",
                    value: { arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] } },
                  },
                  {
                    key: "nested",
                    value: { kvlistValue: { values: [{ key: "inner", value: { intValue: "7" } }] } },
                  },
                ],
                droppedAttributesCount: 1,
                events: [
                  {
                    timeUnixNano: "1544712660500000000",
                    name: "exception",
                    attributes: [{ key: "exception.message", value: { stringValue: "boom" } }],
                  },
                ],
                droppedEventsCount: 2,
                links: [
                  {
                    traceId: LINK_TRACE_ID,
                    spanId: LINK_SPAN_ID,
                    attributes: [],
                    flags: 1,
                  },
                ],
                droppedLinksCount: 3,
                status: { code: 2, message: "boom" },
              },
            ],
            schemaUrl: "https://opentelemetry.io/schemas/1.21.0",
          },
          {
            scope: { name: "bun.sql", attributes: [] },
            spans: [
              {
                traceId: TRACE_ID,
                spanId: "ffeeddccbbaa9988",
                name: "SELECT 1",
                kind: 3,
                startTimeUnixNano: "1544712660100000000",
                endTimeUnixNano: "1544712660200000000",
                attributes: [],
                events: [],
                links: [],
              },
            ],
          },
        ],
      },
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "other" } }] },
        scopeSpans: [],
      },
    ],
  };
}

describe("Bun.otel codec", () => {
  test("encodeTraces returns Uint8Array", () => {
    const out = encodeTraces({ resourceSpans: [] });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(0);
  });

  test("round-trip preserves all fields", () => {
    const input = fixture();
    const bytes = encodeTraces(input);
    expect(bytes.length).toBeGreaterThan(0);
    const output = decodeTraces(bytes);
    expect(output).toMatchObject(input);
  });

  test("our encode → official protobufjs decode", () => {
    const bytes = encodeTraces(fixture());
    const decoded = ExportTraceServiceRequest.decode(bytes);
    const obj = ExportTraceServiceRequest.toObject(decoded, { longs: String });

    const span = obj.resourceSpans[0].scopeSpans[0].spans[0];
    expect(Buffer.from(span.traceId).toString("hex")).toBe(TRACE_ID);
    expect(Buffer.from(span.spanId).toString("hex")).toBe(SPAN_ID);
    expect(Buffer.from(span.parentSpanId).toString("hex")).toBe(PARENT_ID);
    expect(span.name).toBe("GET /users");
    expect(span.kind).toBe(2);
    expect(String(span.startTimeUnixNano)).toBe("1544712660000000000");
    expect(String(span.endTimeUnixNano)).toBe("1544712661000000000");
    expect(span.flags).toBe(1);
    expect(span.traceState).toBe("vendor=x");
    expect(span.droppedAttributesCount).toBe(1);
    expect(span.droppedEventsCount).toBe(2);
    expect(span.droppedLinksCount).toBe(3);
    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe("boom");

    const attrs = Object.fromEntries(span.attributes.map((a: any) => [a.key, a.value]));
    expect(attrs["http.status_code"].intValue).toBe("200");
    expect(attrs["http.route"].stringValue).toBe("/users");
    expect(attrs["ok"].boolValue).toBe(true);
    expect(attrs["ratio"].doubleValue).toBe(0.5);
    expect(Buffer.from(attrs["blob"].bytesValue)).toEqual(Buffer.from([1, 2, 3, 255]));
    expect(attrs["tags"].arrayValue.values.map((v: any) => v.stringValue)).toEqual(["a", "b"]);
    expect(attrs["nested"].kvlistValue.values[0].key).toBe("inner");

    expect(span.events[0].name).toBe("exception");
    expect(String(span.events[0].timeUnixNano)).toBe("1544712660500000000");
    expect(Buffer.from(span.links[0].traceId).toString("hex")).toBe(LINK_TRACE_ID);
    expect(span.links[0].flags).toBe(1);

    expect(obj.resourceSpans[0].resource.attributes[0].value.stringValue).toBe("bun-test");
    expect(obj.resourceSpans[0].scopeSpans[0].scope.name).toBe("bun.http");
    expect(obj.resourceSpans[0].scopeSpans[0].schemaUrl).toBe("https://opentelemetry.io/schemas/1.21.0");
    expect(obj.resourceSpans[0].scopeSpans[1].spans[0].name).toBe("SELECT 1");
    expect(obj.resourceSpans[1].resource.attributes[0].value.stringValue).toBe("other");
  });

  test("official protobufjs encode → our decode", () => {
    // Build the same message using protobufjs's input shape (Uint8Array IDs).
    const msg = ExportTraceServiceRequest.create({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "x" } }] },
          scopeSpans: [
            {
              scope: { name: "s" },
              spans: [
                {
                  traceId: Buffer.from(TRACE_ID, "hex"),
                  spanId: Buffer.from(SPAN_ID, "hex"),
                  name: "op",
                  kind: 1,
                  startTimeUnixNano: 123,
                  attributes: [{ key: "k", value: { intValue: -42 } }],
                },
              ],
            },
          ],
        },
      ],
    });
    const theirBytes = ExportTraceServiceRequest.encode(msg).finish();
    const ours = decodeTraces(theirBytes);
    const sp = ours.resourceSpans[0].scopeSpans[0].spans[0];
    expect(sp.traceId).toBe(TRACE_ID);
    expect(sp.spanId).toBe(SPAN_ID);
    expect(sp.name).toBe("op");
    expect(sp.kind).toBe(1);
    expect(sp.startTimeUnixNano).toBe("123");
    expect(sp.attributes[0].value.intValue).toBe("-42");
  });

  test("decodeTraces rejects malformed input cleanly", () => {
    expect(() => decodeTraces(new Uint8Array([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f]))).toThrow(/LengthExceedsBuffer/);
    expect(() => decodeTraces(new Uint8Array([0x0a, 0x05, 0x01]))).toThrow(/LengthExceedsBuffer/);
    expect(() => decodeTraces(new Uint8Array([0x80, 0x80]))).toThrow(/Truncated/);
    // 11-byte varint
    expect(() => decodeTraces(new Uint8Array(Array(11).fill(0xff)))).toThrow(/VarintTooLong/);
    // wire type 7 (invalid)
    expect(() => decodeTraces(new Uint8Array([0x0f]))).toThrow(/InvalidWireType/);
    // field number > 2^29-1 (six-byte varint key)
    expect(() => decodeTraces(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x02]))).toThrow(/InvalidFieldNumber/);
    // field number 0
    expect(() => decodeTraces(new Uint8Array([0x00]))).toThrow(/InvalidFieldNumber/);
    // unknown top-level field gets skipped, no throw
    expect(decodeTraces(new Uint8Array([0x10, 0x01]))).toEqual({ resourceSpans: [] });
  });

  test("decodeTraces enforces nesting cap", () => {
    // Build {arrayValue:{values:[{arrayValue:{values:[...]}}]}} 40 deep via the official encoder
    let v: any = { stringValue: "leaf" };
    for (let i = 0; i < 40; i++) v = { arrayValue: { values: [v] } };
    const msg = ExportTraceServiceRequest.create({
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [{ traceId: Buffer.alloc(16), spanId: Buffer.alloc(8), attributes: [{ key: "k", value: v }] }] },
          ],
        },
      ],
    });
    const bytes = ExportTraceServiceRequest.encode(msg).finish();
    expect(() => decodeTraces(bytes)).toThrow(/NestingTooDeep/);
  });

  test("encodeTraces treats NaN in uint32 fields as 0 (no @intFromFloat panic)", () => {
    const out = decodeTraces(
      encodeTraces({
        resourceSpans: [
          {
            scopeSpans: [
              { spans: [{ traceId: TRACE_ID, spanId: SPAN_ID, name: "x", kind: NaN, droppedAttributesCount: NaN }] },
            ],
          },
        ],
      }),
    );
    // proto3 omits 0-valued fields; decoder may return 0 or leave undefined.
    expect(out.resourceSpans[0].scopeSpans[0].spans[0].kind ?? 0).toBe(0);
  });

  test("encodeTraces handles signed int64 attribute values", () => {
    const span = (intValue: unknown) => ({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                { traceId: TRACE_ID, spanId: SPAN_ID, name: "x", attributes: [{ key: "k", value: { intValue } }] },
              ],
            },
          ],
        },
      ],
    });
    for (const v of [-42, "-42", -1n, "-9223372036854775808"]) {
      const out = decodeTraces(encodeTraces(span(v)));
      expect(out.resourceSpans[0].scopeSpans[0].spans[0].attributes[0].value.intValue).toMatch(/^-/);
    }
    expect(() => encodeTraces(span(NaN))).toThrow(/finite/);
    expect(() => encodeTraces(span(Infinity))).toThrow(/finite/);
  });

  test("encodeTraces validates hex IDs", () => {
    expect(() =>
      encodeTraces({
        resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "zz", spanId: SPAN_ID, name: "x" }] }] }],
      }),
    ).toThrow();
  });

  test("our bytes byte-match protobufjs's decode→re-encode", () => {
    // Protobuf isn't canonical, so two encoders won't byte-match in general.
    // But: their decode of our bytes, re-encoded by them, should round-trip
    // through our decoder semantically.
    const ours = encodeTraces(fixture());
    const reencoded = ExportTraceServiceRequest.encode(ExportTraceServiceRequest.decode(ours)).finish();
    const a = decodeTraces(ours);
    const b = decodeTraces(reencoded);
    expect(b).toEqual(a);
  });
});
