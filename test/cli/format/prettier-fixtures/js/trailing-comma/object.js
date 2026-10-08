const a = {
  b: true,
  c: {
    c1: 'hello'
  },
  d: false
};

const aLong = {
  bHasALongName: 'a-long-value',
  cHasALongName: {
    c1: 'a-really-long-value',
    c2: 'a-really-really-long-value',
  },
  dHasALongName: 'a-long-value-too'
};

const bLong = {
  dHasALongName: 'a-long-value-too',
  eHasABooleanExpression: a === a,
};
