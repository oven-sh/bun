import * as types from "./options";
import { Polite } from "./polite";
import { Mood } from "./mood";
export interface Server {
  port: number;
  options: types.Options;
  greeter?: types.Greeter;
}
function pick({ port, options }: Server, fallback: number = 80): [number, types.Options] {
  return [port ?? fallback, options];
}
export function serve<S extends Server>(server: S, ...rest: string[]): string {
  const [port, options] = pick(server);
  const greeter: types.Greeter = server.greeter ?? new Polite("hello", Mood.Sad);
  const seen = new Map<string, number>();
  seen.set(options.name, rest.length);
  const handlers: Array<(options: types.Options) => string> = [options => greeter.greet(options), function (this: void, options: types.Options) { return options.name; }];
  return handlers.map(handler => handler(options)).join(",") + port + (seen.get(options.name) as number);
}
export { Polite, Mood };
export type { Options } from "./options";
