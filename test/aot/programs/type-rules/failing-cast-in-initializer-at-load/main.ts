// A cast to an object type lets any object through. A typed read behind a cast that finds a value of another kind throws a TypeError while the initializer of a top-level constant runs: that is while the module is loaded, not when the constant is first read.
async function load(name: string, importing: () => Promise<{ made: unknown }>): Promise<void> {
  let loaded = false;
  try {
    const module = await importing();
    loaded = true;
    console.log(name + ":", typeof module.made);
  } catch (error) {
    console.log(name + ":", (error as Error).name, loaded ? "when it was read" : "while it was loaded");
  }
}
await load("a record as a class", () => import("./a-record-as-a-class"));
await load("a list as a class", () => import("./a-list-as-a-class"));
await load("a function as a class or null", () => import("./a-function-as-a-class-or-null"));
await load("a record as a class with a private field", () => import("./a-record-as-a-class-with-a-private-field"));
await load("a list as an error", () => import("./a-list-as-an-error"));
await load("a getter as a field that holds a function", () => import("./a-getter-as-a-field-that-holds-a-function"));
await load("a string read as a number", () => import("./a-string-read-as-a-number"));
await load("a number read as an object", () => import("./a-number-read-as-an-object"));
