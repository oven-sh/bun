function isUnusedDiagnostic(code) {
  return [
    6133, // '{0}' is declared but never used.
    6138, // Property '{0}' is declared but its value is never read.
    6192, // All imports in import declaration are unused.
    6196, // '{0}' is declared but its value is never read.
    6198,
    6199,
    6205, // All type parameters are unused.
  ].includes(code);
}
