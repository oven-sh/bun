// `using` and `await using` bind names that nothing reads, and leaving the scope runs their disposers: at the top level when the module ends, in a block when the block ends. null and undefined dispose nothing. The resources are made by constants and classes that nothing else names.
const log: string[] = [];
const makeResource = (name: string) => ({ [Symbol.dispose]() { log.push("disposed " + name); } });
class Resource { constructor(public name: string) {} [Symbol.dispose]() { log.push("disposed " + this.name); } }
const asyncResource = { async [Symbol.asyncDispose]() { log.push("disposed asynchronously"); } };
const literal = { [Symbol.dispose]() { log.push("disposed a constant"); } };
const unusedResource = { [Symbol.dispose]() { log.push("never"); } };

{
  using first = makeResource("first");
  using second = new Resource("second");
  using third = literal;
  using nothing = null;
  using alsoNothing = undefined;
  await using fourth = asyncResource;
  log.push("end of the block");
}
function scoped() {
  using inFunction = makeResource("in a function");
  return "returned";
}
log.push(scoped());
(globalThis as any).process.on("exit", () => console.log(log.join("\n")));
using atTopLevel = makeResource("at the top level");
using alsoAtTopLevel = new Resource("also at the top level");
await using asyncAtTopLevel = asyncResource;
log.push("end of the module");
