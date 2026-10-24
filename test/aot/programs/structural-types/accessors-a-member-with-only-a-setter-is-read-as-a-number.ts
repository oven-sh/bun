function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Sink {
  got = 0;
  set level(value: number) {
    this.got = value;
  }
}

function half(n: number): number {
  return n / 2;
}

const sink = new Sink();
sink.level = 8;
say("got", sink.got);
say("read", sink.level);
say("read, plus one", sink.level + 1);
say("read, halved", half(sink.level));
const kept: number = sink.level;
say("kept", kept);
say("kept, or zero", kept | 0);
say("plus equals", (sink.level += 1));
say("got", sink.got);
say("increment", sink.level++);
say("got", sink.got);
say("nullish equals", (sink.level ??= 3));
say("got", sink.got);
