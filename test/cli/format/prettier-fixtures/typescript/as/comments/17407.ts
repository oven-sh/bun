function getClassNameFromPrototypeMethod(container) {
  return ((container // a
    .left as PropertyAccessExpression) // b
    .expression as PropertyAccessExpression) // c
    .expression; // d
}
