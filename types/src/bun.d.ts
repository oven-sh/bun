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

export interface Crypto {
  getRandomValues(array: TypedArray): void;
  randomUUID(): string;
}

declare namespace WebPlatform {
  export type Encoding = "utf-8" | "windows-1252" | "utf-16";
}

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
export declare class TextEncoder {
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

export declare class TextDecoder {
  constructor(
    encoding?: WebPlatform.Encoding,
    options?: { fatal?: boolean; ignoreBOM?: boolean }
  );

  encoding: WebPlatform.Encoding;
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

export declare interface FetchEvent {
  request: Request;
  respondWith(r: Response | PromiseLike<Response>): void;
}

export function addEventListener(
  event: "fetch",
  listener: (event: FetchEvent) => Promise<void>
): void;

export declare namespace Bun {
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
    transform(code: StringOrBuffer, loader?: JavaScriptLoader): Promise<string>;
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
}
