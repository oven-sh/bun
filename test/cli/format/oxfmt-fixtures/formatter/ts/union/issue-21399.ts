// Issue #21399 - comment after pipe in single member union
export type myType = |
  // Comment
  "A";

// Block comment after pipe on own line
type BlockComment = |
  /* block comment */
  "B";

// Multiple comments after pipe
type MultipleComments = |
  // Comment 1
  // Comment 2
  "C";
