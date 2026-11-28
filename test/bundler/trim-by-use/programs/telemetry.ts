const names: string[] = [];
Bun.otel.start({ exporters: [{ export: spans => void names.push(...spans.map(span => span.name)) }] });
await Bun.otel.span("outer", async () => {
  await Bun.file(process.execPath).slice(0, 1).bytes();
  Bun.otel.tracer("own").startSpan("inner").end();
});
await Bun.otel.shutdown();
console.log(names.sort());
