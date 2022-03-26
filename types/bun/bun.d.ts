declare global {
  export interface EncodeIntoResult {
    /**
     * The read Unicode code units of input.
     */
    read: number;
    /**
     * The written UTF-8 bytes of output.
     */
    written: number;
  }

  export interface Process {
    version: string;
    nextTick(callback, ...args): void;
    versions: Record<string, string>;
    ppid: number;
    pid: number;
    arch:
      | "arm64"
      | "arm"
      | "ia32"
      | "mips"
      | "mipsel"
      | "ppc"
      | "ppc64"
      | "s390"
      | "s390x"
      | "x32"
      | "x64"
      | "x86";
    platform: "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32";
    argv: string[];
    // execArgv: string[];
    env: Record<string, string> & {
      NODE_ENV: string;
    };
    // execPath: string;
    // abort(): void;
    chdir(directory: string): void;
    cwd(): string;
    exit(code?: number): void;
    getgid(): number;
    setgid(id: number | string): void;
    getuid(): number;
    setuid(id: number | string): void;
  }

  export var process: Process;

  export interface BlobInterface {
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<JSON>;
  }

  type BlobPart = string | Blob | ArrayBufferView | ArrayBuffer | FileBlob;
  interface BlobPropertyBag {
    /** Set a default "type" */
    type?: string;

    /** Not implemented in Bun yet. */
    endings?: "transparent" | "native";
  }

  type HeadersInit = string[][] | Record<string, string> | Headers;

  export class Blob implements BlobInterface {
    slice(begin?: number, end?: number): Blob;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<JSON>;
  }

  export class Response implements BlobInterface {
    constructor(
      body: BlobPart | BlobPart[] | Blob,
      options: {
        headers?: HeadersInit;
      }
    );
    headers: Headers;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<JSON>;
  }

  export class Request implements BlobInterface {
    constructor(
      body: BlobPart | BlobPart[] | Blob,
      options: {
        headers?: HeadersInit;
      }
    );
    headers: Headers;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<JSON>;
  }

  export interface Crypto {
    getRandomValues(array: TypedArray): void;
    randomUUID(): string;
  }

  var crypto: Crypto;

  /**
   * [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/atob) converts ascii text into base64.
   *
   * @param asciiText The ascii text to convert.
   */
  export function atob(asciiText: string): string;
  export function btoa(base64Text: string): string;

  /**
   * An implementation of the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) `TextEncoder` API. All
   * instances of `TextEncoder` only support UTF-8 encoding.
   *
   * ```js
   * const encoder = new TextEncoder();
   * const uint8array = encoder.encode('this is some data');
   * ```
   *
   */
  export class TextEncoder {
    constructor(encoding?: "utf-8");
    readonly encoding: "utf-8";

    /**
     * UTF-8 encodes the `input` string and returns a `Uint8Array` containing the
     * encoded bytes.
     * @param [input='an empty string'] The text to encode.
     */
    encode(input?: string): Uint8Array;
    /**
     * UTF-8 encodes the `src` string to the `dest` Uint8Array and returns an object
     * containing the read Unicode code units and written UTF-8 bytes.
     *
     * ```js
     * const encoder = new TextEncoder();
     * const src = 'this is some data';
     * const dest = new Uint8Array(10);
     * const { read, written } = encoder.encodeInto(src, dest);
     * ```
     * @param src The text to encode.
     * @param dest The array to hold the encode result.
     */
    encodeInto(src?: string, dest?: TypedArray): EncodeIntoResult;
  }

  export class TextDecoder {
    constructor(
      encoding?: Bun.WebPlatform.Encoding,
      options?: { fatal?: boolean; ignoreBOM?: boolean }
    );

    encoding: Bun.WebPlatform.Encoding;
    ignoreBOM: boolean;
    fatal: boolean;

    /**
     * Decodes the `input` and returns a string. If `options.stream` is `true`, any
     * incomplete byte sequences occurring at the end of the `input` are buffered
     * internally and emitted after the next call to `textDecoder.decode()`.
     *
     * If `textDecoder.fatal` is `true`, decoding errors that occur will result in a`TypeError` being thrown.
     * @param input An `ArrayBuffer`, `DataView` or `TypedArray` instance containing the encoded data.
     */
    decode(input?: TypedArray | ArrayBuffer): string;
  }

  type TypedArray =
    | Uint8Array
    | Int8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

  namespace Bun {
    namespace WebPlatform {
      export type Encoding = "utf-8" | "windows-1252" | "utf-16";
    }

    type Platform =
      /**
       * When building for bun.js
       */
      | "bun"
      /**
       * When building for the web
       */
      | "browser"
      /**
       * When building for node.js
       */
      | "node"
      | "neutral";

    // This lets you use macros
    interface MacroMap {
      // @example
      // ```
      // {
      //   "react-relay": {
      //     "graphql": "bun-macro-relay/bun-macro-relay.tsx"
      //   }
      // }
      // ```
      [packagePath: string]: {
        [importItemName: string]: string;
      };
    }

    export type StringOrBuffer = string | TypedArray | ArrayBufferLike;
    export type PathLike = string | TypedArray | ArrayBufferLike;

    export interface FetchEvent {
      request: Request;
      respondWith(r: Response | PromiseLike<Response>): void;
    }

    export function addEventListener(
      event: "fetch",
      listener: (event: FetchEvent) => Promise<void> | void
    ): void;

    type JavaScriptLoader = "jsx" | "js" | "ts" | "tsx";

    interface TranspilerOptions {
      /** Replace key with value. Value must be a JSON string.
     @example
     ```
     { "process.env.NODE_ENV": "\"production\"" }
     ```
    */
      define?: Record<string, string>;

      /** What is the default loader used for this transpiler?  */
      loader?: JavaScriptLoader;

      /**  What platform are we targeting? This may affect how import and/or require is used */
      /**  @example "browser" */
      platform?: Platform;

      /**
       TSConfig.json file as stringified JSON or an object
       Use this to set a custom JSX factory, fragment, or import source
       For example, if you want to use Preact instead of React. Or if you want to use Emotion.
     */
      tsconfig?: string;

      /** 
     Replace an import statement with a macro.

     This will remove the import statement from the final output
     and replace any function calls or template strings with the result returned by the macro

    @example
    ```json
    {
        "react-relay": {
            "graphql": "bun-macro-relay"
        }
    }
    ```

    Code that calls `graphql` will be replaced with the result of the macro.

    ```js
    import {graphql} from "react-relay";

    // Input:
    const query = graphql`
        query {
            ... on User {
                id
            }
        }
    }`;
    ```

    Will be replaced with:
    
    ```js
    import UserQuery from "./UserQuery.graphql";
    const query = UserQuery;
    ```
    */
      macros: MacroMap;
    }

    export class Transpiler {
      constructor(options: TranspilerOptions);

      /** Transpile code from TypeScript or JSX into valid JavaScript.
       * This function does not resolve imports.
       * @param code The code to transpile
       */
      transform(
        code: StringOrBuffer,
        loader?: JavaScriptLoader
      ): Promise<string>;
      /** Transpile code from TypeScript or JSX into valid JavaScript.
       * This function does not resolve imports.
       * @param code The code to transpile
       */
      transformSync(code: StringOrBuffer, loader?: JavaScriptLoader): string;

      /** Get a list of import paths and export paths from a TypeScript, JSX, TSX, or JavaScript file.
       * @param code The code to scan
       * @example
       * ```js
       * const {imports, exports} = transpiler.scan(`
       * import {foo} from "baz";
       * export const hello = "hi!";
       * `);
       *
       * console.log(imports); // ["baz"]
       * console.log(exports); // ["hello"]
       * ```
       */
      scan(code: StringOrBuffer): { exports: string[]; imports: Import[] };

      /** Get a list of import paths from a TypeScript, JSX, TSX, or JavaScript file.
       * @param code The code to scan
       * @example
       * ```js
       * const imports = transpiler.scanImports(`
       * import {foo} from "baz";
       * import type {FooType} from "bar";
       * import type {DogeType} from "wolf";
       * `);
       *
       * console.log(imports); // ["baz"]
       * ```
       * This is a fast path which performs less work than `scan`.
       */
      scanImports(code: StringOrBuffer): Import[];
    }

    type Import = {
      path: string;

      kind:
        | "import-statement"
        | "require-call"
        | "require-resolve"
        | "dynamic-import"
        | "import-rule"
        | "url-token"
        | "internal"
        | "entry-point";
    };

    export interface HTTP {
      /**
       * What port should the server listen on?
       * @default process.env.PORT || "3000"
       */
      port?: string | number;
      /**
       * What hostname should the server listen on?
       * @default "0.0.0.0" // listen on all interfaces
       * @example "127.0.0.1" // Only listen locally
       * @example "remix.run" // Only listen on remix.run
       */
      hostname?: string;

      /**
       * What is the maximum size of a request body? (in bytes)
       * @default 1024 * 1024 * 128 // 128MB
       */
      maxRequestBodySize?: number;

      /**
       * Render contextual errors? This enables bun's error page
       * @default process.env.NODE_ENV !== 'production'
       */
      development?: boolean;

      fetch(request: Request): Response | Promise<Response>;

      error?: (
        request: Errorlike
      ) => Response | Promise<Response> | undefined | Promise<undefined>;
    }

    interface Errorlike extends Error {
      code?: string;
      errno?: number;
      syscall?: string;
    }

    interface SSLAdvancedOptions {
      passphrase?: string;
      caFile?: string;
      dhParamsFile?: string;

      /**
       * This sets `OPENSSL_RELEASE_BUFFERS` to 1.
       * It reduces overall performance but saves some memory.
       * @default false
       */
      lowMemoryMode?: boolean;
    }
    interface SSLOptions {
      /**
       * File path to a TLS key
       *
       * To enable TLS, this option is required.
       */
      keyFile: string;
      /**
       * File path to a TLS certificate
       *
       * To enable TLS, this option is required.
       */
      certFile: string;
    }

    export type SSLServeOptions = HTTP &
      SSLOptions &
      SSLAdvancedOptions & {
        /** 
          The keys are [SNI](https://en.wikipedia.org/wiki/Server_Name_Indication) hostnames.
          The values are SSL options objects. 
        */
        serverNames: Record<string, SSLOptions & SSLAdvancedOptions>;
      };

    export type Serve = SSLServeOptions | HTTP;
    export function serve(options?: Serve): void;

    /**
     * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
     *
     * This Blob is lazy. That means it won't do any work until you read from it.
     *
     * - `size` will not be valid until the contents of the file are read at least once.
     * - `type` is auto-set based on the file extension when possible
     *
     * @example
     * ```js
     * const file = Bun.file("./hello.json");
     * console.log(file.type); // "application/json"
     * console.log(await file.json()); // { hello: "world" }
     * ```
     *
     * @example
     * ```js
     * await Bun.write(
     *   Bun.file("./hello.txt"),
     *   "Hello, world!"
     * );
     * ```
     * @param path The path to the file (lazily loaded)
     *
     */
    export function file(path: string, options?: BlobPropertyBag): FileBlob;

    /**
     * `Blob` that leverages the fastest system calls available to operate on files.
     *
     * This Blob is lazy. It won't do any work until you read from it. Errors propagate as promise rejections.
     *
     * `Blob.size` will not be valid until the contents of the file are read at least once.
     * `Blob.type` will have a default set based on the file extension
     *
     * @example
     * ```js
     * const file = Bun.file(new TextEncoder.encode("./hello.json"));
     * console.log(file.type); // "application/json"
     * ```
     *
     * @param path The path to the file as a byte buffer (the buffer is copied)
     */
    export function file(
      path: ArrayBufferLike | Uint8Array,
      options?: BlobPropertyBag
    ): FileBlob;

    /**
     * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
     *
     * This Blob is lazy. That means it won't do any work until you read from it.
     *
     * - `size` will not be valid until the contents of the file are read at least once.
     *
     * @example
     * ```js
     * const file = Bun.file(fd);
     * ```
     *
     * @param fileDescriptor The file descriptor of the file
     */
    export function file(
      fileDescriptor: number,
      options?: BlobPropertyBag
    ): FileBlob;
  }

  export interface Blob {
    /**
     * Read the contents of the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as a JSON object
     * @warn in browsers, this function is only available for `Response` and `Request`
     */
    json(): Promise<any>;
    /**
     * Read the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as a UTF-8 string
     * @link https://developer.mozilla.org/en-US/docs/Web/API/Blob/text
     */
    text(): Promise<string>;
    /**
     * Read the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as an ArrayBuffer object
     * @link https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer
     */
    arrayBuffer(): Promise<ArrayBuffer>;
  }

  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy. That means it won't do any work until you read from it.
   *
   * - `size` will not be valid until the contents of the file are read at least once.
   * - `type` is auto-set based on the file extension when possible
   *
   * @example
   * ```js
   * const file = Bun.file("./hello.json");
   * console.log(file.type); // "application/json"
   * console.log(await file.text()); // '{"hello":"world"}'
   * ```
   *
   * @example
   * ```js
   * await Bun.write(
   *   Bun.file("./hello.txt"),
   *   "Hello, world!"
   * );
   * ```
   *
   */
  export interface FileBlob extends Blob {
    /** Currently, "name" is not exposed because it may or may not exist */
    name: never;
  }
}
export {};
