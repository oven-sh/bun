fn = () => (a, b, c /* abc */);
fn = () => (a, b, c) /* abc */;

multilineCase = (someParameter) => (
  someVeryLongExpressionName,
  anotherVeryLongExpressionName,
  yetAnotherVeryLongExpressionName /* abc */
);

multilineCase = (someParameter) => (
  someVeryLongExpressionName,
  anotherVeryLongExpressionName,
  yetAnotherVeryLongExpressionName
)/* abc */;
