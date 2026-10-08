const dog = class {
  @readonly
  @nonenumerable
  @doubledValue
  legs = 4;

  @readonly
  @nonenumerable
  @doubledValue
  eyes() {return 2}
};

const foo = class {
  @multipleDecorators @inline @theyWontAllFitInOneline aVeryLongPropName = "A very long string as value"
  @multipleDecorators @inline @theyWontAllFitInOneline aVeryLongPropName() { "A very long string as value"}
};
