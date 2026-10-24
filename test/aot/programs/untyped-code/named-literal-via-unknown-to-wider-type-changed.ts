// A named literal that is cast through `unknown` to a wider written type: stores that the wider type allows are seen through both names.
const third = { size: 3, tail: { k: 3, last: "g" } };
const wide = third as unknown as { size: number | string; tail: { k: number; last?: string } };
wide.tail = { k: 30 };
wide.size = "many";
console.log(third.tail.k, third.tail.last, String(third.size), JSON.stringify(third), wide === (third as unknown));
