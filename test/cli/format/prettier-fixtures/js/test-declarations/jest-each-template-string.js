test.each`
a | b         | c
${1}      | ${[{ start: 5, end: 15 }]} | ${[1,2,3,4,5,6,7,8]}
${1}| ${[{ start: 5, end: 15 }]} | ${["test", "string", "for", "prettier"]}
${3}      | ${[{ start: 5, end: 15 }]} | ${[]}
${4} | ${[{ start: 1, end: 3 },{ start: 15, end: 20 },]} | ${[]}
`("example test", ({a, b, c}) => {})


test.each`
a | 
${[{ a: 1, b: 3 },{ c: 15, d: 20 }]}| 
${[{ start: 1, end: 3 },{ start: 15, end: 20 }, { start: 15, end: 20 },]}| 
`("example test", ({a, b, c}) => {})
