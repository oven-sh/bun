new ((
  require('./webpack/plugins/next-trace-entrypoints-plugin')
)
  .TraceEntryPointsPlugin as P)(
  {
    rootDir: dir,
  }
)
