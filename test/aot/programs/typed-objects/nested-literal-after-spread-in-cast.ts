// An object literal with a spread is cast with `as`. A property written after the spread holds another object literal in one arm of a
// conditional. The inner literal is created once, and the cast copies nothing: a reference to it that was kept
// while it was created is the same object as the one the outer literal holds.
interface Jsx { runtime?: "automatic" | "classic"; factory?: string; fragment?: string }
interface Config { entrypoints: string[]; target?: string; jsx?: Jsx }
interface Options { entry: string; fold?: boolean; jsx?: Jsx }

let created: object | undefined
function remember<T extends object>(value: T): T { created = value; return value }
function describe(config: Config): string { return config.entrypoints.join() + " " + config.target + " " + (config.jsx ? config.jsx.runtime + " " + config.jsx.factory : "none") + " " + JSON.stringify(config) }
function build(options: Options): Config {
  const jsx = options.jsx
  return {
    entrypoints: [options.entry],
    ...(options.fold === undefined ? {} : { foldForTesting: options.fold }),
    target: "bun",
    jsx: jsx ? { runtime: jsx.runtime, factory: jsx.factory, fragment: jsx.fragment } : undefined,
  } as Config
}
function buildAndRemember(options: Options): Config {
  const jsx = options.jsx
  return {
    entrypoints: [options.entry],
    ...(options.fold === undefined ? {} : { foldForTesting: options.fold }),
    target: "bun",
    jsx: jsx ? remember({ runtime: jsx.runtime, factory: jsx.factory, fragment: jsx.fragment }) : undefined,
  } as Config
}
function buildInAVariable(options: Options): Config {
  const jsx = options.jsx
  const config: Config = {
    entrypoints: [options.entry],
    ...(options.fold === undefined ? {} : { foldForTesting: options.fold }),
    target: "bun",
    jsx: jsx ? { runtime: jsx.runtime, factory: jsx.factory, fragment: jsx.fragment } : undefined,
  } as Config
  if (options.fold) config.target = "node"
  return config
}

console.log(describe(build({ entry: "a.ts" })))
console.log(describe(build({ entry: "b.ts", fold: true, jsx: { runtime: "classic", factory: "h" } })))
const config = buildAndRemember({ entry: "c.ts", jsx: { runtime: "automatic" } })
console.log(describe(config), config.jsx === created)
console.log(describe(buildInAVariable({ entry: "e.ts", fold: true, jsx: { runtime: "classic", factory: "h" } })))
