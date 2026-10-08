const svgJsFiles = fs
  .readdirSync(svgDir)
  .filter(f => svgJsFileExtRegex.test(f))
  .map(f => path.join(svgDir, f));
