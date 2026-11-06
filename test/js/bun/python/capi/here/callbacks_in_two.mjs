// A prototype with the flag of a PyDLL, over a function of Python's or one of ctypes' own, needs no C API: it works in every interpreter, and takes the API from none.
import { Worker, isMainThread } from "node:worker_threads";
import builtins from "python:builtins";
import ctypes from "python:ctypes";

const who = isMainThread ? "main" : "worker";
const call = builtins.eval(
  "lambda ctypes: (ctypes.PYFUNCTYPE(ctypes.c_int, ctypes.c_int)(lambda x: x + 1)(3), ctypes.string_at(b'abc', 2), ctypes.PYFUNCTYPE(ctypes.py_object, ctypes.py_object)(lambda x: [x])('s'))",
  builtins.dict(),
);
function useTheAPI() {
  try {
    const lib = ctypes.PyDLL(process.argv[2]);
    lib.count.argtypes = [ctypes.py_object];
    return Number(lib.count([1, 2])) > 1;
  } catch (e) {
    return String(e.message).trim().split("\n").at(-1);
  }
}

if (isMainThread) {
  // The worker is the first to do any of it.
  const worker = new Worker(new URL(import.meta.url), { argv: [process.argv[2]] });
  await new Promise(resolve => worker.once("exit", resolve));
}
console.log(who, String(call(ctypes)));
if (isMainThread) console.log(who, "has the API:", useTheAPI());
