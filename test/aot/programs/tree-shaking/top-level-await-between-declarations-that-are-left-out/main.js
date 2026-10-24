// Awaits stand before, between and after declarations that nothing uses. What is observable is the order: of this module's own lines, of jobs that were queued, and of the modules that import each other.
import { order } from "./order.js";
import "./awaits-first.js";
import "./awaits-last.js";

const unusedBefore = { a: 1 };
order.push("main starts");
queueMicrotask(() => order.push("a job queued by main"));
const unusedBetween = [1, 2];
await null;
class UnusedAfterAwait {}
order.push("main after its first await");
const usedAfterAwait = await Promise.resolve("a value that was awaited");
const unusedAwaited = await Promise.resolve(order.push("an awaited value nothing reads"));
const unusedLast = "text";
order.push(usedAfterAwait);
console.log(order.join("\n"));
