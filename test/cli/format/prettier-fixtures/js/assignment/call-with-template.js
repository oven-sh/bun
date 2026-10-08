const result = template(`
  if (SOME_VAR === "") {}
`)({
  SOME_VAR: value,
});

const output =
 template(`function f() %%A%%`)({
   A: t.blockStatement([]),
 });
