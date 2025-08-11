import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("parser_crash/FunctionExpressionMemberAccessCall", {
    files: {
      "/entry.js": `
        // These expressions caused an index out of bounds panic in the parser
        (function() {}['a' + ''])();
        const a = function() {}['a' + 'b']();
      `,
    },
  });
});