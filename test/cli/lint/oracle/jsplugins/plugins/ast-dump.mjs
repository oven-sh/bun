// Reports the whole syntax tree, the tokens and the comments as a rule sees them, as one message.
function plain(node, seen) {
  if (Array.isArray(node)) return node.map(it => plain(it, seen));
  if (typeof node === "bigint") return `${node}n`;
  if (node instanceof RegExp) return String(node);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "parent") out.parent = node.parent ? `${node.parent.type}@${node.parent.range}` : null;
    // typescript-estree has neither, and here every node has both.
    else if (key === "start" || key === "end" || key === "loc") continue;
    else if (node[key] !== undefined) out[key] = plain(node[key], seen);
  }
  if (node.loc) out.loc = [node.loc.start.line, node.loc.start.column, node.loc.end.line, node.loc.end.column];
  return out;
}

export default {
  meta: { name: "dump" },
  rules: {
    ast: {
      create(context) {
        const order = [];
        return {
          "*"(node) {
            order.push(`${node.type}@${node.range}`);
          },
          "*:exit"(node) {
            order.push(`/${node.type}@${node.range}`);
          },
          "Program:exit"(node) {
            const { sourceCode } = context;
            context.report({
              loc: { line: 1, column: 0 },
              message: JSON.stringify({
                ast: plain(node),
                order: order.join(" "),
                lines: sourceCode.lines,
                hasBOM: sourceCode.hasBOM,
                keys: Object.fromEntries(order.filter(it => it[0] !== "/").map(it => [it.split("@")[0], sourceCode.visitorKeys[it.split("@")[0]]])),
              }),
            });
          },
        };
      },
    },
  },
};
