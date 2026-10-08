class X {
  #selectClause: unknown;

  test(columns: unknown) {
    (this as any).#selectClause = columns;
  }
}

