// Accessor with type annotation
class Typed {
  accessor foo: string = "bar";
  accessor veryLongPropertyName: SomeReallyLongTypeName = someReallyLongFunctionName(argumentOne, argumentTwo);
}

// Accessor with modifiers
class Modifiers {
  public accessor foo: string = "bar";
  private accessor bar: number = 42;
  protected accessor baz: boolean = true;
  static accessor qux: string = "static";
  override accessor overridden: string = "overridden";
}

// Abstract accessor
abstract class AbstractAccessor {
  abstract accessor foo: string;
}

// Accessor with definite assignment
class Definite {
  accessor foo!: string;
}

// Accessor with long type annotation and value
class LongAnnotation {
  accessor veryLongPropertyName: Map<string, SomeReallyLongTypeName> = new Map<string, SomeReallyLongTypeName>();
}
