const {
  // prettier-ignore
  bar =           1,
} = foo

const {
  _,
  // prettier-ignore
  bar2 =           1,
} = foo

/* comments */
const {
  // prettier-ignore
  bar3 =           1,         // comment
} = foo

const {
  // prettier-ignore
  bar4 =           1,         /* comment */
} = foo

const {
  // prettier-ignore
  bar5 =           /* comment */          1,
} = foo

/* RestElement */
const {
  // prettier-ignore
  ...bar6
} = foo

// Nested
const {
  baz: {
  // prettier-ignore
  foo2 = [1, 2,    3]
},
  // prettier-ignore
  bar7 =            1,
} = foo
