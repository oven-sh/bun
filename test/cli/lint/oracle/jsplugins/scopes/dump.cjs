"use strict";
// Two rules that report everything a rule can learn about the scopes of a file, as one message. `scopes/all` lists the scopes first.
// `scopes/references-first` first goes from each reference to its variable and asks the global scope for single names, which
// shows objects that are only filled in when something lists them.
//
// Left out, because `bun lint` differs there on purpose:
// - the methods of the prototypes that build or change the analysis, such as `__define` and `nestFunctionScope`
// - members whose name starts with `__`, apart from whether they exist
// - the numbers in `$id`
// - with typescript-eslint, the order of the variables of the global scope, where the libraries can define thousands
//
// The variables of the global scope that nothing in the file mentions are only counted, unless the name of the file has `globals`
// in it. There are hundreds, and a debug build takes long for each. For the same reason, what `sourceCode` and the manager say about
// each node is only there if the name of the file has `nodes` in it.

const at = node => `${node.type}[${node.range}]`;
const isNode = value => typeof value?.type === "string" && Array.isArray(value.range);
const attributesOf = it =>
  `${"value" in it ? "v" : `${it.get ? "g" : ""}${it.set ? "s" : ""}`}${it.writable ? "w" : ""}${it.enumerable ? "e" : ""}${it.configurable ? "c" : ""}`;
const ownOf = object =>
  Reflect.ownKeys(object).map(key => `${String(key)}:${attributesOf(Object.getOwnPropertyDescriptor(object, key))}`);

function classesOf(object) {
  const names = [];
  for (let it = Object.getPrototypeOf(object); it !== null && it !== Object.prototype; it = Object.getPrototypeOf(it))
    names.push(it.constructor.name);
  return names.join(" < ");
}

const members = {
  manager: ["scopes", "globalScope"],
  scope:
    `type block upper isStrict childScopes variableScope functionExpressionScope dynamic directCallToEvalScope thisFound
    taints variables references through set implicit`.split(/\s+/),
  variable: `name scope identifiers references defs tainted stack eslintUsed eslintExported eslintImplicitGlobalSetting
    eslintExplicitGlobal eslintExplicitGlobalComments writeable isTypeVariable isValueVariable`.split(/\s+/),
  definition: "type name node parent index kind rest isTypeDefinition isVariableDefinition".split(" "),
  reference: "identifier from resolved flag tainted writeExpr partial init isTypeReference isValueReference".split(" "),
};
const methods = {
  manager: "isES6 isGlobalReturn isImpliedStrict isModule isStrictModeSupported".split(" "),
  scope: "isStatic isArgumentsMaterialized isThisMaterialized isVariableScope".split(" "),
  variable: [],
  definition: [],
  reference: "isStatic isWrite isRead isReadOnly isWriteOnly isReadWrite".split(" "),
};

function dump(context, program, referencesFirst) {
  const { sourceCode } = context;
  const manager = sourceCode.scopeManager;
  const isTypeScript = "nodeToScope" in manager;
  const showsAllGlobals = context.filename.includes("globals");
  const lines = [];

  if (referencesFirst) {
    const brief = it =>
      it === null
        ? "null"
        : [
            JSON.stringify(it.name),
            it.scope.type,
            it.writeable,
            it.eslintImplicitGlobalSetting,
            it.eslintExplicitGlobal,
            it.eslintExplicitGlobalComments?.length,
            it.eslintUsed,
            it.defs.length,
            it.identifiers.length,
            it.references.length,
            Object.keys(it),
            it.constructor.name,
          ].join(" ");
    for (const scope of manager.scopes.toReversed())
      for (const reference of scope.references)
        lines.push(`first ${at(reference.identifier)} ${brief(reference.resolved)}`);
    const { set } = manager.globalScope;
    for (const name of [
      "Array",
      "undefined",
      "notThere",
      "configured",
      "turnedOff",
      "ReadonlyArray",
      "const",
      "toString",
    ])
      lines.push(`first ${name} ${set.has(name)} ${brief(set.get(name) ?? null)}`);
    lines.push(`first ${manager.globalScope.through.length} ${set.size} ${manager.globalScope.variables.length}`);
  }

  const isQuiet = it => it.scope.type === "global" && it.defs.length === 0 && it.references.length === 0;
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // The variables of a scope that are shown.
  const variablesOf = scope => {
    if (scope.type !== "global") return scope.variables;
    const shown = showsAllGlobals ? scope.variables : scope.variables.filter(it => !isQuiet(it));
    return isTypeScript ? shown.toSorted(byName) : shown;
  };
  // Every object gets a name first, so that a link to it reads the same wherever it is.
  const names = new Map();
  const nameVariable = (variable, name) => {
    names.set(variable, name);
    variable.defs.forEach((definition, i) => names.set(definition, `${name}.D${i}`));
  };
  manager.scopes.forEach((scope, i) => {
    names.set(scope, `S${i}`);
    variablesOf(scope).forEach((variable, j) => nameVariable(variable, `S${i}.V${j}`));
    scope.references.forEach((reference, j) => names.set(reference, `S${i}.R${j}`));
    scope.implicit?.variables.forEach((variable, j) => nameVariable(variable, `S${i}.I${j}`));
  });

  const render = (value, depth = 0) => {
    if (typeof value === "function") return "function";
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (names.has(value)) return names.get(value);
    if (isNode(value)) return at(value);
    if (Array.isArray(value)) return `[${value.map(it => render(it, depth + 1)).join(" ")}]`;
    if (value instanceof Map) return `Map{${[...value].map(it => `${it[0]}=>${render(it[1], depth + 1)}`).join(" ")}}`;
    if (depth > 3) return "{..}";
    return `{${Object.keys(value).map(key => `${key}: ${render(value[key], depth + 1)}`)}}`;
  };
  // `all`: the variables in `variables` or `set` of the global scope, or in `manager.variables`.
  const shownOf = all => {
    const shown = all.filter(it => names.has(it)).map(it => names.get(it));
    return `[${(isTypeScript ? shown.sort() : shown).join(" ")}] of ${all.length}`;
  };
  // The layout of the first object of each class with each number of properties.
  const layouts = new Map();
  const describe = (kind, object) => {
    const layout = `${kind} ${object.constructor.name} ${Object.keys(object).length}`;
    if (!layouts.has(layout)) layouts.set(layout, `${kind} ${classesOf(object)}: ${ownOf(object)}`);
    const values = members[kind].map(key => {
      if (!(key in object)) return `${key}=-`;
      if (object.type !== "global" || (key !== "variables" && key !== "set")) return `${key}=${render(object[key])}`;
      return `${key}=${shownOf(key === "set" ? [...object.set.values()] : object.variables)}`;
    });
    const results = methods[kind].filter(key => key in object).map(key => `${key}()=${object[key]()}`);
    return `${[...values, ...results].join(" ")}${"$id" in object ? ` $id=${typeof object.$id}` : ""}`;
  };

  lines.push(`manager ${describe("manager", manager)}`);
  if ("variables" in manager) lines.push(`manager.variables ${shownOf(manager.variables)}`);
  for (const scope of manager.scopes) {
    lines.push(`${names.get(scope)} ${describe("scope", scope)}`);
    lines.push(
      `  set: ${scope.set instanceof Map} ${scope.set.size} ${[...scope.set].every(it => it[1].name === it[0])}`,
    );
    // Those that nothing mentions are mostly alike. Those that read the same share a line.
    const alike = new Map();
    for (const variable of [...variablesOf(scope), ...(scope.implicit?.variables ?? [])]) {
      const text = describe("variable", variable);
      if (isQuiet(variable)) {
        const rest = text.replace(/^name=\S+ /, "");
        alike.set(rest, [...(alike.get(rest) ?? []), variable.name]);
        continue;
      }
      lines.push(`${names.get(variable)} ${text}`);
      for (const definition of variable.defs)
        lines.push(`${names.get(definition)} ${describe("definition", definition)}`);
    }
    for (const [text, all] of alike) lines.push(`  ${all.join(" ")}: ${text}`);
    for (const reference of scope.references) lines.push(`${names.get(reference)} ${describe("reference", reference)}`);
  }
  lines.push(...[...layouts.values()].sort());

  if (!context.filename.includes("nodes")) return lines.join("\n");
  (function visit(node) {
    const found = [
      sourceCode.getScope(node),
      sourceCode.getDeclaredVariables(node),
      manager.acquire(node),
      manager.acquire(node, true),
    ];
    if (manager.acquireAll) found.push(manager.acquireAll(node), manager.release(node));
    if (node.type === "Identifier") found.push(sourceCode.isGlobalReference(node));
    lines.push(`${at(node)} ${found.map(it => render(it)).join(" ")}`);
    for (const key of sourceCode.visitorKeys[node.type] ?? [])
      for (const child of [node[key]].flat()) if (child) visit(child);
  })(program);
  return lines.join("\n");
}

const rule = referencesFirst => ({
  create: context => ({
    "Program:exit"(node) {
      context.report({ node, message: dump(context, node, referencesFirst) });
    },
  }),
});
module.exports = { meta: { name: "scopes" }, rules: { all: rule(false), "references-first": rule(true) } };
