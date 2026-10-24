// Strings chosen by a condition are pieces of a template that is itself chosen by a condition and then concatenated.
function describe(item, colors) {
  const kind = item.isClass ? "a-class" : "a-function";
  const color = item.isClass ? colors.classes : colors.functions;
  const first = item.isAsync ? `async ` : "";
  const second = item.isGenerator ? `*` : "";
  const label = item.isClass ? `[class ${item.name}]` : `[${first}${second}function ${item.name}]`;
  return `<i class="${kind}" style="${color}">` + label + "</i>";
}
console.log(describe({ name: "f", isAsync: true }, { classes: "red", functions: "blue" }));
console.log(describe({ name: "C", isClass: true }, { classes: "red", functions: "blue" }));
console.log(describe({ name: "g", isGenerator: true }, { classes: "red", functions: "blue" }));
console.log(describe({ name: "h", isAsync: true, isGenerator: true }, { classes: "red" }));
console.log(describe({}, {}));
