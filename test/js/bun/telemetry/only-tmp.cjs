const { trace } = require("@opentelemetry/api");
const before = trace.getTracer("x").startSpan("y").constructor.name;
Bun.otel.start({ exporters: [] });
const after = trace.getTracer("x").startSpan("y").constructor.name;
console.log(before, after);
