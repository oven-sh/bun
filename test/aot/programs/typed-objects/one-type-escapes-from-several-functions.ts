// Several functions hand values of one type to a place whose type says nothing. Each function has to say so for itself: the first one of each pair is never called, so nothing it says counts. Untyped code then calls the members with plain data that fits the parameter types, and freezes two of the objects. The output must match plain Bun.
interface Point { x: number; y: number }
interface Options { origin: Point; label: string; scale?: number }
interface Handler { on(point: Point): number | string; configure(options: Options): string; name: string }
class Counter {
  count = 0;
  add(point: Point): number | string { this.count++; return point.x + point.y; }
}
type Listener = (point: Point, options: Options) => string;

const held: any[] = [];
function keep(value: any): void { held.push(value); }

function handlerNeverHandedOver(handler: Handler): void { keep(handler); }
function handlerHandedOver(handler: Handler): void { keep(handler); }
function counterNeverHandedOver(counter: Counter): void { keep(counter); }
function counterHandedOver(counter: Counter): void { keep(counter); }
function listenerNeverHandedOver(listener: Listener): void { keep(listener); }
function listenerHandedOver(listener: Listener): void { keep(listener); }
function listNeverHandedOver(list: Handler[]): void { keep(list); }
function listHandedOver(list: Handler[]): void { keep(list); }
function literalNeverHandedOver(point: Point): void { keep({ point, tags: [point] }); }
function literalHandedOver(point: Point): void { keep({ point, tags: [point] }); }

const handler: Handler = {
  on(point) { return point.x + point.y; },
  configure(options) { return options.label + ":" + options.origin.x + ":" + (options.scale ?? "none"); },
  name: "first",
};
const other: Handler = {
  on(point) { return point.y; },
  configure(options) { return String(options.origin.y); },
  name: "second",
};
const counter = new Counter();
const listener: Listener = (point, options) => point.x + "/" + options.label + "/" + options.origin.y;
const corner: Point = { x: 3, y: 4 };

handlerHandedOver(handler);
counterHandedOver(counter);
listenerHandedOver(listener);
listHandedOver([other]);
literalHandedOver(corner);

const [anyHandler, anyCounter, anyListener, anyList, anyLiteral] = held;
const parsed = (text: string): any => JSON.parse(text);
console.log(anyHandler.on(parsed('{"x":1,"y":2}')), anyHandler.on({ x: 1.5, y: 2, z: "more" }), anyHandler.name);
console.log(anyHandler.configure(parsed('{"origin":{"x":5,"y":6},"label":"parsed"}')), anyHandler.configure({ origin: { x: 8, y: 9 }, label: "literal", scale: 2 }));
console.log(anyCounter.add(parsed('{"x":1,"y":10}')), anyCounter.add({ x: 2, y: 3 }), anyCounter.count, counter.count);
console.log(anyListener(parsed('{"x":4,"y":0}'), parsed('{"label":"both","origin":{"x":0,"y":11}}')));
console.log(anyList[0].on(parsed('{"x":0,"y":12}')), anyList[0].configure({ origin: parsed('{"x":0,"y":13}'), label: "" }));
Object.freeze(anyLiteral.point);
try { corner.x = 10; } catch (error) { console.log((error as Error).constructor.name); }
console.log(corner.x, corner.y, Object.isFrozen(corner), anyLiteral.tags[0] === corner);
Object.freeze(anyCounter);
try { counter.add({ x: 1, y: 1 }); } catch (error) { console.log((error as Error).constructor.name); }
console.log(counter instanceof Counter, counter.count, Object.isFrozen(counter));
console.log(handler.on({ x: 1, y: 2 }), other.on(corner), listener(corner, { origin: corner, label: "typed" }));
