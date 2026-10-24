// `let size!: number` promises that the variable is assigned before it is read. Nothing tests the promise: a read that finds the variable unassigned gives `undefined`, which passes every written type.
let loaded = false;
try {
  const module = await import("./made");
  loaded = true;
  console.log(JSON.stringify(module.made));
} catch (error) {
  console.log((error as Error).name, loaded ? "when it was read" : "while it was loaded");
}
