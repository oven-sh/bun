// Constants whose functions and objects name each other in rings. One ring nobody enters; one is entered from this file; one runs through two files and is entered from a third.
import { enter } from "./enter.js";

const a = () => b;
const b = () => c;
const c = () => a;

const ping = n => (n === 0 ? "ping" : pong(n - 1));
const pong = n => (n === 0 ? "pong" : pang.run(n - 1));
const pang = { run: n => (n === 0 ? "pang" : ping(n - 1)) };

class Hen { static lays() { return Egg; } }
class Egg { static hatches() { return Hen; } }

console.log(ping(4), ping(5), Hen.lays().hatches() === Hen);
console.log(enter());
