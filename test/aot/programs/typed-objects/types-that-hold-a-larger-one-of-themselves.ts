interface Grow<T> { value: T; more?: Grow<Grow<T>> }
interface Key { key: number }
interface Holder<T> { held: T; inner?: Holder<Holder<T> & Key> }
interface Left<T> { item: T; right?: Right<T[]> }
interface Right<T> { item: T; left?: Left<T[]> }
type Pair<T> = { first: T; rest?: Pair<[T, T]> };
interface WithCall<T> { value: T; run?: () => number; more?: WithCall<WithCall<T>> }
class Made { size = 2 }
interface WithInstance<T> { value: T; made?: Made; more?: WithInstance<WithInstance<T>> }

function grow(): Grow<Key> {
  return { value: { key: 1 }, more: { value: { value: { key: 2 } } } };
}
function hold(h: Holder<Key>): Holder<Key> {
  return h;
}
function parsed<T>(text: string): T {
  return JSON.parse(text);
}

const grown = grow();
const key: Key = { key: 3 };
const held = hold({ held: key, inner: { held: Object.assign({ held: key }, key) } });
const left: Left<number> = { item: 4, right: { item: [5], left: { item: [[6]] } } };
const pair: Pair<number> = { first: 7, rest: { first: [8, 9] } };
const called: WithCall<Key> = { value: key, run: () => 10, more: { value: { value: key } } };
const instance: WithInstance<Key> = { value: key, made: new Made(), more: { value: { value: key, made: new Made() } } };
const far = parsed<Grow<Key>>('{"value":{"key":11},"more":{"value":{"value":{"key":12}},"more":{"value":{"value":{"value":{"key":13}}}}}}');

console.log(grown.value.key, grown.more?.value.value.key, held.held.key, held.inner?.held.key, held.inner?.held.held.key);
console.log(left.item, left.right?.item[0], left.right?.left?.item[0][0], pair.first, pair.rest?.first[1]);
console.log(called.run?.(), called.more?.value.value.key, instance.made?.size, instance.more?.value.made?.size);
console.log(far.value.key, far.more?.value.value.key, far.more?.more?.value.value.value.key);
