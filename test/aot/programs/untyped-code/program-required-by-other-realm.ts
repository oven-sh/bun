// A program that was compiled ahead of time cannot be loaded again in a realm that is made at run time: the SyntaxError says that --aot is why. The build admits code at run time, or the load by a computed name would be refused before the realm is asked.
export const value = "the value";
if (!(globalThis as any).isTheOtherRealm) {
  const realm = new (globalThis as any).ShadowRealm();
  realm.evaluate("globalThis.isTheOtherRealm = true");
  try {
    console.log(await realm.importValue(import.meta.url, "value"));
  } catch (e: any) {
    console.log(e.name + ": " + String(e.message).replace(/The module \S+ /, "The module .. "));
  }
}
