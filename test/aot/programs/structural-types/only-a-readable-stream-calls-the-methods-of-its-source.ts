const log: string[] = [];

class Source implements UnderlyingDefaultSource<string> {
  sent = 0;
  start(): void {
    log.push("start");
  }
  pull(controller: ReadableStreamDefaultController<string>): void {
    log.push("pull");
    if (++this.sent <= 2) controller.enqueue("chunk " + this.sent);
    else controller.close();
  }
}

const chunks: string[] = [];
for await (const chunk of new ReadableStream(new Source(), { highWaterMark: 0 })) chunks.push(chunk);
console.log(chunks.join() + " [" + log.join(", ") + "]");

export {};
