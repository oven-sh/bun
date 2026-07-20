/**
 * Request observation and interception.
 *
 * Many install tests care as much about *how* bun talked to the registry
 * as about what got installed: which URLs it hit and in what order,
 * whether it re-requested a cached manifest, which headers it sent,
 * whether it retried after a 5xx. The registry records every request it
 * sees so tests can assert on that directly instead of asserting inside
 * the server handler (where a failed expectation answers the install
 * with a 500 and only reaches the test when `stop()` rethrows it).
 *
 * Interceptors run before routing and can replace any response. They are
 * the escape hatch for scenarios a spec-compliant registry would never
 * produce on its own: transient 5xx, truncated tarballs, bad integrity.
 */

/** An immutable record of one request the registry received. */
export interface ObservedRequest {
  /** 0-based arrival order. */
  readonly index: number;
  readonly method: string;
  /** The full request URL. */
  readonly url: string;
  /** `new URL(url).pathname`, percent-decoded once (so `%2f` reads as `/`). */
  readonly path: string;
  /** A snapshot of the request headers. */
  readonly headers: Headers;
}

/** `decodeURIComponent`, or the input verbatim when it is malformed. */
function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * A hook that may replace the response for a request. Returning
 * `undefined` (or a promise of it) lets the request fall through to the
 * next interceptor and then to normal routing. Each interceptor receives
 * its own clone of the request, so reading the body does not consume the
 * stream the route handler (or the next interceptor) reads.
 */
export type Interceptor = (
  request: Request,
  observed: ObservedRequest,
) => Response | undefined | Promise<Response | undefined>;

export class RequestObserver {
  /** Every request the registry has received, in arrival order. */
  readonly requests: ObservedRequest[] = [];
  readonly #interceptors: Interceptor[] = [];

  /** The number of requests received so far. */
  get count(): number {
    return this.requests.length;
  }

  /** The request URLs in arrival order. */
  get urls(): string[] {
    return this.requests.map(r => r.url);
  }

  /** The request paths in arrival order. */
  get paths(): string[] {
    return this.requests.map(r => r.path);
  }

  /** Forget every recorded request (interceptors are untouched). */
  clear(): void {
    this.requests.length = 0;
  }

  record(request: Request): ObservedRequest {
    const url = new URL(request.url);
    const observed: ObservedRequest = {
      index: this.requests.length,
      method: request.method,
      url: request.url,
      path: safeDecodeURIComponent(url.pathname),
      headers: new Headers(request.headers),
    };
    this.requests.push(observed);
    return observed;
  }

  /**
   * Installs an interceptor. Interceptors run in registration order; the
   * first one to return a `Response` wins. Returns a function that
   * uninstalls it.
   */
  intercept(interceptor: Interceptor): () => void {
    this.#interceptors.push(interceptor);
    return () => {
      const i = this.#interceptors.indexOf(interceptor);
      if (i !== -1) this.#interceptors.splice(i, 1);
    };
  }

  async runInterceptors(request: Request, observed: ObservedRequest): Promise<Response | undefined> {
    for (const interceptor of this.#interceptors) {
      // Each interceptor sees its own body stream, so reading it does not
      // poison the route handler with a `Body already used` that
      // `readJsonObject` would launder into a 400 "invalid JSON body".
      const response = await interceptor(request.clone(), observed);
      if (response !== undefined) return response;
    }
    return undefined;
  }
}

export interface SimulatedFailure {
  /** The status to respond with. @default 500 */
  status?: number;
  /** The response body. @default `{"error": "simulated failure"}` */
  body?: string;
  /** Extra response headers, e.g. `retry-after`. */
  headers?: HeadersInit;
  /**
   * How many times each distinct URL fails before succeeding. This is
   * per-URL, not global, because that is what a retrying client
   * observes from a flaky upstream: every resource is slow to come up,
   * not just the first one requested.
   */
  timesPerUrl: number;
  /** Restrict the failure to URLs this predicate accepts. */
  match?: (observed: ObservedRequest) => boolean;
}

/**
 * Builds an interceptor that fails the first `timesPerUrl` requests to
 * each distinct URL, then lets them through. This is the retry-testing
 * primitive: `bun install` must survive a registry that 5xxs a few
 * times before recovering.
 */
export function simulateFailures(options: SimulatedFailure): Interceptor {
  const { status = 500, body = JSON.stringify({ error: "simulated failure" }), timesPerUrl, match } = options;
  // `options.headers` is any `HeadersInit` — a `Headers` instance has
  // no own properties and an entries array spreads into nonsense, so
  // never object-spread one. Same rule as `json()` in `errors.ts`.
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const remaining = new Map<string, number>();
  return (_request, observed) => {
    if (match !== undefined && !match(observed)) return undefined;
    const left = remaining.get(observed.url) ?? timesPerUrl;
    if (left <= 0) return undefined;
    remaining.set(observed.url, left - 1);
    return new Response(body, { status, headers });
  };
}
