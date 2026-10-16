function memoizeOne<A extends object, T>(callback: (argument: A) => T): (argument: A) => T {
  const known = new Map<A, T>();
  return argument => {
    let value = known.get(argument);
    if (value === undefined) {
      value = callback(argument);
      known.set(argument, value);
    }
    return value;
  };
}
interface Rules {
  depth: number;
}
interface Factory {
  rules: Rules;
  make(kind: number): number;
  count: number;
}
let built = 0;
function rulesOf(): Rules {
  built++;
  return { depth: built };
}
function describe(factory: Factory): string {
  return factory.make(1) + "," + factory.rules.depth + "," + factory.count;
}
const described = memoizeOne(describe);

interface Sink {
  value?: number;
  seen: number;
}
function createSink(): Sink {
  const sink: Sink = {
    set value(given: number | undefined) {
      sink.seen += given ?? 0;
    },
    seen: 0,
  };
  return sink;
}
function feed(sink: Sink): number {
  sink.value = 4;
  sink.value = 5;
  return sink.seen;
}
const fed = memoizeOne(feed);
const sink = createSink();
console.log(fed(sink), sink.value, sink.seen, Object.keys(sink).join());
delete sink.value;
sink.value = 11;
console.log(sink.value, sink.seen, feed(sink), Object.keys(sink).join());
