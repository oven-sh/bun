// Reports all that `sourceCode.scopeManager` has, as one message.
//
// Of the variables of the global scope that have no definition, only those that something refers to are listed: there
// are hundreds, and which exist is a matter of the configuration.
const at = node => (node ? `${node.type}@${node.range}` : node);

export default {
  meta: { name: "dump" },
  rules: {
    scope: {
      create(context) {
        const { sourceCode } = context;
        const perNode = [];
        return {
          "*"(node) {
            const manager = sourceCode.scopeManager;
            const declared = sourceCode.getDeclaredVariables(node);
            const scope = manager.scopes.indexOf(sourceCode.getScope(node));
            perNode.push([at(node), scope, declared.map(it => `${it.name}#${manager.scopes.indexOf(it.scope)}`).join()]);
          },
          "Program:exit"() {
            const manager = sourceCode.scopeManager;
            const scopeIndex = scope => (scope ? manager.scopes.indexOf(scope) : scope);
            const isListed = variable => variable.defs.length > 0 || variable.references.length > 0 || variable.name === "arguments";
            const variableKey = variable => (variable ? `${variable.name}#${scopeIndex(variable.scope)}` : variable);
            const referenceKey = it => `${at(it.identifier)}${it.isRead() ? "r" : ""}${it.isWrite() ? "w" : ""}`;
            const scopes = manager.scopes.map(scope => ({
              type: scope.type,
              block: at(scope.block),
              isStrict: scope.isStrict,
              upper: scopeIndex(scope.upper),
              variableScope: scopeIndex(scope.variableScope),
              childScopes: scope.childScopes.map(scopeIndex),
              functionExpressionScope: scope.functionExpressionScope,
              set: [...scope.set].filter(it => isListed(it[1])).map(it => it[0]),
              variables: scope.variables.filter(isListed).map(variable => ({
                name: variable.name,
                scope: scopeIndex(variable.scope),
                identifiers: variable.identifiers.map(at),
                defs: variable.defs.map(def => ({
                  type: def.type,
                  name: at(def.name),
                  node: at(def.node),
                  parent: at(def.parent),
                  index: def.index,
                  kind: def.kind,
                  rest: def.rest,
                  isTypeDefinition: def.isTypeDefinition,
                  isVariableDefinition: def.isVariableDefinition,
                })),
                references: variable.references.map(referenceKey),
                eslintUsed: Boolean(variable.eslintUsed),
                eslintExported: variable.eslintExported,
                writeable: variable.writeable,
                eslintImplicitGlobalSetting: variable.eslintImplicitGlobalSetting,
                eslintExplicitGlobal: variable.eslintExplicitGlobal,
                eslintExplicitGlobalComments: variable.eslintExplicitGlobalComments?.map(at),
                isTypeVariable: variable.isTypeVariable,
                isValueVariable: variable.isValueVariable,
              })),
              references: scope.references.map(it => ({
                key: referenceKey(it),
                from: scopeIndex(it.from),
                resolved: variableKey(it.resolved),
                init: it.init,
                writeExpr: at(it.writeExpr),
                isTypeReference: it.isTypeReference,
                isValueReference: it.isValueReference,
              })),
              through: scope.through.map(referenceKey),
              implicit: scope.implicit && {
                variables: scope.implicit.variables.map(it => [it.name, it.defs.map(def => [def.type, at(def.name), at(def.node)])]),
                set: [...scope.implicit.set.keys()],
                left: (scope.implicit.left ?? scope.implicit.leftToBeResolved).map(referenceKey),
              },
            }));
            context.report({
              loc: { line: 1, column: 0 },
              message: JSON.stringify({
                scopes,
                perNode,
                manager: [manager.isGlobalReturn(), manager.isModule(), manager.isImpliedStrict(), manager.isStrictModeSupported()],
              }),
            });
          },
        };
      },
    },
  },
};
