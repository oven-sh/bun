// The path of import() is put together at run time from a folder that is written out. Nothing else names the files of that folder or what they export.
for (const name of ["red", "green"]) {
  const module = await import("./colors/" + name + ".ts");
  console.log(module.describe(), module.default());
}
const last = "blue";
const module = await import(`./colors/${last}.ts`);
console.log(module.describe(), await module.default());
