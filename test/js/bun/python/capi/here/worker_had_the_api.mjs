// The interpreter that has the API ends, and what it loaded is still there and goes on calling.
// Python begins in a thread when the first module of it is imported there: the worker is to be the first.
import { Worker, isMainThread } from "node:worker_threads";

const path = process.argv[2];
const python = async () => [(await import("python:ctypes")).default, (await import("python:gc")).default];
if (!isMainThread) {
  const [ctypes, gc] = await python();
  const lib = ctypes.PyDLL(path);
  lib.hold.argtypes = [ctypes.py_object];
  lib.hold.restype = null;
  lib.hold([1, 2, 3]);
  gc.collect();
  console.log("worker: held");
} else {
  const worker = new Worker(new URL(import.meta.url), { argv: [path] });
  await new Promise(resolve => worker.once("exit", resolve));
  const [ctypes, gc] = await python();
  // Without the GIL of anybody, and then with the GIL of an interpreter that the API is not for.
  const lib = ctypes.CDLL(path);
  lib.ask_about_what_is_held.restype = ctypes.c_char_p;
  console.log("main:", String(lib.ask_about_what_is_held().decode()));
  gc.collect();
  // Nothing stands behind the symbols of the types any more. Two of them are still two, and None is None.
  console.log(
    "main:",
    Number(ctypes.CDLL(path.replace("without_gil", "loaded")).identities_then_as_bits()).toString(2),
  );
  try {
    ctypes.PyDLL(path).ask_about_what_is_held();
  } catch (e) {
    console.log("main:", String(e.message).trim().split("\n").at(-1));
  }
}
