const fixturePackageJson = (
  await import(
    pathToFileURL(path.join(fixtureDir, 'package.json')).href,
    { with: { type: 'json' } }
  )
).default;
