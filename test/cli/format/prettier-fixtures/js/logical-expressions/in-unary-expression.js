

// https://github.com/estree/estree/blob/96fee942ecc2b3b9d3c34163ec142b75daf4cca1/es5.md#unaryoperator
[
!(
  //
  octahedralAnteaterGenerator ||
  //
  stellatedFossilProcessor
),
+(
  //
  octahedralAnteaterGenerator &&
  //
  stellatedFossilProcessor
),
typeof (
  //
  octahedralAnteaterGenerator ??
  //
  stellatedFossilProcessor
),
];

// Realworld case from Prettier repo
if (
  !(
    // `import("foo")`
    (
      node.type === "ImportExpression" ||
      // `type foo = import("foo")`
      node.type === "TSImportType" ||
      // `import type A = require("foo")`
      node.type === "TSExternalModuleReference" ||
      // `require("foo")`
      // `require.resolve("foo")`
      // `require.resolve.paths("foo")`
      // `import.meta.resolve("foo")`
      (node.type === "CallExpression" &&
        !node.optional &&
        isNodeMatches(node.callee, moduleImportCallees))
    )
  )
) {
}

// Realworld case from Babel repo
const argsOptEligible =
  !state.deopted &&
  !(
    // ex: `args[0] = "whatever"`
    (
      (grandparentPath.isAssignmentExpression() &&
        parentPath.node === grandparentPath.node.left) ||
      // ex: `[args[0]] = ["whatever"]`
      grandparentPath.isLVal() ||
      // ex: `for (rest[0] in this)`
      // ex: `for (rest[0] of this)`
      grandparentPath.isForXStatement() ||
      // ex: `++args[0]`
      // ex: `args[0]--`
      grandparentPath.isUpdateExpression() ||
      // ex: `delete args[0]`
      grandparentPath.isUnaryExpression({ operator: "delete" }) ||
      // ex: `args[0]()`
      // ex: `new args[0]()`
      // ex: `new args[0]`
      ((grandparentPath.isCallExpression() ||
        grandparentPath.isNewExpression()) &&
        parentPath.node === grandparentPath.node.callee)
    )
  );

// Realworld case from excalidraw repo
const foo = () =>
  !!(
    // versions are required integers
    (
      Number.isInteger(deleted.version) &&
      Number.isInteger(inserted.version) &&
      // versions should be positive, zero included
      deleted.version >= 0 &&
      inserted.version >= 0 &&
      // versions should never be the same
      deleted.version !== inserted.version
    )
  );
