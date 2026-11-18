// A CommonJS component file with syntax that only sloppy mode code can hold: a `with` statement and `delete` of a name. The build prints no ES module of that file, so its hook runs as the compiler's output, like that of any other file.
const hooks: { useWords(title: string): unknown[] } = require("./words.jsx");

console.log(JSON.stringify(hooks.useWords("kept")), JSON.stringify(hooks.useWords("kept")));
