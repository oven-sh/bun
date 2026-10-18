type Item = { sku: string; quantity: number };
type Line = { item: Item; price: number; note: string | null };
const makeItem = (sku: string, quantity: number): Item => ({ sku, quantity });
const makeLine = (item: Item, price: number): Line => ({ item, price, note: null });
const plain = (text: string): any => JSON.parse(text);
function sumItems(items: Item[]): number {
  let sum = 0;
  for (let i = 0; i < items.length; i++) sum += items[i].sku.length + items[i].quantity;
  return sum;
}
function sumItemsInTurn(items: Item[]): number {
  let sum = 0;
  for (const item of items) sum += item.sku.length + item.quantity;
  return sum;
}
function sumLines(lines: Line[]): number {
  let sum = 0;
  for (const line of lines) sum += line.item.quantity * line.price + (line.note === null ? 0 : line.note.length);
  return sum;
}
const hand: (value: any) => any = [(value: any) => value, (value: any) => [value]][JSON.parse("0")];
function sumItemsInLoop(value: any, times = 1): number {
  let last = 0;
  for (let i = 0; i < times; i++) last = sumItems(hand(value));
  return last;
}
function sumItemsInTurnInLoop(value: any, times = 1): number {
  let last = 0;
  for (let i = 0; i < times; i++) last = sumItemsInTurn(hand(value));
  return last;
}
function sumLinesInLoop(value: any, times = 1): number {
  let last = 0;
  for (let i = 0; i < times; i++) last = sumLines(hand(value));
  return last;
}
const show = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};
console.log(sumItemsInLoop([makeItem("a", 1)]), sumItemsInTurnInLoop([makeItem("b", 2)]), sumLinesInLoop([makeLine(makeItem("c", 3), 2)]));
for (let turn = 0; turn < 3; turn++) {
  const text = `[{"sku":"x${turn}","quantity":${turn}},{"sku":"yy","quantity":2.5},{"sku":"","quantity":-0}]`;
  const parsed = plain(text);
  const held = [...parsed];
  show("parsed", () => sumItemsInLoop(parsed) + " " + JSON.stringify(parsed));
  show("parsed again", () => sumItemsInTurnInLoop(parsed) + " " + parsed.every((item: any, i: number) => item === held[i]) + " " + Object.keys(parsed[0]).join());
  const inTurn = plain(text);
  show("in turn first", () => sumItemsInTurnInLoop(inTurn) + " " + sumItemsInLoop(inTurn) + " " + JSON.stringify(inTurn));
  const mixed = plain('[0,{"sku":"plain","quantity":2},{"quantity":3,"sku":"other order"},{"sku":"more","quantity":4,"more":true}]');
  mixed[0] = makeItem("typed", 1);
  show("mixed", () => sumItemsInLoop(mixed) + " " + JSON.stringify(mixed));
  mixed[1].quantity = 20;
  mixed[3].late = 1;
  show("mixed after stores", () => sumItemsInTurnInLoop(mixed) + " " + JSON.stringify(mixed));
  const twice = plain('{"sku":"twice","quantity":1}');
  const several: any[] = [twice, twice, twice];
  show("one object three times", () => sumItemsInLoop(several) + " " + sumItemsInTurnInLoop(several) + " " + (several[0] === several[2]));
  const lines = plain('[{"item":{"sku":"n","quantity":2},"price":3,"note":null},{"item":{"sku":"m","quantity":1},"price":0.5,"note":"note"}]');
  const child = lines[0].item;
  show("nested", () => sumLinesInLoop(lines) + " " + JSON.stringify(lines) + " " + (lines[0].item === child));
  show("nested again", () => sumLinesInLoop(lines));
  const withTypedChild = plain('[{"item":null,"price":2,"note":null}]');
  withTypedChild[0].item = makeItem("t", 2);
  show("a typed child", () => sumLinesInLoop(withTypedChild) + " " + JSON.stringify(withTypedChild));
  const shared = plain('[{"item":null,"price":2,"note":null},{"item":null,"price":3,"note":"n"}]');
  shared[0].item = shared[1].item = plain('{"sku":"shared","quantity":5}');
  show("a shared child", () => sumLinesInLoop(shared) + " " + (shared[0].item === shared[1].item));
  const withHole = plain('[{"sku":"a","quantity":1},0,{"sku":"b","quantity":2}]');
  delete withHole[1];
  show("a hole", () => sumItemsInLoop(withHole));
  show("null", () => sumItemsInLoop(plain('[{"sku":"a","quantity":1},null]')));
  show("a number", () => sumItemsInLoop(plain('[{"sku":"a","quantity":1},7]')));
  show("a wrong field", () => sumItemsInLoop(plain('[{"sku":"a","quantity":1},{"sku":1,"quantity":1}]')));
  show("a wrong field in turn", () => sumItemsInTurnInLoop(plain('[{"sku":"a","quantity":1},{"sku":"b","quantity":"1"}]')));
  show("a missing field", () => sumItemsInLoop(plain('[{"sku":"a"}]')));
  show("a wrong child", () => sumLinesInLoop(plain('[{"item":{"sku":"n","quantity":"2"},"price":3,"note":null}]')));
  const wrongLater = plain('[{"item":{"sku":"n","quantity":2},"price":"3","note":null}]');
  show("a good child of a wrong parent", () => sumLinesInLoop(wrongLater));
  show("and what is left of it", () => JSON.stringify(wrongLater) + " " + Object.keys(wrongLater[0].item).join());
  const withGetter = plain('[{"quantity":1}]');
  Object.defineProperty(withGetter[0], "sku", { get: () => "got", enumerable: true, configurable: true });
  show("a getter", () => sumItemsInLoop(withGetter));
  const frozen = plain('[{"sku":"f","quantity":1}]');
  Object.freeze(frozen[0]);
  show("frozen elements", () => sumItemsInLoop(frozen) + " " + Object.isFrozen(frozen[0]));
  show("a frozen array", () => sumItemsInLoop(Object.freeze(plain('[{"sku":"fa","quantity":1}]'))));
  const sealed = plain('[{"sku":"s","quantity":1}]');
  Object.seal(sealed[0]);
  show("sealed elements", () => sumItemsInLoop(sealed) + " " + Object.isSealed(sealed[0]));
  const inherits = plain('[{"quantity":1}]');
  Object.setPrototypeOf(inherits[0], plain('{"sku":"inherited"}'));
  show("an inherited field", () => sumItemsInLoop(inherits));
  show("empty", () => sumItemsInLoop(plain("[]")) + sumItemsInTurnInLoop(plain("[]")) + sumLinesInLoop(plain("[]")));
  const many: any[] = [];
  for (let i = 0; i < 50; i++) many.push(plain(i % 3 ? `{"sku":"s${i}","quantity":${i}}` : `{"quantity":${i},"sku":"r${i}"}`));
  show("many", () => sumItemsInLoop(many) + " " + sumItemsInTurnInLoop(many));
  const large = plain('[{"sku":"big","quantity":4294967296},{"sku":"small","quantity":-2147483648},{"sku":"tiny","quantity":1e-7}]');
  show("numbers", () => sumItemsInLoop(large) + " " + JSON.stringify(large));
  if (turn === 1 && typeof Bun !== "undefined") Bun.gc(true);
  show("held", () => sumItemsInLoop(held));
}
