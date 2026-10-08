class Foo {
  // PropertyDefinition
  @decorator
  readonly /* comment */ propertyDefinition;

  // TSAbstractPropertyDefinition
  @decorator
  abstract /* comment */ abstractPropertyDefinition;

  // TSAbstractMethodDefinition
  @decorator
  abstract /* comment */ abstractMethodDefinition;

  // MethodDefinition
  @decorator
  private /* comment */ methodDefinition() {}

  // AccessorProperty
  @decorator
  accessor /* comment */ accessorProperty = 3;

  constructor(
    // TSParameterProperty
    @decorator
    readonly /* comment */ parameterProperty,
  ) {}
}
