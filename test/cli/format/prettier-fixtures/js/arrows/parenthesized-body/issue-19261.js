fn = () => (a = b /* abc */);
fn = () => a = b /* abc */;
fn = () => a = b; /* abc */

multilineCase = (someParameter) => (
  someVeryLongIdentifierName = someVeryLongValueExpressionName /* abc */
);

multilineCase = (someParameter) =>
  someVeryLongIdentifierName = someVeryLongValueExpressionName /* abc */
;
