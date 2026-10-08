Y(() => a ? b : c);

Y(() => () => a ? b : c);

Y(() => () => () => a ? b : c);

Y(() => longlonglonglonglonglonglonglonglonglongCondition ? 'Prettier is an opinionated code formatter.' : 'Prettier takes your code and reprints it from scratch by taking the line length into account.')

Y(() => () => longlonglonglonglonglonglonglonglonglongCondition ? 'Prettier is an opinionated code formatter.' : 'Prettier takes your code and reprints it from scratch by taking the line length into account.')

Y(() => () => () => longlonglonglonglonglonglonglonglonglongCondition ? 'Prettier is an opinionated code formatter.' : 'Prettier takes your code and reprints it from scratch by taking the line length into account.')

const x1 = (() => ['The', 'green', 'dragon', 'liked', 'to', 'knit', 'sweaters', 'for', 'the', 'fluffy', 'clouds', 'in', 'the', 'sky.'])

const x2 = (() => () => ['The', 'green', 'dragon', 'liked', 'to', 'knit', 'sweaters', 'for', 'the', 'fluffy', 'clouds', 'in', 'the', 'sky.'])

const x3 = (() => () => () => ['The', 'green', 'dragon', 'liked', 'to', 'knit', 'sweaters', 'for', 'the', 'fluffy', 'clouds', 'in', 'the', 'sky.'])

f((a) => (1, 2, 3) /* a */);
f((a) => (
  (b) => (1, 2, 3) /* b */
) /* a */);
f((a) => (
  (b) => (
   (c) => (1, 2, 3) /* c */
  ) /* b */
) /* a */);

f((a) => (1 ? 2 : 3) /* a */);
f((a) => (
  (b) => (1 ? 2 : 3) /* b */
) /* a */);
f((a) => (
  (b) => (
   (c) => (1 ? 2 : 3) /* c */
  ) /* b */
) /* a */);

a(
  "",
  "",
  ({}) =>
    () =>
    () =>
    () =>
    () =>
    () =>
    () => test,
);
a(
  "",
  "",
  ({}) =>
    () =>
    () =>
    () =>
    () =>
    () =>
    () => (test ? 1 : 2),
);
