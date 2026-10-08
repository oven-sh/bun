function escapePathForGlob(path) {
  return fastGlob
    .escapePath(
      path.replaceAll("\\", "\0"), // Workaround for fast-glob#262 (part 1)
    )
    .replaceAll(String.raw`\!`, "@(!)") // Workaround for fast-glob#261
    .replaceAll("\0", String.raw`@(\\)`); // Workaround for fast-glob#262 (part 2)
}
