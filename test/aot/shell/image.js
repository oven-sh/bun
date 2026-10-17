// jsc image.js -- <IR file> <image> [<host module>...]
// Compiles the front end's IR to an image for `jsc --aotImagePath`. There is one host module per entry point of the program, in
// order, each with a different source text: the shell finds the compiled module by the source text of the file it is given.
// The default is stub.js.
const stubs = arguments.slice(2).map(path => readFile(path));
const image = $vm.buildAOTImageOfTypedProgram(stubs.length > 1 ? stubs : stubs[0] ?? readFile("stub.js"), readFile(arguments[0], "binary"));
// Only an uncaught exception makes this shell exit with a non-zero code: `quit(1)` exits with 0.
if (image === null) throw new Error("not compiled");
writeFile(arguments[1], image);
