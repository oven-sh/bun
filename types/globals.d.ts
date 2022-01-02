// bun.js v

declare global {
  function addEventListener(
    name: "fetch",
    callback: (event: FetchEvent) => void
  ): void;
}

declare global {
  export interface FetchEvent {
    /**  HTTP client metadata. This is not implemented yet, do not use.  */
    readonly client: undefined;

    /**  HTTP request  */
    readonly request: InstanceType<Request>;

    /**  Render the response in the active HTTP request  */
    respondWith(response: Response): void;
  }
}

export {};
