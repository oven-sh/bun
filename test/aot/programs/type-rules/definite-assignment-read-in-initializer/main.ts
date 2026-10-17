// `let size!: number` promises that the variable is assigned before it is read. --aot throws a TypeError at a read that finds it unassigned. In a function that the initializer of a top-level constant calls, the error is thrown while the module is loaded, not when the constant is first read.
let loaded = false;
try {
  const module = await import("./made");
  loaded = true;
  console.log(JSON.stringify(module.made));
} catch (error) {
  console.log((error as Error).name, loaded ? "when it was read" : "while it was loaded");
}
