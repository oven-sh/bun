// for-of, spread, a pattern, for-await, an addition, instanceof, using, String.prototype.split and replace, Object.prototype.toString and Array.from call methods whose keys are well-known symbols.
import { Range, Ticks, Amount, Even, Resource, Comma, Tagged, log } from "./protocols";

console.log([...new Range(3)].join(), Array.from(new Range(2)).join(), Math.max(...new Range(5)));
const [first, second] = new Range(9);
console.log(first, second);
for (const value of new Range(1)) console.log("for-of", value);
for await (const tick of new Ticks()) console.log("for-await", tick);
console.log(`${new Amount()}`, +new Amount(), (new Amount() as any) + "");
console.log((2 as any) instanceof Even, (3 as any) instanceof Even);
{
  using resource = new Resource("sync");
  await using other = new Resource("async");
  log.push("in the block");
}
console.log(log.join(", "));
console.log("a,b".split(new Comma() as any), "a,b".replace(new Comma() as any, "-"));
console.log(Object.prototype.toString.call(new Tagged()));
