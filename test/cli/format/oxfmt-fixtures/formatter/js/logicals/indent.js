{
  RESOLUTION_CACHE = new ExpiringCache(
    options.singleRun
      ? 'Infinity'
      : (options.cacheLifetime?.glob ??
        DEFAULT_TSCONFIG_CACHE_DURATION_SECONDS),
  );
}
