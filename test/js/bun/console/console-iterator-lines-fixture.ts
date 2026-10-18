// Prints the lines of each `for await (const line of console)` pass as JSON. A pass ends at the
// line "break" or at the end of stdin. Lines and chunks are strings with one character per byte.
// With an argument (a JSON list of reads, each a list of chunks), the iterator gets those chunks
// and not stdin. With `--schedules`, stdin is a JSON list of such arguments, each for a new iterator.
const asyncIterator = console[Symbol.asyncIterator];

function scripted(reads: string[][]) {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const read = reads.shift();
      if (!read) return controller.close();
      for (const chunk of read) controller.enqueue(new Uint8Array(Buffer.from(chunk, "latin1")));
    },
  });
}

async function passesOf(iterable: AsyncIterable<string>) {
  const passes: string[][] = [];
  for (let stoppedAtBreak = true; stoppedAtBreak;) {
    stoppedAtBreak = false;
    const lines: string[] = [];
    for await (const line of iterable) {
      if (line === "break") {
        stoppedAtBreak = true;
        break;
      }
      lines.push(Buffer.from(line).toString("latin1"));
    }
    passes.push(lines);
  }
  return passes;
}

if (process.argv[2] === "--schedules") {
  const schedules: string[][][] = await Bun.stdin.json();
  const results: string[][][] = [];
  for (const reads of schedules) {
    // The iterator keeps its state on `this` or on Bun.stdin: a new one of each gives a new iterator.
    (Bun as { stdin: unknown }).stdin = { stream: () => scripted(reads) };
    results.push(await passesOf({ [Symbol.asyncIterator]: asyncIterator }));
  }
  process.stdout.write(JSON.stringify(results));
} else {
  if (process.argv[2]) {
    const stream = scripted(JSON.parse(process.argv[2]));
    Bun.stdin.stream = () => stream;
  }
  process.stdout.write(JSON.stringify(await passesOf(console)));
}
