const stream = new ReadableStream({
  start(controller) {
    controller.enqueue("a");
    controller.enqueue("b");
    controller.close();
  },
});
const [left, right] = stream.tee();
const upper = left.pipeThrough(
  new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(String(chunk).toUpperCase());
    },
  }),
);
const seen: string[] = [];
await upper.pipeTo(
  new WritableStream({
    write(chunk) {
      seen.push(chunk);
    },
  }),
);
console.log(seen.join(""), await Bun.readableStreamToText(right));
console.log(
  await new Response(new Blob(["blob"]).stream()).text(),
  (await new Response("body").body!.getReader().read()).value!.length,
);
const bytes = new ReadableStream({
  type: "bytes",
  pull(controller: any) {
    controller.enqueue(new Uint8Array([1, 2, 3]));
    controller.close();
  },
}).getReader({ mode: "byob" });
console.log((await bytes.read(new Uint8Array(8))).value!.length);
console.log(
  await new Response(
    new Blob(["\u20ac"]).stream().pipeThrough(new TextDecoderStream()).pipeThrough(new TextEncoderStream()),
  ).text(),
);
console.log(
  await new Response(
    (async function* () {
      yield "gen";
      yield "erated";
    })() as any,
  ).text(),
  new CountQueuingStrategy({ highWaterMark: 2 }).highWaterMark,
);
const sink = new Bun.ArrayBufferSink();
sink.start();
sink.write("abc");
console.log((sink.end() as ArrayBuffer).byteLength);
for await (const chunk of new ReadableStream({
  start(c) {
    c.enqueue(1);
    c.close();
  },
}))
  console.log(chunk);
console.log(stream);
