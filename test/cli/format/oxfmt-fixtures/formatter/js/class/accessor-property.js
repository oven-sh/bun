// Basic accessor property
class Basic {
  accessor foo = "bar";
}

// Accessor with long value that should trigger line breaking
class LongValue {
  accessor veryLongPropertyName = someReallyLongFunctionName(argumentOne, argumentTwo, argumentThree);
}

// Static accessor
class StaticAccessor {
  static accessor foo = "bar";
  static accessor veryLongPropertyName = someReallyLongFunctionName(argumentOne, argumentTwo, argumentThree);
}

// Accessor without value
class NoValue {
  accessor foo;
}

// Computed accessor
class Computed {
  accessor [Symbol.iterator] = function* () {};
  accessor ["computed"] = "value";
}
