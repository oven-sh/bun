// A helper wraps what it was passed into a new object, a closure or an array. Each caller looks into its own, and one of them changes it.
function pair<A, B>(left: A, right: B) {
  return { left, right };
}
function boxed<T>(value: T) {
  return { get: () => value, set: (next: T) => void (value = next) };
}
function listOf<T>(...items: T[]): T[] {
  return items;
}
class Holder<T> {
  constructor(public held: T) {}
  replace(next: T): T {
    const old = this.held;
    this.held = next;
    return old;
  }
}
function hold<T>(value: T): Holder<T> {
  return new Holder(value);
}
class Coin {
  constructor(public cents: number) {}
}
class Card {
  constructor(public owner: string) {}
}
const lines: string[] = [];
for (let i = 0; i < 3; i++) {
  const coins = pair(new Coin(i), new Coin(i + 1));
  const cards = pair(new Card("a" + i), i);
  const odd = pair("text", undefined);
  lines.push(coins.left.cents + coins.right.cents + " " + cards.left.owner + cards.right + " " + odd.left + odd.right);
  const coinBox = boxed(new Coin(5));
  const cardBox = boxed(new Card("c"));
  const numberBox = boxed(1.5);
  coinBox.set(new Coin(6 + i));
  lines.push(coinBox.get().cents + " " + cardBox.get().owner + " " + numberBox.get());
  lines.push(listOf(new Coin(1), new Coin(2)).map(c => c.cents).join() + " " + listOf("a", "b")[1] + " " + listOf<number>().length + " " + listOf(new Card("z"))[0].owner);
  const coinHolder = hold(new Coin(i));
  const cardHolder = hold(new Card("h" + i));
  lines.push(coinHolder.replace(new Coin(50)).cents + " " + coinHolder.held.cents + " " + cardHolder.replace(new Card("new")).owner + " " + cardHolder.held.owner + " " + hold(i).held + " " + hold("s").replace("t"));
  (coins as any).left = "no coin any more";
  lines.push(String(coins.left) + " " + pair(new Coin(9), 0).left.cents);
}
console.log(lines.join("\n"));
