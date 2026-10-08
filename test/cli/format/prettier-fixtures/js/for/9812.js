for (const p of ['fullName', 'organ', 'position', 'rank'])
  // comment
  form.setValue(`${prefix}.data.${p}`, response[p])

for(x of y)
  // comment
  bar();

for(x in y)
  // comment
  bar();

for(;;)
  // comment
  bar();

for(x of y)
  // comment1
  // comment2
  bar();

for(x in y)
  // comment1
  // comment2
  bar();

for(;;)
  // comment1
  // comment2
  bar();

for(x of y)
  /* comment */
  bar();

for(x in y)
  /* comment */
  bar();

for(;;)
  /* comment */
  bar();

for (
  a = 1;
  // this condition is tricky:
  a === b || a === c;
  a++
) {
  console.log()
}
