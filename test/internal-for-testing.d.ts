// "bun:internal-for-testing" resolves to src/js/internal-for-testing.ts, which calls these. src/js/private.d.ts and
// src/js/builtins.d.ts declare them, next to changes to `Error`, `Function` and other global interfaces that only
// apply to builtins.
declare function $cpp<T = any>(filename: string, symbol: string): T;
declare function $rust<T = any>(filename: string, symbol: string): T;
declare function $newCppFunction<T = (...args: any) => any>(filename: string, symbol: string, argCount: number): T;
declare function $newRustFunction<T = (...args: any) => any>(filename: string, symbol: string, argCount: number): T;
declare function $bindgenFn<T = (...args: any) => any>(filename: string, symbol: string): T;
declare function $ERR_INVALID_ARG_VALUE(name: string, value: any, reason?: string): TypeError;
declare function $ERR_IPC_ONE_PIPE(): Error;
declare function $webStreamClosedPromise(stream: ReadableStream | WritableStream): Promise<void>;
declare function $inheritsWritableStream(value: unknown): value is WritableStream;
