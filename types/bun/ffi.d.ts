/**
 * `bun:ffi` lets you efficiently call C functions & FFI functions from JavaScript
 *  without writing any C code yourself.
 *
 * ```js
 * import {dlopen, CString, ptr} from 'bun:ffi';
 *
 * const lib = dlopen('libsqlite3', {});
 *
 *
 * ```
 *
 * This is powered by just-in-time compiling C wrappers
 * that convert JavaScript types to C types and back. Internally,
 * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
 * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
 *
 */
declare module "bun:ffi" {
  export enum FFIType {
    char = 0,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -127 and 127
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int8_t = 1,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -127 and 127
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i8 = 1,

    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint8_t = 2,
    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u8 = 2,

    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * in16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int16_t = 3,
    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * in16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i16 = 3,

    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint16_t = 4,
    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to a FFI function (C ABI), type coercsion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u16 = 4,

    /**
     * 32-bit signed integer
     *
     */
    int32_t = 5,

    /**
     * 32-bit signed integer
     *
     * Alias of {@link FFIType.int32_t}
     */
    i32 = 5,
    /**
     * 32-bit signed integer
     *
     * The same as `int` in C
     *
     * ```c
     * int
     * ```
     */
    int = 5,

    /**
     * 32-bit unsigned integer
     *
     * The same as `unsigned int` in C (on x64 & arm64)
     *
     * C:
     * ```c
     * unsigned int
     * ```
     * JavaScript:
     * ```js
     * ptr(new Uint32Array(1))
     * ```
     */
    uint32_t = 6,
    /**
     * 32-bit unsigned integer
     *
     * Alias of {@link FFIType.uint32_t}
     */
    u32 = 6,

    /**
     * int64 is a 64-bit signed integer
     *
     * This is not implemented yet!
     */
    int64_t = 7,
    /**
     * i64 is a 64-bit signed integer
     *
     * This is not implemented yet!
     */
    i64 = 7,

    /**
     * 64-bit unsigned integer
     *
     * This is not implemented yet!
     */
    uint64_t = 8,
    /**
     * 64-bit unsigned integer
     *
     * This is not implemented yet!
     */
    u64 = 8,

    /**
     * Doubles are not supported yet!
     */
    double = 9,
    /**
     * Doubles are not supported yet!
     */
    f64 = 9,
    /**
     * Floats are not supported yet!
     */
    float = 10,
    /**
     * Floats are not supported yet!
     */
    f32 = 10,

    /**
     * Booelan value
     *
     * Must be `true` or `false`. `0` and `1` type coercion is not supported.
     *
     * In C, this corresponds to:
     * ```c
     * bool
     * _Bool
     * ```
     *
     *
     */
    bool = 11,

    /**
     * Pointer value
     *
     * See {@link Bun.FFI.ptr} for more information
     *
     * In C:
     * ```c
     * void*
     * ```
     *
     * In JavaScript:
     * ```js
     * ptr(new Uint8Array(1))
     * ```
     */
    ptr = 12,
    /**
     * Pointer value
     *
     * alias of {@link FFIType.ptr}
     */
    pointer = 12,

    /**
     * void value
     *
     * void arguments are not supported
     *
     * void return type is the default return type
     *
     * In C:
     * ```c
     * void
     * ```
     *
     */
    void = 13,
  }

  type Symbols = Record<
    string,
    {
      /**
       * Arguments to a FFI function (C ABI)
       *
       * Defaults to an empty array, which means no arguments.
       *
       * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
       *
       * @example
       * From JavaScript:
       * ```js
       * const lib = dlopen('add', {
       *    // FFIType can be used or you can pass string labels.
       *    args: [FFIType.i32, "i32"],
       *    return_type: "i32",
       * });
       * lib.symbols.add(1, 2)
       * ```
       * In C:
       * ```c
       * int add(int a, int b) {
       *   return a + b;
       * }
       * ```
       */
      args?: FFIType[];
      /**
       * Return type to a FFI function (C ABI)
       *
       * Defaults to an empty array, which means no arguments.
       *
       * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
       *
       * @example
       * From JavaScript:
       * ```js
       * const lib = dlopen('add', {
       *    // FFIType can be used or you can pass string labels.
       *    args: [FFIType.i32, "i32"],
       *    return_type: "i32",
       * });
       * lib.symbols.add(1, 2)
       * ```
       * In C:
       * ```c
       * int add(int a, int b) {
       *   return a + b;
       * }
       * ```
       */
      return_type?: FFIType;
    }
  >;

  export interface Library {
    symbols: Record<string, CallableFunction>;

    /**
     * `dlclose` the library, unloading the symbols and freeing memory allocated.
     *
     * Once called, the library is no longer usable.
     *
     * Calling a function from a library that has been closed is undefined behavior.
     */
    close(): void;
  }

  export function dlopen(libraryName: string, symbols: Symbols): Library<T>;

  /**
   * Read a pointer as a {@link Buffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   *
   */
  export function toBuffer(
    ptr: number,
    byteOffset?: number,
    byteLength?: number
  ): Buffer;

  /**
   * Read a pointer as an {@link ArrayBuffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */
  export function toArrayBuffer(
    ptr: number,
    byteOffset?: number,
    byteLength?: number
  ): ArrayBuffer;

  /**
   * Get the pointer backing a {@link TypedArray} or {@link ArrayBuffer}
   *
   * Use this to pass {@link TypedArray} or {@link ArrayBuffer} to C functions.
   *
   * This is for use with FFI functions. For performance reasons, FFI will
   * not automatically convert typed arrays to C pointers.
   *
   * @param {TypedArray|ArrayBuffer|DataView} view the typed array or array buffer to get the pointer for
   * @param {number} byteOffset optional offset into the view in bytes
   *
   * @example
   *
   * From JavaScript:
   * ```js
   * const array = new Uint8Array(10);
   * const rawPtr = ptr(array);
   * myCFunction(rawPtr);
   * ```
   * To C:
   * ```c
   * void myCFunction(char* rawPtr) {
   *  // Do something with rawPtr
   * }
   * ```
   *
   */
  export function ptr(
    view: TypedArray | ArrayBufferLike | DataView,
    byteOffset?: number
  ): number;

  /**
   * Get a string from a UTF-8 encoded C string
   * If `byteLength` is not provided, the string is assumed to be null-terminated.
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * console.log(new CString(ptr));
   * ```
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * // print the first 4 characters
   * console.log(new CString(ptr, 0, 4));
   * ```
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */

  export class CString extends String {
    /**
     * Get a string from a UTF-8 encoded C string
     * If `byteLength` is not provided, the string is assumed to be null-terminated.
     *
     * @param ptr The pointer to the C string
     * @param byteOffset bytes to skip before reading
     * @param byteLength bytes to read
     *
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * console.log(new CString(ptr));
     * ```
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * // print the first 4 characters
     * console.log(new CString(ptr, 0, 4));
     * ```
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    constructor(ptr: number, byteOffset?: number, byteLength?: number): string;
  }

  /**
   * View the generated C code for FFI bindings
   *
   * You probably won't need this unless there's a bug in the FFI bindings
   * generator or you're just curious.
   */
  export function viewSource(symbols: Symbols): string[];
}
