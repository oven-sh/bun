export function test() {
  setTimeout(
    () => { console.warn({}, 'Lambda approaching timeout.') },
    Math.max(context.getRemainingTimeInMillis() - WARN_TIMEOUT_MS, 0),
  );
}
