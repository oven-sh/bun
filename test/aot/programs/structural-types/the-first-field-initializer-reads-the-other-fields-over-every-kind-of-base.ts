interface Fields {
  title: string;
  count: number;
  ratio: number;
  ready: boolean;
  list: number[];
  inner: { depth: number };
}

function attempt(body: () => unknown): string {
  try {
    return String(body());
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

class Own {
  base = "own";
}

function peekAlone(c: Alone): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class Alone implements Fields {
  early: string = peekAlone(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new Alone();
  console.log("no base" + ", before the other fields: " + made.early);
  console.log("no base" + ", afterwards: " + peekAlone(made));
}

function peekOverOwn(c: OverOwn): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverOwn extends Own implements Fields {
  early: string = peekOverOwn(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverOwn();
  console.log("a class of the program" + ", before the other fields: " + made.early);
  console.log("a class of the program" + ", afterwards: " + peekOverOwn(made));
}

function peekOverSet(c: OverSet): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverSet extends Set<number> implements Fields {
  early: string = peekOverSet(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverSet();
  console.log("Set" + ", before the other fields: " + made.early);
  console.log("Set" + ", afterwards: " + peekOverSet(made));
}

function peekOverMap(c: OverMap): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverMap extends Map<string, number> implements Fields {
  early: string = peekOverMap(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverMap();
  console.log("Map" + ", before the other fields: " + made.early);
  console.log("Map" + ", afterwards: " + peekOverMap(made));
}

function peekOverArray(c: OverArray): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverArray extends Array<number> implements Fields {
  early: string = peekOverArray(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverArray();
  console.log("Array" + ", before the other fields: " + made.early);
  console.log("Array" + ", afterwards: " + peekOverArray(made));
}

function peekOverError(c: OverError): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverError extends Error implements Fields {
  early: string = peekOverError(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverError();
  console.log("Error" + ", before the other fields: " + made.early);
  console.log("Error" + ", afterwards: " + peekOverError(made));
}

function peekOverDate(c: OverDate): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverDate extends Date implements Fields {
  early: string = peekOverDate(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverDate();
  console.log("Date" + ", before the other fields: " + made.early);
  console.log("Date" + ", afterwards: " + peekOverDate(made));
}

function peekOverRegExp(c: OverRegExp): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverRegExp extends RegExp implements Fields {
  early: string = peekOverRegExp(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverRegExp("x");
  console.log("RegExp" + ", before the other fields: " + made.early);
  console.log("RegExp" + ", afterwards: " + peekOverRegExp(made));
}

function peekOverBytes(c: OverBytes): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverBytes extends Uint8Array implements Fields {
  early: string = peekOverBytes(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverBytes();
  console.log("Uint8Array" + ", before the other fields: " + made.early);
  console.log("Uint8Array" + ", afterwards: " + peekOverBytes(made));
}

function peekOverTarget(c: OverTarget): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverTarget extends EventTarget implements Fields {
  early: string = peekOverTarget(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverTarget();
  console.log("EventTarget" + ", before the other fields: " + made.early);
  console.log("EventTarget" + ", afterwards: " + peekOverTarget(made));
}

function peekOverWeakMap(c: OverWeakMap): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverWeakMap extends WeakMap<object, number> implements Fields {
  early: string = peekOverWeakMap(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverWeakMap();
  console.log("WeakMap" + ", before the other fields: " + made.early);
  console.log("WeakMap" + ", afterwards: " + peekOverWeakMap(made));
}

function peekOverBuffer(c: OverBuffer): string {
  return [typeof c.title, typeof c.count, typeof c.ratio, typeof c.ready, typeof c.list, typeof c.inner, String(c.count), String(c.ratio), c.ready ? "true arm" : "false arm", attempt(() => c.title.length), attempt(() => c.list[0]), attempt(() => c.inner.depth), attempt(() => c.count + 1)].join(" ");
}

class OverBuffer extends ArrayBuffer implements Fields {
  early: string = peekOverBuffer(this);
  title = "title";
  count = 7;
  ratio = 0.5;
  ready = true;
  list = [1, 2];
  inner = { depth: 1 };
}

{
  const made = new OverBuffer(8);
  console.log("ArrayBuffer" + ", before the other fields: " + made.early);
  console.log("ArrayBuffer" + ", afterwards: " + peekOverBuffer(made));
}

export {};
