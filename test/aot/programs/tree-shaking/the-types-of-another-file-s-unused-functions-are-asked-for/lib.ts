function defaults() {
  return { port: 8080, host: "0.0.0.0" };
}
export type Config = ReturnType<typeof defaults>;

function innermost() {
  return { value: 1 };
}
function wraps() {
  return { inner: innermost() };
}
export type Deep = ReturnType<typeof wraps>;

export function unusedFactory() {
  return { id: 0, tags: [""] };
}
export function neverImported() {
  return "never";
}
export function used(config: Config) {
  return config.host + ":" + config.port;
}
