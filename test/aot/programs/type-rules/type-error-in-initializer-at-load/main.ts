// TypeScript lets a program break a type in a few known ways. Where a field then holds another kind, --aot throws a TypeError at the typed read; null, undefined and a missing member pass. Where it throws in the initializer of a top-level constant, the error is thrown while the module is loaded, not when the constant is first read.
async function load(name: string, importing: () => Promise<{ made: unknown }>): Promise<void> {
  let loaded = false;
  try {
    const module = await importing();
    loaded = true;
    console.log(name + ":", JSON.stringify(module.made));
  } catch (error) {
    console.log(name + ":", (error as Error).name, loaded ? "when it was read" : "while it was loaded");
  }
}
await load("a class field written through an interface", () => import("./a-class-field-written-through-an-interface"));
await load("a field written through a wider view", () => import("./a-field-written-through-a-wider-view"));
await load("a number written as a string through a union", () => import("./a-number-written-as-a-string-through-a-union"));
await load("an optional member cleared through a parameter", () => import("./an-optional-member-cleared-through-a-parameter"));
await load("a method parameter that varies both ways", () => import("./a-method-parameter-that-varies-both-ways"));
