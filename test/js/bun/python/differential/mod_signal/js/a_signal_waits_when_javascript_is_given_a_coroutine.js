// JS calls an object of Python's that is no function: a partial, an instance with a __call__, a bound method, a class. A signal arrives while it is called. The handler is called before JS has the
// result, as it is for a caller in Python. Here the result is a coroutine, for which JS is given a promise: that is made behind the look for signals. (Once the look left an exception check open
// that the making of the promise then found: a debug build with BUN_JSC_validateExceptionChecks=1 ended there.)
import py from "./a_signal_waits_when_javascript_is_given_a_coroutine.py";
import { kwargs } from "bun:python";
const roads = [
  ["a partial", () => py.a_partial()()],
  ["a partial, with kwargs({})", () => py.a_partial()(kwargs({}))],
  ["an instance with a __call__", () => py.an_instance()()],
  ["a bound method", () => py.a_bound_method()()],
  ["a class", () => py.a_class()()],
  ["a class, with kwargs({})", () => py.a_class()(kwargs({}))],
  ["a class whose class has a __call__", () => py.a_class_whose_class_has_a_call()()],
  ["a method written in C", () => py.a_method_written_in_c()()],
];
for (const handler of ["notes", "raises"]) {
  py.handle_with(py[handler]);
  for (const [name, call] of roads) {
    let got;
    try {
      const result = call();
      got = result instanceof Promise ? "JS is given a promise of '" + (await result) + "'" : "JS IS GIVEN " + String(result);
    } catch (error) {
      got = "JS catches " + String(error);
    }
    console.log(`the handler ${handler}; ${name}: ${py.take()}; ${got}`);
  }
}
