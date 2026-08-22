import { expectType } from "./utilities";

Bun.otel.start();
Bun.otel.start({
  serviceName: "svc",
  resourceAttributes: { "deployment.environment": "prod", n: 1 },
  endpoint: "http://localhost:4318",
  headers: { "x-api-key": "k" },
  exporters: [
    "http://collector:4318",
    { url: "https://otlp.example.com/v1/traces", headers: { authorization: "Bearer x" }, compression: "gzip", timeoutMs: 5000 },
    {
      export(spans) {
        expectType(spans[0]!.name).is<string>();
        expectType(spans[0]!.kind).is<Bun.otel.SpanKind>();
      },
    },
    { exportProtobuf: bytes => expectType(bytes).is<Uint8Array<ArrayBuffer>>() },
    { exportJSON: json => expectType(json).is<string>() },
    "console",
  ],
  sampler: 0.25,
  instrumentations: { fs: "nested", http: true, redis: false, sqlite: "always" },
  batch: { delayMs: 1000, maxQueueSize: 4096 },
  captureDbStatement: false,
  propagators: ["tracecontext"],
  limits: { attributeCountLimit: 64 },
});
Bun.otel.start({ instrumentations: ["http", "fetch"] });
// @ts-expect-error
Bun.otel.start({ instrumentations: { nope: true } });
// @ts-expect-error
Bun.otel.start({ sampler: "sometimes" });

expectType(Bun.otel.enabled).is<boolean>();
const tracer = Bun.otel.tracer("my-lib", "1.0.0");
expectType(tracer.name).is<string>();

const span = tracer.startSpan("op", { kind: Bun.otel.SpanKind.CLIENT, attributes: { a: 1, b: "x", c: [true] } });
span.setAttribute("k", 1n).setAttributes({ x: undefined }).addEvent("e").addEvent("e", { a: 1 }).addEvent("e", Date.now());
span.setStatus({ code: Bun.otel.SpanStatusCode.ERROR, message: "m" }).setStatus(1);
span.recordException(new Error()).updateName("renamed").addLink({ context: span.spanContext() });
expectType(span.traceId).is<string>();
expectType(span.parentSpanId).is<string | undefined>();
expectType(span.spanContext().traceFlags).is<number>();
span.end();
span.end(Date.now());

{
  using s = tracer.startActiveSpan("scoped");
  expectType(s).is<Bun.otel.Span>();
}
const n = tracer.startActiveSpan("cb", s => {
  expectType(s).is<Bun.otel.Span>();
  return 1;
});
expectType(n).is<number>();
const p = tracer.startActiveSpan("cb", { kind: 1 }, async s => "x");
expectType(p).is<Promise<string>>();

expectType(Bun.otel.activeSpan()).is<Bun.otel.Span | undefined>();
const r = Bun.otel.with(span, (a: number, b: string) => a + b.length, undefined, 1, "x");
expectType(r).is<number>();
expectType(Bun.otel.forceFlush()).is<Promise<void>>();
expectType(Bun.otel.stats().spansExported).is<number>();
expectType(Bun.otel.decode(new Uint8Array())[0]!.scope.name).is<string>();

const ctx = Bun.otel.propagator.extract(Bun.otel.ROOT_CONTEXT, { traceparent: "" });
Bun.otel.propagator.inject(ctx, new Headers(), { set: (h, k, v) => (h as Headers).set(k, v) });
Bun.otel.contextManager.with(ctx, () => {});
tracer.startSpan("child", {}, ctx);
