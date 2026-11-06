// The sampling profiler stops the thread with a signal, and what handles that uses the thread's own stack. Nothing is safe below the stack pointer,
// so f(*t) must not fill the frame of f there.
import { profile } from "bun:jsc";
import m from "./022_spread_calls_under_the_profiler.py";

let wrong;
profile(() => { wrong = m.work(); }, 20);
console.log("wrong:", wrong);
