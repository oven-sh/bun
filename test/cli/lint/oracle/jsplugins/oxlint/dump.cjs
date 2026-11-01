// A rule that reports everything a plugin can see of a file as JSON: the tree with all values, the order of the traversal, the scopes
// with their variables, definitions and references, and what `sourceCode` says about every node.
const at = node => (node ? `${node.type}@${node.range.join("-")}` : String(node));
const classOf = it => {
  const names = [];
  for (let p = Object.getPrototypeOf(it); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    names.push(p.constructor.name);
  }
  return names.join("<") || "Object";
};

function tree(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof RegExp) return String(value);
  if (Array.isArray(value)) return value.map(tree);
  const all = {};
  for (const key of Object.keys(value)) {
    if (key === "parent") all.parent = value.parent === null ? null : value.parent.type;
    else if (key !== "comments" && key !== "tokens") all[key] = tree(value[key]);
  }
  if (typeof value.type === "string") {
    const { start, end } = value.loc;
    all.loc = [start.line, start.column, end.line, end.column].join();
  }
  return all;
}

function scopes(context, program) {
  const { sourceCode } = context;
  const manager = sourceCode.scopeManager;
  const indexOf = new Map(manager.scopes.map((scope, index) => [scope, index]));
  const scopeId = scope => (scope === null || scope === undefined ? String(scope) : (indexOf.get(scope) ?? "?"));
  const variableId = it => (it ? `${scopeId(it.scope)}:${it.name}` : String(it));
  const numbers = new Map();
  const number = it => numbers.get(it) ?? numbers.set(it, numbers.size).get(it);
  for (const scope of manager.scopes) scope.references.forEach(number);
  const definition = it =>
    [
      classOf(it),
      Object.keys(it),
      it.type,
      at(it.name),
      at(it.node),
      at(it.parent),
      it.isTypeDefinition,
      it.isVariableDefinition,
      it.rest,
    ].join(" ");
  const variable = it => ({
    id: variableId(it),
    class: classOf(it),
    keys: Object.keys(it).join(),
    is: [it.isTypeVariable, it.isValueVariable, it.eslintUsed, it.writeable].join(),
    global: [it.eslintImplicitGlobalSetting, it.eslintExplicitGlobal, it.eslintExplicitGlobalComments].join(),
    identifiers: it.identifiers.map(at).join(),
    references: it.references.map(number).join(),
    defs: it.defs.map(definition),
  });
  const all = { scopes: [], variables: [], references: [], nodes: [] };
  for (const scope of manager.scopes) {
    const { implicit } = scope;
    all.scopes.push({
      class: classOf(scope),
      keys: Object.keys(scope).join(),
      type: scope.type,
      is: [scope.isStrict, scope.functionExpressionScope, scope.isVariableScope(), scope.leftToResolve].join(),
      block: at(scope.block),
      upper: scopeId(scope.upper),
      variableScope: scopeId(scope.variableScope),
      childScopes: scope.childScopes.map(scopeId).join(),
      variables: scope.variables.map(it => it.name).join(),
      set: `${classOf(scope.set)} ${[...scope.set.keys()]} ${scope.variables.every(it => scope.set.get(it.name) === it)}`,
      references: scope.references.map(number).join(),
      through: scope.through.map(number).join(),
      implicit: implicit && {
        keys: Object.keys(implicit).join(),
        variables: implicit.variables.map(variable),
        set: [...implicit.set.keys()].join(),
        leftToBeResolved: implicit.leftToBeResolved.map(number).join(),
      },
    });
    // Of the many globals that nothing in the file mentions, two.
    const isTold = it =>
      it.defs.length > 0 || it.references.length > 0 || /^(const|arguments|Array|escape)$/.test(it.name);
    all.variables.push(...scope.variables.filter(isTold).map(variable));
  }
  for (const [it, index] of numbers) {
    const maybe = it.maybeImplicitGlobal;
    all.references.push(
      [
        index,
        classOf(it),
        Object.keys(it),
        at(it.identifier),
        it.identifier.name,
        scopeId(it.from),
        variableId(it.resolved),
        it.init,
        at(it.writeExpr),
        maybe
          ? `${classOf(maybe)} ${Object.keys(maybe)} ${at(maybe.node)} ${maybe.pattern === it.identifier}`
          : String(maybe),
        [it.isRead(), it.isWrite(), it.isReadOnly(), it.isWriteOnly(), it.isReadWrite()].map(Number).join(""),
        it.isTypeReference,
        it.isValueReference,
      ].join(" "),
    );
  }
  const visit = node => {
    const declared = sourceCode.getDeclaredVariables(node).map(variableId);
    const acquired = [manager.acquire(node), manager.acquire(node, true)].map(scopeId);
    all.nodes.push(
      [at(node), scopeId(sourceCode.getScope(node)), declared, acquired, sourceCode.isGlobalReference(node)].join(" "),
    );
    for (const key of sourceCode.visitorKeys[node.type]) {
      for (const child of [node[key]].flat()) if (child) visit(child);
    }
  };
  visit(program);
  all.marked = ["a", "x", "arguments", "Array", "nope"].map(it => sourceCode.markVariableAsUsed(it, program)).join();
  all.used = manager.scopes.flatMap(scope => scope.variables.filter(it => it.eslintUsed).map(variableId)).join();
  return all;
}

const all = {
  create(context) {
    const visited = [];
    return {
      "*"(node) {
        visited.push(at(node));
      },
      "Program:exit"(node) {
        const said = { tree: tree(node), visited: visited.join(" "), ...scopes(context, node) };
        // They are the same for all files, so a few say them.
        if (node.body.length === 0) {
          const keys = context.sourceCode.visitorKeys;
          said.visitorKeys = Object.entries(keys).map(([type, keys]) => `${type}:${keys}`);
          said.areFrozen = Object.isFrozen(keys) && Object.values(keys).every(Object.isFrozen);
        }
        context.report({ loc: { line: 1, column: 0 }, message: JSON.stringify(said) });
      },
    };
  },
};

module.exports = { meta: { name: "dump" }, rules: { all } };
