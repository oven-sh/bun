// `declare namespace` around an interface says nothing about the interface: its objects are made by this program and have a layout.
// A namespace that also declares a value describes what the host provides, and so does `declare global`.
// IR+ ^layout L\d+ .*name="WithContent" .* representation=Typed
// IR+ ^layout L\d+ .*name="Deep" .* representation=Typed
// IR- ^layout L\d+ .*name="OfTheHost" .* representation=Typed
export interface Options {
  readonly status?: number
}
export declare namespace Options {
  export interface WithContent extends Options {
    readonly content: string
    readonly length: number
  }
  export namespace Inner {
    export interface Deep {
      readonly depth: number
    }
  }
}
declare namespace Provided {
  const version: string | undefined
  interface OfTheHost {
    readonly name: string
  }
}
declare global {
  interface ForEverybody {
    readonly shared: number
  }
}
function describe(options: Options.WithContent): string {
  return options.content + ':' + options.length + ':' + (options.status ?? 200)
}
function depthOf(deep: Options.Inner.Deep): number {
  return deep.depth + 1
}
function nameOf(given: Provided.OfTheHost): string {
  return given.name
}
function sharedOf(given: ForEverybody): number {
  return given.shared
}
const parsed: any = JSON.parse('{"content":"parsed","length":6,"status":201,"depth":4,"name":"n","shared":9}')
console.log(describe({ content: 'made', length: 4 }), describe({ content: 'more', length: 4, status: 404 }), describe(parsed))
console.log(depthOf({ depth: 1 }), depthOf(parsed), nameOf({ name: 'here' }), nameOf(parsed), sharedOf({ shared: 2 }), sharedOf(parsed))
console.log(Object.keys({ content: 'x', length: 1 } satisfies Options.WithContent).join(), JSON.stringify(parsed))
