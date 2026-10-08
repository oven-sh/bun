type _Test =
  // forcing the test onto a new line so it isn't covered by the expect error
  // If there are any enum members that don't have a corresponding TSESTree.Node, then this line will error with "Type 'string | number | symbol' is not assignable to type 'string'."
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  TakesString<AllKeys> | void;
