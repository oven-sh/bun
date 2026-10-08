type T = {
  prop:
    // comment
    | T1
    // comment
    | T2
    // comment
}

type T2 = (arg:
  // comment
  | T1
  // comment
  | T2
  // comment
) => void
