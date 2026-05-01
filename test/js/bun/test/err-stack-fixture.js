// Create an error
//
const err = new Error("Something went wrong");
err.stack;
console.write(
  JSON.stringify(
    {
      line: err.line,
      column: err.column,
      originalLine: err.originalLine,
      originalColumn: err.originalColumn,
    },
    null,
    2,
  ) + "\n",
);
