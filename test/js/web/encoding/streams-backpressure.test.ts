import { expect, test } from "bun:test";

// META: global=window,worker

// https://github.com/web-platform-tests/wpt/blob/master/encoding/streams/backpressure.any.js
//
// TextEncoderStream and TextDecoderStream are set up like `new TransformStream()`
// (readable highWaterMark 0), so a write does not complete until a read relieves
// the backpressure the stream starts with.

const classes = [
  {
    name: "TextDecoderStream",
    input: new Uint8Array([65]),
  },
  {
    name: "TextEncoderStream",
    input: "A",
  },
] as const;

const microtasksRun = () => new Promise(resolve => setTimeout(resolve, 0));

for (const streamClass of classes) {
  test(`write() should not complete until read relieves backpressure for ${streamClass.name}`, async () => {
    const stream = new globalThis[streamClass.name]();
    const writer = (stream.writable as WritableStream<string | Uint8Array>).getWriter();
    const reader = stream.readable.getReader();
    const events: string[] = [];
    await microtasksRun();
    const writePromise = writer.write(streamClass.input);
    writePromise.then(() => events.push("write"));
    await microtasksRun();
    events.push("paused");
    await reader.read();
    events.push("read");
    await writePromise;
    expect(events, "write should happen after read").toEqual(["paused", "read", "write"]);
  });

  test(`additional writes should wait for backpressure to be relieved for class ${streamClass.name}`, async () => {
    const stream = new globalThis[streamClass.name]();
    const writer = (stream.writable as WritableStream<string | Uint8Array>).getWriter();
    const reader = stream.readable.getReader();
    const events: string[] = [];
    await microtasksRun();
    const readPromise1 = reader.read();
    readPromise1.then(() => events.push("read1"));
    const writePromise1 = writer.write(streamClass.input);
    const writePromise2 = writer.write(streamClass.input);
    writePromise1.then(() => events.push("write1"));
    writePromise2.then(() => events.push("write2"));
    await microtasksRun();
    events.push("paused");
    const readPromise2 = reader.read();
    readPromise2.then(() => events.push("read2"));
    await Promise.all([writePromise1, writePromise2, readPromise1, readPromise2]);
    expect(events, "writes should not happen before read2").toEqual(["read1", "write1", "paused", "read2", "write2"]);
  });
}
