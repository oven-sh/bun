export type ErrorLike =
  SerializedProps<Error> &
  // cause is a new addition to Error that is not yet available in all runtimes. We have added
  // it to try and pinpoint additional reasoning for failures such as Node's fetch.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
  { cause?: unknown };

export type ErrorLike2 =
  SerializedProps<Error> & // cause is a new addition to Error that is not yet available in all runtimes. We have added
  // it to try and pinpoint additional reasoning for failures such as Node's fetch.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
  { cause?: unknown };
