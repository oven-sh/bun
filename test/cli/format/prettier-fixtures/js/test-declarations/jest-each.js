describe.each`
a|b|expected
${11   } | ${  1  }|${222}
${1-1}|${2+2}|${ 3333}
${2+1+2}|${1111}|${3}
`('$a + $b', ({a, b, expected}) => {
  test(`returns ${expected}`, () => {
    expect(a + b).toBe(expected);
  });

  test(`returned value not be greater than ${expected}`, () => {
    expect(a + b).not.toBeGreaterThan(expected);
  });

  test(`returned value not be less than ${expected}`, () => {
    expect(a + b).not.toBeLessThan(expected);
  });
});

describe.only.each`
a|b|expected
${11   } | ${  1  }|${222}|${'unknown column 1'}|${'unknown column 2'}
${1-1}|${2+2}|${ 3333}
${2+1+2}|${1111}|${3}          |${'unknown column xyz'}
`

describe.only.each`
||
${11   } | ${  1  }|${222}|${'unknown column 1'}|${'unknown column 2'}
${1-1}|${2+2}|${ 3333}
${2+1+2}|${1111}|${3}          |${'unknown column xyz'}
`

describe.each`a    | b    | expected
${1} | ${1} | ${2}
${1} | ${2} | ${3}
${2} | ${1} | ${3}`

// an example to demo multiline quasi
describe.each`a    | b    | expected
${11111111111} | ${a().b(x => x).c().d()} | ${2}
${1} | ${2} | ${3}
${2} | ${1} | ${3}`

describe.each([1, 2, 3])("test", a => {
  expect(a).toBe(a);
});

test.only.each([[1, 1, 2], [1, 2, 3], [2, 1, 3]])(
  ".add(%i, %i)", (a, b, expected) => {
    expect(a + b).toBe(expected);
  }
);

test.each([
  { a: "1", b: 1 },
  { a: "2", b: 2 },
  { a: "3", b: 3 },
])("test", ({ a, b }) => {
    expect(Number(a)).toBe(b);
  }
);
