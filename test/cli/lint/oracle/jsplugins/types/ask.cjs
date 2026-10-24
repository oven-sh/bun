// A rule that reports, for each node, `type.flags` and the name of `type.getSymbol()`.

// This is what `getParserServices` in @typescript-eslint/utils does.
function services(context) {
  const services = context.sourceCode.parserServices;
  if (services?.esTreeNodeToTSNodeMap == null || services.tsNodeToESTreeNodeMap == null || services.program == null) {
    throw new Error("You have used a rule which requires type information, but don't have parserOptions set to generate type information for this file.");
  }
  return services;
}

// For a name or a literal, where it is counts too.
function kindOf(node) {
  if (!["Identifier", "Literal", "JSXIdentifier", "PrivateIdentifier"].includes(node.type)) return node.type;
  const { parent } = node;
  const key = Object.keys(parent).find(key => key !== "parent" && [parent[key]].flat().includes(node));
  return `${node.type} in ${parent.type}.${key}`;
}

function answerFor(context, node) {
  const { getTypeAtLocation } = services(context);
  try {
    const type = getTypeAtLocation(node);
    // A module is named by its path.
    const name = type.getSymbol()?.name.replace(/^".*\/(\w+)"$/, '"$1"');
    return name === undefined ? String(type.flags) : `${type.flags} ${name}`;
  } catch (error) {
    if (error.message.includes("that bun lint does not have")) return "refused";
    // TypeScript itself, for a file that's a module.
    if (error instanceof TypeError && node.type === "Program") return "throws";
    throw error;
  }
}

module.exports = {
  rules: {
    all: {
      create: context => ({
        "*"(node) {
          context.report({ node, message: `${kindOf(node)}: ${answerFor(context, node)}` });
        },
      }),
    },
  },
};
