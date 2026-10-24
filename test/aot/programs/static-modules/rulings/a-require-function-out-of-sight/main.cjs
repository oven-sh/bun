// A `require` function that the compiler loses sight of. Under `bun run` its `main` leads to the module object of the entry point, and from there to every module. In an executable `main`, `children` and `parent` of an object that went out of sight answer undefined, as in `bun build --compile` without --aot. The expected output is written down.
require("./a.cjs");
const r = [require][0];
try {
  console.log(r.main.children[0].exports.x);
} catch (error) {
  console.log(error.constructor.name);
}
