// bun.js v

/**  Filesystem Router supporting dynamic routes, exact routes, catch-all routes, and optional catch-all routes. Implemented in native code and only available with bun.js.  */
declare module "bun.js/router" {
  /**  Match a {@link https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent FetchEvent} to a `Route` from the local filesystem. Returns `null` if there is no match.  */
  function match(event: FetchEvent): Route | null;

  /**  Match a `pathname` to a `Route` from the local filesystem. Returns `null` if there is no match.  */
  function match(pathname: string): Route | null;

  /**  Match a {@link https://developer.mozilla.org/en-US/docs/Web/API/Request Request} to a `Route` from the local filesystem. Returns `null` if there is no match.  */
  function match(request: Request): Route | null;
  /**  Route matched from the filesystem.  */
  export interface Route {
    /**  URL path as appears in a web browser's address bar  */
    readonly pathname: string;

    /**  Project-relative filesystem path to the route file.  */
    readonly filepath: string;

    readonly kind: "exact" | "dynamic" | "catch-all" | "optional-catch-all";

    /**
     *  Route name
     *  @example
     *  `"blog/posts/[id]"`
     *  `"blog/posts/[id]/[[...slug]]"`
     *  `"blog"`
     */
    readonly name: string;

    /**
     *  Route parameters as a key-value object
     *
     *  @example
     *  ```js
     *  console.assert(router.query.id === "123");
     *  console.assert(router.pathname === "/blog/posts/123");
     *  console.assert(router.route === "blog/posts/[id]");
     *  ```
     */
    readonly query: Record<string, string | string[]>;

    /**  Synchronously load & evaluate the file corresponding to the route. Returns the exports of the route. This is similar to `await import(route.filepath)`, except it's synchronous. It is recommended to use this function instead of `import`.  */
    import(): Object;
  }
}
