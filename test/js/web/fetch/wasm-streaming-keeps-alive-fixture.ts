// Fixture for "pending streaming compilation keeps the process alive".
//
// Builds a wasm module whose compilation outlives the main script, starts a
// streaming compile of it, and prints "settled" once the promise settles. If
// the pending compilation does not hold an event loop ref, the process exits 0
// before anything is printed.
//
// argv[2]: "compileStreaming" | "instantiateStreaming"
// argv[3]: "buffered" (Response over bytes) | "stream" (Response over a ReadableStream)

function uleb(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
  return out;
}

function section(id: number, contents: number[]): number[] {
  return [id, ...uleb(contents.length), ...contents];
}

// `funcs` copies of `(func (result i32) i32.const 0 (i32.const 1 i32.add)*addsPerFunc)`.
function makeWasm(funcs: number, addsPerFunc: number): Uint8Array {
  const typeSection = section(1, [1, 0x60, 0, 1, 0x7f]);
  const funcSection = section(3, [...uleb(funcs), ...new Array(funcs).fill(0)]);

  const body: number[] = [0, 0x41, 0x00];
  for (let i = 0; i < addsPerFunc; i++) body.push(0x41, 0x01, 0x6a);
  body.push(0x0b);
  const oneBody = new Uint8Array([...uleb(body.length), ...body]);

  const funcCount = uleb(funcs);
  const codeSectionSize = funcCount.length + oneBody.length * funcs;
  const header = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...funcSection,
    10, ...uleb(codeSectionSize), ...funcCount,
  ]);

  const bytes = new Uint8Array(header.length + oneBody.length * funcs);
  bytes.set(header, 0);
  for (let i = 0; i < funcs; i++) bytes.set(oneBody, header.length + i * oneBody.length);
  return bytes;
}

const wasm = makeWasm(2000, 1000);
const headers = { "Content-Type": "application/wasm" };

// "buffered" feeds the compiler synchronously in C++; "stream" goes through the
// consumeStream builtin, which finalizes the compiler from JavaScript.
const response =
  process.argv[3] === "stream"
    ? new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(wasm);
            controller.close();
          },
        }),
        { headers },
      )
    : new Response(wasm, { headers });

const promise =
  process.argv[2] === "instantiateStreaming"
    ? WebAssembly.instantiateStreaming(response)
    : WebAssembly.compileStreaming(response);

promise.then(
  () => console.log("settled"),
  error => {
    console.error(error);
    process.exit(1);
  },
);
