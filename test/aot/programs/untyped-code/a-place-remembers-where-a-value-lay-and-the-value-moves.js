// Each read stands at one place in the text and comes again and again, so the place remembers where the value lay for objects of one kind.
// Then the value moves, is hidden, goes away or turns into a getter, with and without a change to the object that is asked.
function readX(o) {
  return o.x;
}
function readM(o) {
  return o.m;
}
function readBoth(o) {
  return o.x + "|" + o.m;
}
function warm(read, o) {
  let last;
  for (let i = 0; i < 3000; i++) last = read(o);
  return last;
}
function attempt(read, o) {
  try {
    return String(read(o));
  } catch (error) {
    return error.constructor.name;
  }
}
const plain = text => JSON.parse(text);

{
  const o = plain('{"x":1}');
  console.log("own", warm(readX, o));
  o.x = 2;
  console.log(readX(o));
  delete o.x;
  console.log(readX(o));
  o.x = 3;
  console.log(warm(readX, o));
  Object.defineProperty(o, "x", {
    get() {
      return "getter";
    },
    configurable: true,
  });
  console.log(warm(readX, o));
  Object.defineProperty(o, "x", { value: 4 });
  console.log(warm(readX, o));
}
{
  const o = plain("{}");
  for (let i = 0; i < 40; i++) o["k" + i] = i;
  o.x = "out of line";
  console.log(warm(readX, o));
  for (let i = 40; i < 90; i++) o["k" + i] = i;
  console.log(warm(readX, o));
  o.x = "stored again";
  console.log(readX(o));
  for (let i = 0; i < 80; i++) delete o["k" + i];
  console.log(warm(readX, o));
}
{
  const top = plain('{"m":"top"}');
  const middle = Object.create(top);
  const o = Object.create(middle);
  console.log("inherited", warm(readM, o));
  top.m = "top changed";
  console.log(readM(o), warm(readM, o));
  middle.m = "middle";
  console.log(readM(o), warm(readM, o));
  delete middle.m;
  console.log(readM(o), warm(readM, o));
  Object.defineProperty(top, "m", {
    get() {
      return "getter of " + (this === o);
    },
    configurable: true,
  });
  console.log(readM(o), warm(readM, o));
  delete top.m;
  console.log(readM(o), warm(readM, o));
  top.m = "back";
  console.log(readM(o), warm(readM, o));
  Object.setPrototypeOf(middle, plain('{"m":"other top"}'));
  console.log(readM(o), warm(readM, o));
  Object.setPrototypeOf(o, null);
  console.log(readM(o), warm(readM, o));
  o.m = "own";
  console.log(readM(o), warm(readM, o));
}
{
  function f() {}
  f.x = "of a function";
  console.log(warm(readX, f));
  f.x = "changed";
  console.log(readX(f));
  delete f.x;
  console.log(readX(f), warm(readX, f));
  const arrow = () => 1;
  console.log(warm(readX, arrow));
  arrow.x = "of an arrow";
  console.log(readX(arrow), warm(readX, arrow));
}
{
  const a = plain('{"x":"a","m":1}'),
    b = plain('{"m":2,"x":"b"}'),
    c = Object.create(a);
  let text = "";
  for (let i = 0; i < 9000; i++) text = readBoth(i % 3 === 0 ? a : i % 3 === 1 ? b : c);
  console.log("in turn", text, readBoth(a), readBoth(b), readBoth(c));
}
for (const value of [
  undefined,
  null,
  1,
  1.5,
  "text",
  true,
  Symbol.iterator,
  10n,
  [],
  new Map(),
  new Proxy({}, { get: (_, key) => "proxy " + String(key) }),
])
  console.log(typeof value, attempt(readX, value), attempt(readX, value));

class Message {
  constructor(url) {
    this.url = url;
    this.x = "field";
  }
  m() {
    return "method of the class";
  }
}
function callM(o) {
  return o.m();
}
function readUrl(o) {
  return o.url;
}
function readXOfMessage(o) {
  return o.x;
}
{
  const response = {
    m() {
      return "method of the other prototype";
    },
    __proto__: Message.prototype,
  };
  let last;
  for (let i = 0; i < 3000; i++) {
    const message = new Message("/" + i);
    Object.setPrototypeOf(message, response);
    message.extra = i;
    last = [readUrl(message), readXOfMessage(message), callM(message), message.extra].join(" ");
  }
  console.log(last);
  const message = new Message("/kept");
  Object.setPrototypeOf(message, response);
  console.log(warm(callM, message), warm(readXOfMessage, message), warm(readUrl, message));
  response.m = () => "replaced";
  console.log(callM(message), warm(callM, message));
  delete response.m;
  console.log(callM(message), warm(callM, message));
  message.m = () => "own";
  console.log(callM(message), warm(callM, message));
  response.x = "not seen";
  console.log(readXOfMessage(message));
  delete message.x;
  console.log(readXOfMessage(message), warm(readXOfMessage, message));
  delete response.x;
  console.log(readXOfMessage(message), warm(readXOfMessage, message));
}
{
  let sum = 0;
  for (let round = 0; round < 6; round++) {
    const holder = plain('{"m":' + round + "}");
    for (let i = 0; i < 2000; i++) sum += readM(Object.create(holder));
    Bun.gc(true);
  }
  console.log("after collections", sum);
}
