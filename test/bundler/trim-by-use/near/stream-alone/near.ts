interface Written {
  write(chunk: string): void;
  close(): void;
}
const written = new ReadableStream({
  type: "direct",
  pull(controller: Written) {
    controller.write("car");
    controller.write("go");
    controller.close();
  },
} as never);
console.log(await new Response(written).text());
const queued = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("crate"));
    controller.close();
  },
});
console.log(await new Response(queued).text());
