// throws.js throws at its top level, and this file catches that. Before the throw it has handed out `below`, which is declared after the throw and holds the only references to what is declared before it.
try {
  await import("./throws.js");
} catch (error) {
  console.log("caught: " + error.message);
}
console.log(globalThis.handedOut());
