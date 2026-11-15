// Of two component files one has nothing to remember: the compiler gives it no cache, and it is compiled as it is written. The other runs as the compiler's output.
import { Plain, total } from "./Plain";
import { Remembered } from "./Remembered";

console.log(Plain(), total([1, 2, 3]), Remembered({ title: "kept" }));
