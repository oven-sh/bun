const { writeSync } = require("fs");

async function main() {
  // Synchronous fd-2 markers so the parent test can see which phase
  // stalled when the per-child timeout fires; they do not ref the event loop.
  writeSync(2, "[es-module-lexer] require\n");
  const { init, parse } = require("es-module-lexer");
  writeSync(2, "[es-module-lexer] await init\n");
  await init;
  writeSync(2, "[es-module-lexer] init resolved\n");
  const [imports, exports] = parse("import { a } from 'b'; export const c = 1;");
  console.write(JSON.stringify({ imports, exports }));
  writeSync(2, "[es-module-lexer] exit\n");
  process.exit(42);
}

exports.forceCommonJS = true;

if (require.main === module) {
  main();
}
