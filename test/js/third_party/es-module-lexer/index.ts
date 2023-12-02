async function main() {
  const { init, parse } = require("es-module-lexer");
  await init;
  const [imports, exports] = parse("import { a } from 'b'; export const c = 1;");
  console.write(JSON.stringify({ imports, exports }));
  process.exit(42);
}

exports.forceCommonJS = true;

if (require.main === module) {
  main();
}
