// Plain objects that untyped code made and that refer to themselves, directly or through another, enter typed functions again and again.
type Ring = { name: string; partner: Ring | null };
type Pair = { id: number; first: Ring; second: Ring | null };

function ringText(ring: Ring): string {
  return ring.name + ">" + (ring.partner === null ? "nobody" : ring.partner.name);
}
function pairText(pair: Pair): string {
  return pair.id + ":" + ringText(pair.first) + "," + (pair.second === null ? "none" : ringText(pair.second));
}
const ringOf = (name: string): any => {
  const ring: any = { name };
  ring.partner = null;
  return ring;
};
const pairOf = (id: number, first: unknown, second: unknown): any => {
  const pair: any = { id };
  pair.first = first;
  pair.second = second;
  return pair;
};

for (let round = 0; round < 5; round++) {
  const alone = ringOf("alone");
  alone.partner = alone;
  console.log("its own partner", round, ringText(alone), alone.partner === alone, alone.partner.partner.partner === alone);

  const left = ringOf("left");
  const right = ringOf("right");
  left.partner = right;
  right.partner = left;
  console.log("two partners", round, ringText(left), ringText(right), left.partner.partner === left, right.partner === left);

  const one = ringOf("one");
  const two = ringOf("two");
  const three = ringOf("three");
  one.partner = two;
  two.partner = three;
  three.partner = one;
  console.log("three in a ring", round, ringText(two), ringText(one), ringText(three), one.partner.partner.partner === one);

  const shared = ringOf("shared");
  const pair = pairOf(round, shared, shared);
  console.log("one ring held twice", round, pairText(pair), pair.first === pair.second, pair.first === shared);

  const tail = ringOf("tail");
  const head = ringOf("head");
  head.partner = tail;
  console.log("a ring and what it points to", round, pairText(pairOf(round, head, tail)), head.partner === tail);

  const looped = ringOf("looped");
  looped.partner = looped;
  console.log("a pair of one that refers to itself", round, pairText(pairOf(round, looped, looped)), pairText(pairOf(round, ringOf("fresh"), looped)));
}
