foo = {
  // prettier-ignore
  bar:            1,
}

foo = {
  _: '',
  // prettier-ignore
  bar:            1,
}

/* comments */
foo = {
  _: '',
  // prettier-ignore
  bar:            1,         // comment
}

foo = {
  _: '',
  // prettier-ignore
  bar:            1,         /* comment */
}

foo = {
  _: '',
  // prettier-ignore
  bar:            /* comment */          1,
}

/* SpreadElement */
foo = {
  _: '',
  // prettier-ignore
  ...bar,
}

// Nested
foo = {
  baz: {
  // prettier-ignore
  foo: [1, 2,    3]
},
  // prettier-ignore
  bar:            1,
}
