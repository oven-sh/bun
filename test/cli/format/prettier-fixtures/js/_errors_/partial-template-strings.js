// partial template strings is not supported by babel yet
// If parsers supported, should remove this and open a issue about this
// Proposal: https://github.com/tc39/proposal-partial-application/blob/master/README.md#proposal

const Diagnostics = {
  unexpected_token: `Unexpected token: ${?}`,
  name_not_found: `'${?}' not found.`
};
Diagnostics.name_not_found("foo"); // "'foo' not found."
