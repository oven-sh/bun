// The typed writer writes a typed object's undeclared keys itself, below another object and at the top: the engine's own writer is not asked.
declare const aotRuntimeCounters: () => string;
const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]);
declare const aotOperationCount: undefined | ((name: string) => number);
interface Point { x: number; y: number; label?: string }
interface Segment { id: number; from: Point; to: Point }
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const finished = () => (counted ? (counted("operationAOTJSONWriterFinish") - writersFailed()) : 0);
function measure(label: string, run: () => string, isWrittenByTypedWriter: boolean): void {
  for (let i = 0; i < 10; i++) run();
  const before = finished();
  let length = 0;
  for (let i = 0; i < 100; i++) length += run().length;
  console.log(label + ": " + length + " characters", counted ? finished() - before === (isWrittenByTypedWriter ? 100 : 0) : true);
}
const plainPoint = JSON.parse<Point>('{"x":1,"y":2}');
measure("no undeclared key", () => JSON.stringify(plainPoint), true);
const one = JSON.parse<Point>('{"x":1,"y":2,"o":3}');
measure("one undeclared key", () => JSON.stringify(one), true);
const several = JSON.parse<Point>('{"a":[1,2],"x":1,"b":{"c":"d"},"y":2,"label":"l","e":null,"f":"g"}');
measure("undeclared keys in three places", () => JSON.stringify(several), true);
const below = JSON.parse<Segment>('{"id":1,"from":{"x":1,"y":2,"o":3},"to":{"p":4,"x":1,"y":2}}');
measure("undeclared keys below", () => JSON.stringify(below), true);
const told = JSON.parse<Point>('{"x":1,"y":2,"o":3}');
(told as any).toJSON = () => "told";
measure("toJSON of its own", () => JSON.stringify(told), false);
