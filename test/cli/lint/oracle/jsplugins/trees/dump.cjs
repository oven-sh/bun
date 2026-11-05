"use strict";
// Empty for what an assignment makes.
function attributesOf(descriptor) {
  const { writable, enumerable, configurable } = descriptor;
  if ("value" in descriptor)
    return writable && enumerable && configurable
      ? ""
      : `(${[writable, enumerable, configurable].map(Number).join("")})`;
  return `(${descriptor.get ? "get " : ""}${descriptor.set ? "set " : ""}${[enumerable, configurable].map(Number).join("")})`;
}

function show(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof RegExp) return `RegExp ${value}`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  const prototype = Object.getPrototypeOf(value);
  const name = prototype === Object.prototype ? "" : `${prototype.constructor.name} `;
  const properties = Reflect.ownKeys(value).map(key => {
    const shown = `${String(key)}${attributesOf(Object.getOwnPropertyDescriptor(value, key))}`;
    // The tests of the tokens look into these.
    if (key === "tokens" || key === "comments") return `${shown}: ${value[key].length}`;
    return `${shown}: ${key === "parent" ? value[key] && `${value[key].type}[${value[key].range}]` : show(value[key])}`;
  });
  return `${name}{ ${properties.join(", ")} }`;
}

// Reports the whole tree of a file as one message: every own property of every object in order, with its attributes, the class of what
// isn't a plain object, and `sourceCode.visitorKeys`.
const tree = {
  create: context => ({
    // All nodes have their `parent` by then.
    "Program:exit"(node) {
      const keys = context.sourceCode.visitorKeys;
      const frozen = Object.isFrozen(keys) && Object.values(keys).every(Object.isFrozen);
      context.report({ node, message: `${show(node)}\n${frozen ? "frozen " : ""}${JSON.stringify(keys)}` });
    },
  }),
};
// Reports how the nodes of each type are laid out, and not what is in them: the own properties after `loc` has been read, and what they
// inherit from.
const shapes = {
  create: context => ({
    "Program:exit"(node) {
      const found = new Set();
      const keysOf = object =>
        Reflect.ownKeys(object).map(
          key => `${String(key)}${attributesOf(Object.getOwnPropertyDescriptor(object, key))}`,
        );
      (function visit(value) {
        if (Array.isArray(value)) return value.forEach(visit);
        if (value === null || typeof value !== "object" || value instanceof RegExp) return;
        const inherited = Object.getPrototypeOf(value) === Object.prototype ? "" : keysOf(Object.getPrototypeOf(value));
        if (typeof value.type === "string") visit(value.loc);
        found.add(`${value.type ?? ""} { ${keysOf(value).join(", ")} } ${inherited}`);
        for (const key of Object.keys(value)) if (!["parent", "tokens", "comments"].includes(key)) visit(value[key]);
      })(node);
      context.report({ node, message: [...found].sort().join("\n") });
    },
  }),
};
module.exports = { meta: { name: "dump" }, rules: { tree, shapes } };
