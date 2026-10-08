type Type = {
  // comment
  readonly [T in number];
};

type Type = {
  // comment1
  // comment2
  readonly [T in number];
};

type Type = {
  // comment
  +readonly [T in number];
};

type Type = {
  // comment
  -readonly [T in number];
};

type Type = {
  // comment
  +    readonly [T in number];
};

type Type = {
  // comment
  +readonly     [T in number];
};

type Type = {
  // comment
  readonly       [T in number];
};

type Type = {
  // comment
  [T in number];
};

type Type = {
  readonly
  // comment
  [T in number];
};

type Type = {
  readonly // foo
  /* bar */ [T in number];
};
