interface VoidFunction {
  (): void;
}

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

  /** This Fetch API interface allows you to perform various actions on HTTP request and response headers. These actions include retrieving, setting, adding to, and removing. A Headers object has an associated header list, which is initially empty and consists of zero or more name and value pairs.  You can add to this using methods like append() (see Examples.) In all methods of this interface, header names are matched by case-insensitive byte sequence. */
  export interface Headers {
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(
      callbackfn: (value: string, key: string, parent: Headers) => void,
      thisArg?: any
    ): void;
  }

  var Headers: {
    prototype: Headers;
    new (init?: HeadersInit): Headers;
  };

  type HeadersInit = [string, string][] | Record<string, string> | Headers;

  export class Blob implements BlobInterface {
    slice(begin?: number, end?: number): Blob;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<JSON>;
  }

  export class Response implements BlobInterface {
    constructor(
      body: BlobPart | BlobPart[] | Blob,
      options?: {
        headers?: HeadersInit;
        /** @default 200 */
        status?: number;
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

    /**
     * Pretty-print an object the same as console.log()
     * Except, it returns a string instead of printing it.
     * @param args
     */
    export function inspect(...args: any): string;

    interface MMapOptions {
      /**
       * Sets MAP_SYNC flag on Linux. macOS doesn't support this flag
       */
      sync?: boolean;
      /**
       * Allow other processes to see results instantly?
       * This enables MAP_SHARED. If false, it enables MAP_PRIVATE.
       * @default true
       */
      shared?: boolean;
    }
    /**
     * Open a file as a live-updating `Uint8Array` without copying memory
     * - Writing to the array writes to the file.
     * - Reading from the array reads from the file.
     *
     * This uses the [`mmap()`](https://man7.org/linux/man-pages/man2/mmap.2.html) syscall under the hood.
     *
     * ---
     *
     * This API inherently has some rough edges:
     * - It does not support empty files. It will throw a `SystemError` with `EINVAL`
     * - Usage on shared/networked filesystems is discouraged. It will be very slow.
     * - If you delete or truncate the file, that will crash bun. This is called a segmentation fault.
     *
     * ---
     *
     * To close the file, set the array to `null` and it will be garbage collected eventually.
     *
     */
    export function mmap(path: PathLike, opts?: MMapOptions): Uint8Array;
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

  // -----------------------
  // -----------------------
  // --- libdom.d.ts

  interface ErrorEventInit extends EventInit {
    colno?: number;
    error?: any;
    filename?: string;
    lineno?: number;
    message?: string;
  }

  interface EventInit {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
  }

  interface EventListenerOptions {
    capture?: boolean;
  }

  interface UIEventInit extends EventInit {
    detail?: number;
    view?: null;
    /** @deprecated */
    which?: number;
  }

  interface EventModifierInit extends UIEventInit {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    modifierAltGraph?: boolean;
    modifierCapsLock?: boolean;
    modifierFn?: boolean;
    modifierFnLock?: boolean;
    modifierHyper?: boolean;
    modifierNumLock?: boolean;
    modifierScrollLock?: boolean;
    modifierSuper?: boolean;
    modifierSymbol?: boolean;
    modifierSymbolLock?: boolean;
    shiftKey?: boolean;
  }

  interface EventSourceInit {
    withCredentials?: boolean;
  }

  /** A controller object that allows you to abort one or more DOM requests as and when desired. */
  interface AbortController {
    /**
     * Returns the AbortSignal object associated with this object.
     */
    readonly signal: AbortSignal;
    /**
     * Invoking this method will set this object's AbortSignal's aborted flag and signal to any observers that the associated activity is to be aborted.
     */
    abort(): void;
  }

  /** EventTarget is a DOM interface implemented by objects that can receive events and may have listeners for them. */
  interface EventTarget {
    /**
     * Appends an event listener for events whose type attribute value is type. The callback argument sets the callback that will be invoked when the event is dispatched.
     *
     * The options argument sets listener-specific options. For compatibility this can be a boolean, in which case the method behaves exactly as if the value was specified as options's capture.
     *
     * When set to true, options's capture prevents callback from being invoked when the event's eventPhase attribute value is BUBBLING_PHASE. When false (or not present), callback will not be invoked when event's eventPhase attribute value is CAPTURING_PHASE. Either way, callback will be invoked if event's eventPhase attribute value is AT_TARGET.
     *
     * When set to true, options's passive indicates that the callback will not cancel the event by invoking preventDefault(). This is used to enable performance optimizations described in § 2.8 Observing event listeners.
     *
     * When set to true, options's once indicates that the callback will only be invoked once after which the event listener will be removed.
     *
     * If an AbortSignal is passed for options's signal, then the event listener will be removed when signal is aborted.
     *
     * The event listener is appended to target's event listener list and is not appended if it has the same type, callback, and capture.
     */
    addEventListener(
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean
    ): void;
    /** Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise. */
    dispatchEvent(event: Event): boolean;
    /** Removes the event listener in target's event listener list with the same type, callback, and options. */
    removeEventListener(
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: EventListenerOptions | boolean
    ): void;
  }

  var EventTarget: {
    prototype: EventTarget;
    new (): EventTarget;
  };

  /** An event which takes place in the DOM. */
  interface Event {
    /** Returns true or false depending on how event was initialized. True if event goes through its target's ancestors in reverse tree order, and false otherwise. */
    readonly bubbles: boolean;
    cancelBubble: boolean;
    /** Returns true or false depending on how event was initialized. Its return value does not always carry meaning, but true can indicate that part of the operation during which event was dispatched, can be canceled by invoking the preventDefault() method. */
    readonly cancelable: boolean;
    /** Returns true or false depending on how event was initialized. True if event invokes listeners past a ShadowRoot node that is the root of its target, and false otherwise. */
    readonly composed: boolean;
    /** Returns the object whose event listener's callback is currently being invoked. */
    readonly currentTarget: EventTarget | null;
    /** Returns true if preventDefault() was invoked successfully to indicate cancelation, and false otherwise. */
    readonly defaultPrevented: boolean;
    /** Returns the event's phase, which is one of NONE, CAPTURING_PHASE, AT_TARGET, and BUBBLING_PHASE. */
    readonly eventPhase: number;
    /** Returns true if event was dispatched by the user agent, and false otherwise. */
    readonly isTrusted: boolean;
    /** @deprecated */
    returnValue: boolean;
    /** @deprecated */
    readonly srcElement: EventTarget | null;
    /** Returns the object to which event is dispatched (its target). */
    readonly target: EventTarget | null;
    /** Returns the event's timestamp as the number of milliseconds measured relative to the time origin. */
    readonly timeStamp: DOMHighResTimeStamp;
    /** Returns the type of event, e.g. "click", "hashchange", or "submit". */
    readonly type: string;
    /** Returns the invocation target objects of event's path (objects on which listeners will be invoked), except for any nodes in shadow trees of which the shadow root's mode is "closed" that are not reachable from event's currentTarget. */
    composedPath(): EventTarget[];
    /** @deprecated */
    initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
    /** If invoked when the cancelable attribute value is true, and while executing a listener for the event with passive set to false, signals to the operation that caused event to be dispatched that it needs to be canceled. */
    preventDefault(): void;
    /** Invoking this method prevents event from reaching any registered event listeners after the current one finishes running and, when dispatched in a tree, also prevents event from reaching any other objects. */
    stopImmediatePropagation(): void;
    /** When dispatched in a tree, invoking this method prevents event from reaching any objects other than the current object. */
    stopPropagation(): void;
    readonly AT_TARGET: number;
    readonly BUBBLING_PHASE: number;
    readonly CAPTURING_PHASE: number;
    readonly NONE: number;
  }

  var Event: {
    prototype: Event;
    new (type: string, eventInitDict?: EventInit): Event;
    readonly AT_TARGET: number;
    readonly BUBBLING_PHASE: number;
    readonly CAPTURING_PHASE: number;
    readonly NONE: number;
  };

  /** Events providing information related to errors in scripts or in files. */
  interface ErrorEvent extends Event {
    readonly colno: number;
    readonly error: any;
    readonly filename: string;
    readonly lineno: number;
    readonly message: string;
  }

  var ErrorEvent: {
    prototype: ErrorEvent;
    new (type: string, eventInitDict?: ErrorEventInit): ErrorEvent;
  };

  /** The URL interface represents an object providing static methods used for creating object URLs. */
  interface URL {
    hash: string;
    host: string;
    hostname: string;
    href: string;
    toString(): string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    readonly searchParams: URLSearchParams;
    username: string;
    toJSON(): string;
  }

  interface URLSearchParams {
    /** Appends a specified key/value pair as a new search parameter. */
    append(name: string, value: string): void;
    /** Deletes the given search parameter, and its associated value, from the list of all search parameters. */
    delete(name: string): void;
    /** Returns the first value associated to the given search parameter. */
    get(name: string): string | null;
    /** Returns all the values association with a given search parameter. */
    getAll(name: string): string[];
    /** Returns a Boolean indicating if such a search parameter exists. */
    has(name: string): boolean;
    /** Sets the value associated to a given search parameter to the given value. If there were several values, delete the others. */
    set(name: string, value: string): void;
    sort(): void;
    /** Returns a string containing a query string suitable for use in a URL. Does not include the question mark. */
    toString(): string;
    forEach(
      callbackfn: (value: string, key: string, parent: URLSearchParams) => void,
      thisArg?: any
    ): void;
  }

  var URLSearchParams: {
    prototype: URLSearchParams;
    new (
      init?: string[][] | Record<string, string> | string | URLSearchParams
    ): URLSearchParams;
    toString(): string;
  };

  var URL: {
    prototype: URL;
    new (url: string | URL, base?: string | URL): URL;
    /** Not implemented yet */
    createObjectURL(obj: Blob): string;
    /** Not implemented yet */
    revokeObjectURL(url: string): void;
  };

  type TimerHandler = Function;

  interface EventListener {
    (evt: Event): void;
  }

  interface EventListenerObject {
    handleEvent(object: Event): void;
  }

  var AbortController: {
    prototype: AbortController;
    new (): AbortController;
  };

  interface FetchEvent extends Event {
    readonly request: Request;
    readonly url: string;

    waitUntil(promise: Promise<any>): void;
    respondWith(response: Response): void;
    respondWith(response: Promise<Response>): void;
  }

  interface EventMap {
    fetch: FetchEvent;
    // exit: Event;
  }

  interface AbortSignalEventMap {
    abort: Event;
  }

  interface AddEventListenerOptions extends EventListenerOptions {
    once?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
  }

  /** A signal object that allows you to communicate with a DOM request (such as a Fetch) and abort it if required via an AbortController object. */
  interface AbortSignal extends EventTarget {
    /**
     * Returns true if this AbortSignal's AbortController has signaled to abort, and false otherwise.
     */
    readonly aborted: boolean;
    onabort: ((this: AbortSignal, ev: Event) => any) | null;
    addEventListener<K extends keyof AbortSignalEventMap>(
      type: K,
      listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
      options?: boolean | AddEventListenerOptions
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ): void;
    removeEventListener<K extends keyof AbortSignalEventMap>(
      type: K,
      listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
      options?: boolean | EventListenerOptions
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ): void;
  }

  var AbortSignal: {
    prototype: AbortSignal;
    new (): AbortSignal;
  };

  function clearInterval(id?: number): void;
  function clearTimeout(id?: number): void;
  // declare function createImageBitmap(image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>;
  // declare function createImageBitmap(image: ImageBitmapSource, sx: number, sy: number, sw: number, sh: number, options?: ImageBitmapOptions): Promise<ImageBitmap>;
  // declare function fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  function queueMicrotask(callback: VoidFunction): void;
  function reportError(e: any): void;
  function setInterval(
    handler: TimerHandler,
    timeout?: number,
    ...arguments: any[]
  ): number;
  function setTimeout(
    handler: TimerHandler,
    timeout?: number,
    ...arguments: any[]
  ): number;
  function addEventListener<K extends keyof EventMap>(
    type: K,
    listener: (this: Object, ev: EventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  function addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  function removeEventListener<K extends keyof EventMap>(
    type: K,
    listener: (this: Object, ev: EventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;
  function removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;

  // type AlgorithmIdentifier = Algorithm | string;
  type BigInteger = Uint8Array;
  type BinaryData = ArrayBuffer | ArrayBufferView;
  // type BodyInit = ReadableStream | XMLHttpRequestBodyInit;
  type BufferSource = ArrayBufferView | ArrayBuffer;
  type COSEAlgorithmIdentifier = number;
  type CSSNumberish = number;
  // type CanvasImageSource =
  //   | HTMLOrSVGImageElement
  //   | HTMLVideoElement
  //   | HTMLCanvasElement
  //   | ImageBitmap;
  type DOMHighResTimeStamp = number;
  type EpochTimeStamp = number;
  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;
}

export {};
