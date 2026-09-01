import { YAML } from "bun";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

const doc = `name: Alice
age: 30
server:
  host: localhost
  port: 8080
  paths:
    - /api
    - /web
users:
  - id: 1
    name: Bob
  - id: 2
    name: Carol
metadata:
  created: 2024-01-01
  tags: [alpha, beta, gamma]
`;

const iterations = 10000;

function bench(name, fn) {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - t0;
  const perOp = (elapsed * 1000) / iterations; // microseconds
  console.log(`${name}: ${elapsed.toFixed(1)}ms total (${perOp.toFixed(2)}μs/op, ${iterations} ops)`);
}

console.log("=== Bun.YAML vs yaml@2 ===\n");

const obj = YAML.parse(doc);

bench("Bun.YAML.parse", () => YAML.parse(doc));
bench("yaml@2.parse", () => yamlParse(doc));

bench("Bun.YAML.stringify", () => YAML.stringify(obj, null, 2));
bench("yaml@2.stringify", () => yamlStringify(obj, { indent: 2 }));

bench("Bun.YAML.parseDocument+toJS", () => {
  const d = YAML.parseDocument(doc);
  d.toJS();
});

bench("Bun.YAML.parseDocument+toString", () => {
  const d = YAML.parseDocument(doc);
  d.toString();
});

bench("Bun.YAML.Document full round-trip", () => {
  const d = YAML.parseDocument(doc);
  d.toString();
  d.toJS();
});

console.log("\n=== Document API overhead ===\n");

const d0 = YAML.parseDocument(doc);
bench("Bun.YAML.Document.setIn(dot path)", () => {
  const d = YAML.parseDocument(doc);
  d.setIn("server.host", "127.0.0.1");
});

bench("Bun.YAML.Document.setIn(array path)", () => {
  const d = YAML.parseDocument(doc);
  d.setIn(["server", "host"], "127.0.0.1");
});

bench("Bun.YAML.Document.deleteIn", () => {
  const d = YAML.parseDocument(doc);
  d.deleteIn("metadata.tags");
});

bench("Bun.YAML.Document.comment", () => {
  const d = YAML.parseDocument(doc);
  d.comment("round-trip preserved");
});