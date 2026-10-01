// A comment, so that lines differ from the bundle's.
interface Options { depth: number }

export function fail(options: Options): never {
  if (options.depth > 0) return fail({ depth: options.depth - 1 });
  const config: any = { server: {} };
  return config.server.options.port;
}
