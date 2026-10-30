// an executable built with --compile-exec-argv: Bun's own option parser runs at start
console.log(JSON.stringify(process.execArgv), process.argv.length);
