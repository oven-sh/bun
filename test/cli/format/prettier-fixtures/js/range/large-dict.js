function ugly() {
  const dictWithSeveralEntries = {
    key:          "value",
<<<PRETTIER_RANGE_START>>>    anotherKey:   "another value",
    firstNumber:  1,
    secondNumber: 2<<<PRETTIER_RANGE_END>>>
  };
}
