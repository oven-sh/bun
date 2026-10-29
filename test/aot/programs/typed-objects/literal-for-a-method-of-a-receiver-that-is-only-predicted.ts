// The receiver of `tracer.span({ .. })` is read out of parsed data, so the compiler only predicts what is called. The parameter's type is a record
// that this program declares: the literal is created with that record's layout, and the parameter's test passes in compiled code, without a call into the run time.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// IR= 0 makeSpan  = NewPlainObject
declare const aotRuntimeCounters: undefined | (() => string)
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === 'function' ? aotRuntimeCounters() : '')
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts: string, ...besides: string[]): number {
  let sum = 0
  for (const line of counts.split('\n')) {
    const [calls, name] = line.split('\toperation:')
    if (name !== undefined && !besides.includes(name)) sum += Number(calls)
  }
  return sum
}
type Kind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'
class Context {
  constructor(readonly size: number) {}
}
type Link = { to: number }
class NativeSpan {
  readonly name: string
  readonly links: Link[]
  readonly startTime: bigint
  readonly kind: Kind
  readonly sampled: boolean
  readonly annotations: Context
  constructor(options: { readonly name: string; readonly annotations: Context; readonly links: Link[]; readonly startTime: bigint; readonly kind: Kind; readonly sampled: boolean }) {
    this.name = options.name
    this.annotations = options.annotations
    this.links = options.links
    this.startTime = options.startTime
    this.kind = options.kind
    this.sampled = options.sampled
  }
}
interface Tracer {
  span(this: Tracer, options: { readonly name: string; readonly annotations: Context; readonly links: Link[]; readonly startTime: bigint; readonly kind: Kind; readonly root: boolean; readonly sampled: boolean }): NativeSpan
  readonly context?: ((value: number) => number) | undefined
}
const make = (options: Tracer): Tracer => options
const nativeTracer: Tracer = make({ span: options => new NativeSpan(options) })
interface Fiber<A> {
  readonly cache: { tracer: Tracer | undefined }
  readonly value: A
}
const empty = new Context(0)
function makeSpan(fiber: Fiber<any>, name: string, kind: Kind | undefined): NativeSpan {
  const tracer = fiber.cache.tracer ?? nativeTracer
  return tracer.span({ name, annotations: empty, links: [], startTime: 0n, kind: kind ?? 'internal', root: false, sampled: true })
}
const fiber: Fiber<any> = JSON.parse('{"cache":{},"value":1}')
let total = 0
for (let r = 0; r < 20; r++) total += makeSpan(fiber, 'n', r % 7 === 0 ? 'server' : undefined).name.length
const before = countsSoFar()
for (let r = 0; r < 2000; r++) total += makeSpan(fiber, 'name', r % 7 === 0 ? 'server' : undefined).kind.length
const after = countsSoFar()
const entered = callsIn(after) - callsIn(before)
console.log(total, entered < 200 ? 'tested in compiled code' : 'the run time was called ' + entered + ' times')

const seen: string[] = []
const untyped: any = {
  span(options: any) {
    seen.push(Object.keys(options).join() + ' ' + JSON.stringify({ ...options, startTime: String(options.startTime) }))
    options.extra = 1
    delete options.root
    seen.push(Object.keys(options).join())
    return new NativeSpan(options)
  },
}
const other: Fiber<any> = JSON.parse('{"cache":{},"value":2}')
other.cache.tracer = untyped
const span = makeSpan(other, 'through untyped code', 'client')
console.log(span.name, span.kind, span.sampled, span.links.length, span.annotations === empty, seen.join(' | '))
