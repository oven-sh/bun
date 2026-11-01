console.log(JSON.stringify(Bun.JSONL.parse('{"a":1}\n[2,3]\n"four"\n')));
const chunk = Bun.JSONL.parseChunk('{"a":1}\n{"b":');
console.log(JSON.stringify(chunk.values), chunk.read, chunk.done, chunk.error);
console.log(JSON.stringify(Bun.JSONL.parse(new TextEncoder().encode('{"café":true}\n'))));
try {
  Bun.JSONL.parse("nope");
} catch (error) {
  console.log((error as Error).name);
}
