type ChildMessageInitialize = [
  typeof CHILD_MESSAGE_INITIALIZE, // type
  boolean, // processed
  string, // file
  Array<unknown> | void, // setupArgs
  number | void, // workerId
];

type ChildMessageInitialize2 = [
  number | void, // workerId
];

type ChildMessageInitialize3 = [
  number | void | void | void | void | void | void | void | void | void | void | void, // workerId
];

type ChildMessageInitialize4 = [
  string,
  number | void | void | void | void | void | void | void | void | void | void | void, // workerId
];
