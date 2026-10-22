// The units are generators, async functions and async generators, reached through yield*, await, for-await and a return of a call. Each calls a plain helper that nothing else names.
import { outer, countdown, pipeline } from "./flows";

console.log([...outer()].join());
console.log(await countdown(2));
for await (const value of pipeline()) console.log(value);
