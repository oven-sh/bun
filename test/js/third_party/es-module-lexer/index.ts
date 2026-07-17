async function main() {
  // stderr markers let the parent test see which phase stalled when the
  // per-child timeout fires; they do not keep the event loop alive.
  process.stderr.write("[es-module-lexer] require\n");
  const { init, parse } = require("es-module-lexer");
  process.stderr.write("[es-module-lexer] await init\n");
  await init;
  process.stderr.write("[es-module-lexer] init resolved\n");
  const [imports, exports] = parse("import { a } from 'b'; export const c = 1;");
  console.write(JSON.stringify({ imports, exports }));
  process.stderr.write("[es-module-lexer] exit\n");
  process.exit(42);
}

exports.forceCommonJS = true;

if (require.main === module) {
  main();
}
