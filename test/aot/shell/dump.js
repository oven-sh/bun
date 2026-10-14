// jsc dump.js -- <IR file> <stage>
// Prints the front end's IR as JavaScriptCore's compiler sees it at a stage: `read`, `optimized`, `string-builders`.
print($vm.dumpAOTTypedProgram(readFile(arguments[0], "binary"), arguments[1]).trimEnd());
