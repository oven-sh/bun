function f() {
  return (
    property.isIdentifier() &&
     FUNCTIONS[property.node.name] &&
     (object.isIdentifier(JEST_GLOBAL) ||
       (callee.isMemberExpression() && shouldHoistExpression(object))) &&
    FUNCTIONS[property.node.name](expr.get('arguments'))
  );

  return (
    chalk.bold(
      'No tests found related to files changed since last commit.\n',
    ) +
    chalk.dim(
      patternInfo.watch ?
        'Press `a` to run all tests, or run Jest with `--watchAll`.' :
        'Run Jest without `-o` to run all tests.',
    )
  );

  return !filePath.includes(coverageDirectory) &&
    !filePath.endsWith(`.${SNAPSHOT_EXTENSION}`);
}
