import type { TLSOptions } from "bun";
import { privateAcl } from "./acl.ts";
import { errorResponse, Query, type RequestContext } from "./context.ts";
import { corsResponseHeaders } from "./cors.ts";
import { httpDate, percentDecodeToString, randomHex } from "./encoding.ts";
import { S3Error } from "./errors.ts";
import { route } from "./router.ts";
import { authenticate, type Credential, type Owner } from "./signature.ts";
import { Bucket, isValidBucketName, type VersioningStatus } from "./store.ts";

export interface CredentialOptions {
  accessKeyId: string;
  secretAccessKey: string;
  /** When set, the server accepts the access key only together with this session token. */
  sessionToken?: string;
  /** The account of the access key. The default is the account of the server. */
  owner?: Partial<Owner>;
}

export interface BucketOptions {
  name: string;
  /**
   * The region of the bucket. The default is the region of the server. The
   * server answers `PermanentRedirect` to a request for a bucket in another
   * region, as an endpoint of S3 does.
   */
  region?: string;
  versioning?: VersioningStatus;
  /** The account that owns the bucket. The default is the account of the first credential. */
  owner?: Owner;
  objectLock?: boolean;
}

export interface S3ServerOptions {
  /** The default is 0: the operating system selects a free port. */
  port?: number;
  /** The default is `127.0.0.1`. */
  hostname?: string;
  /** With TLS options the server speaks HTTPS. */
  tls?: TLSOptions;
  /**
   * The access keys that the server knows. The default is the example key pair
   * of the AWS documentation, see `DEFAULT_CREDENTIALS`.
   */
  credentials?: CredentialOptions | CredentialOptions[];
  /**
   * The region of the server. When set, the server refuses a signature that
   * has another region in its scope, as S3 does. When not set, the server
   * accepts each region and reports `us-east-1`.
   */
  region?: string;
  /**
   * The host names of the server for virtual-hosted-style requests. With the
   * default, `localhost`, the request `GET /key` with the header
   * `Host: my-bucket.localhost:3000` reads from the bucket `my-bucket`. The
   * server always knows the host names of Amazon S3, `*.s3.amazonaws.com` and
   * `*.s3.<region>.amazonaws.com`.
   */
  domains?: string[];
  /** Buckets that exist when the server starts. */
  buckets?: (string | BucketOptions)[];
  /** The source of the current time. A test uses it to control what the server sees as now. */
  clock?: () => Date;
  /** How many entries `requests` keeps. The default is 1000. */
  maxRequestLog?: number;
  /** The server calls this function after it made the response to a request. */
  onRequest?: (record: RequestRecord) => void;
}

/** The example access key of the AWS documentation. It is not a real key. */
export const DEFAULT_CREDENTIALS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
} as const;

export const DEFAULT_OWNER: Owner = {
  id: "75aa57f09aa0c8caeab4f8c24e99d10f8e7faeebf76c078efc7c6caea54ba06a",
  displayName: "bun",
  accountId: "123456789012",
};

/** One request that the server answered. */
export interface RequestRecord {
  requestId: string;
  /** The name of the S3 operation, for example `PutObject`. It is empty when the server found no operation. */
  operation: string;
  method: string;
  url: string;
  bucket: string | undefined;
  key: string | undefined;
  headers: Headers;
  status: number;
  /** The code of the S3 error, for a request that failed. */
  errorCode: string | undefined;
}

type Server = Bun.Server<undefined>;

// After `s3` come the parts for FIPS, acceleration, dual-stack and the region, in the forms `-part` and `.part`.
const AMAZON_HOST = /^(?:(.+)\.)?s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?$/;
/** The largest request body. An aws-chunked body is larger than the 5 GiB object that it carries. */
const MAX_REQUEST_BODY_SIZE = 6 * 1024 * 1024 * 1024;

/**
 * True for the requests that an endpoint answers for a bucket of another
 * region: CreateBucket, GetBucketLocation and the preflight request.
 */
function isForEachRegion(method: string, key: string | undefined, query: Query): boolean {
  if (method === "OPTIONS") return true;
  if (key !== undefined) return false;
  return method === "PUT" ? query.parameters.length === 0 : query.has("location");
}

function hostWithoutPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * An Amazon S3 compatible server. It keeps all data in memory.
 *
 * `fetch` is the complete server as a function from a request to a response.
 * `listen` puts it on a port with `Bun.serve`.
 */
export class S3Server {
  readonly buckets = new Map<string, Bucket>();
  readonly region: string;
  /** The requests that the server answered, the oldest first. */
  readonly requests: RequestRecord[] = [];

  readonly #credentials = new Map<string, Credential>();
  readonly #enforceRegion: boolean;
  readonly #domains: string[];
  readonly #clock: () => Date;
  readonly #maxRequestLog: number;
  readonly #options: S3ServerOptions;
  #server: Server | undefined;

  constructor(options: S3ServerOptions = {}) {
    this.#options = options;
    this.region = options.region ?? "us-east-1";
    this.#enforceRegion = options.region !== undefined;
    this.#domains = (options.domains ?? ["localhost"]).map(domain => domain.toLowerCase());
    this.#clock = options.clock ?? (() => new Date());
    this.#maxRequestLog = options.maxRequestLog ?? 1000;

    const credentials = options.credentials ?? DEFAULT_CREDENTIALS;
    for (const credential of Array.isArray(credentials) ? credentials : [credentials]) {
      this.addCredential(credential);
    }
    for (const bucket of options.buckets ?? []) {
      this.createBucket(typeof bucket === "string" ? { name: bucket } : bucket);
    }
  }

  /** The first credential. Its account owns the buckets that the options of the server make. */
  get credentials(): Credential {
    const first = this.#credentials.values().next().value;
    if (!first) throw new Error("The server has no credentials");
    return first;
  }

  addCredential(options: CredentialOptions): Credential {
    const credential: Credential = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
      owner: { ...DEFAULT_OWNER, ...options.owner },
    };
    this.#credentials.set(credential.accessKeyId, credential);
    return credential;
  }

  /** The account with that canonical user ID. */
  findOwner(id: string): Owner | undefined {
    for (const credential of this.#credentials.values()) {
      if (credential.owner.id === id) return credential.owner;
    }
    return undefined;
  }

  /** The credential with that access key. PostObject needs it: the form carries the signature. */
  findCredential(accessKeyId: string): Credential | undefined {
    return this.#credentials.get(accessKeyId);
  }

  /** The region that each credential scope must have. `undefined` when the server accepts each region. */
  get enforcedRegion(): string | undefined {
    return this.#enforceRegion ? this.region : undefined;
  }

  /** Makes a bucket without a request. */
  createBucket(options: string | BucketOptions): Bucket {
    const {
      name,
      region = this.region,
      versioning,
      owner = this.credentials.owner,
      objectLock,
    } = typeof options === "string" ? ({ name: options } as BucketOptions) : options;
    if (!isValidBucketName(name)) throw new Error(`"${name}" is not a valid bucket name`);
    if (this.buckets.has(name)) throw new Error(`The bucket "${name}" exists`);
    const bucket = new Bucket(name, owner, region, this.#clock(), privateAcl(owner));
    bucket.versioning = objectLock ? "Enabled" : versioning;
    bucket.objectLockEnabled = objectLock ?? false;
    this.buckets.set(name, bucket);
    return bucket;
  }

  /** Starts to listen. */
  listen(): this {
    if (this.#server) throw new Error("The server listens already");
    this.#server = Bun.serve({
      port: this.#options.port ?? 0,
      hostname: this.#options.hostname ?? "127.0.0.1",
      tls: this.#options.tls,
      maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
      idleTimeout: 0,
      development: false,
      fetch: (request, server) => this.fetch(request, server),
    });
    return this;
  }

  get listening(): boolean {
    return this.#server !== undefined;
  }

  #listener(): Server {
    if (!this.#server) throw new Error("The server does not listen. Call listen() first.");
    return this.#server;
  }

  get port(): number {
    return this.#listener().port!;
  }

  get hostname(): string {
    return this.#listener().hostname!;
  }

  /** The endpoint for path-style requests, without a slash at the end. */
  get url(): string {
    const hostname = this.hostname.includes(":") ? `[${this.hostname}]` : this.hostname;
    return `${this.#options.tls ? "https" : "http"}://${hostname}:${this.port}`;
  }

  /** The endpoint for virtual-hosted-style requests to the bucket, on the first of the `domains`. */
  virtualHostedUrl(bucket: string): string {
    return `${this.#options.tls ? "https" : "http"}://${bucket}.${this.#domains[0]}:${this.port}`;
  }

  /** The options for `new Bun.S3Client()` that connect it to this server. */
  clientOptions(bucket?: string): {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region?: string;
    bucket?: string;
  } {
    const { accessKeyId, secretAccessKey, sessionToken } = this.credentials;
    return {
      endpoint: this.url,
      accessKeyId,
      secretAccessKey,
      ...(sessionToken === undefined ? {} : { sessionToken }),
      ...(this.#enforceRegion ? { region: this.region } : {}),
      ...(bucket === undefined ? {} : { bucket }),
    };
  }

  /** Stops to listen and closes the connections. The buckets stay in the object. */
  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    await server?.stop(true);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  /** Answers one request. */
  async fetch(request: Request, server?: Server): Promise<Response> {
    const requestId = randomHex(8).toUpperCase();
    const hostId = Buffer.from(crypto.getRandomValues(new Uint8Array(42))).toString("base64");
    const now = this.#clock();
    const partial = { method: request.method, requestId, hostId };

    let context: RequestContext | undefined;
    let response: Response;
    let errorCode: string | undefined;
    try {
      context = this.#context(request, server, requestId, hostId, now);
      const { operation, handler } = route(context);
      context.operation = operation;
      response = await handler(context);
    } catch (error) {
      let s3Error: S3Error;
      if (error instanceof S3Error) {
        s3Error = error;
      } else {
        console.error("s3-server: internal error", error);
        s3Error = new S3Error("InternalError");
      }
      errorCode = s3Error.code;
      response = errorResponse(partial, s3Error);
    }

    const headers = response.headers;
    headers.set("x-amz-request-id", requestId);
    headers.set("x-amz-id-2", hostId);
    headers.set("server", "AmazonS3");
    headers.set("date", httpDate(now));

    const origin = request.headers.get("origin");
    if (origin !== null && request.method !== "OPTIONS" && context?.bucket?.cors) {
      // S3 matches the rules with the method of Access-Control-Request-Method when the request has this header.
      const method = request.headers.get("access-control-request-method") ?? request.method;
      const cors = corsResponseHeaders(context.bucket.cors, origin, method);
      for (const name in cors) headers.set(name, cors[name]);
    }

    const record: RequestRecord = {
      requestId,
      operation: context?.operation ?? "",
      method: request.method,
      url: request.url,
      bucket: context?.bucketName,
      key: context?.key,
      headers: request.headers,
      status: response.status,
      errorCode,
    };
    this.requests.push(record);
    if (this.requests.length > this.#maxRequestLog) this.requests.shift();
    this.#options.onRequest?.(record);

    return response;
  }

  #context(request: Request, server: Server | undefined, requestId: string, hostId: string, now: Date): RequestContext {
    const url = request.url;
    const authority = url.indexOf("://");
    const pathStart = url.indexOf("/", authority === -1 ? 0 : authority + 3);
    const target = pathStart === -1 ? "/" : url.slice(pathStart);
    const question = target.indexOf("?");
    const path = question === -1 ? target : target.slice(0, question);
    const query = new Query(question === -1 ? "" : target.slice(question + 1));
    const secure = url.startsWith("https:");

    const host = hostWithoutPort(request.headers.get("host") ?? "").toLowerCase();
    const hostBucket = this.#bucketFromHost(host);

    let bucketName: string | undefined;
    let rawKey: string | undefined;
    if (hostBucket !== undefined) {
      bucketName = hostBucket;
      rawKey = path.slice(1);
    } else {
      const slash = path.indexOf("/", 1);
      const rawBucket = slash === -1 ? path.slice(1) : path.slice(1, slash);
      if (rawBucket !== "") {
        bucketName = percentDecodeToString(rawBucket);
        if (bucketName === undefined) throw new S3Error("InvalidURI", { details: { URI: path } });
        rawKey = slash === -1 ? "" : path.slice(slash + 1);
      }
    }
    let key: string | undefined;
    if (rawKey !== undefined && rawKey !== "") {
      key = percentDecodeToString(rawKey);
      if (key === undefined) throw new S3Error("InvalidURI", { details: { URI: path } });
    }

    const bucket = bucketName === undefined ? undefined : this.buckets.get(bucketName);
    // S3 serves a bucket only at the endpoint of its region. It looks at the region before the signature.
    if (bucket && bucket.region !== this.region && !isForEachRegion(request.method, key, query)) {
      throw new S3Error("PermanentRedirect", {
        details: { Endpoint: `${bucket.name}.s3.${bucket.region}.amazonaws.com`, Bucket: bucket.name },
        headers: { "x-amz-bucket-region": bucket.region },
      });
    }

    // A preflight request of a browser carries no credentials.
    const authentication =
      request.method === "OPTIONS"
        ? ({ type: "anonymous" } as const)
        : authenticate({
            method: request.method,
            path,
            query: query.parameters,
            headers: request.headers,
            now,
            region: this.#enforceRegion ? this.region : undefined,
            findCredential: accessKeyId => this.#credentials.get(accessKeyId),
          });

    return {
      server: this,
      request,
      method: request.method,
      headers: request.headers,
      path,
      query,
      secure,
      virtualHosted: hostBucket !== undefined,
      bucketName,
      key,
      requestId,
      hostId,
      now,
      clientAddress: server?.requestIP(request)?.address,
      authentication,
      sender: authentication.type === "anonymous" ? undefined : authentication.credential.owner,
      operation: "",
      bucket,
    };
  }

  #bucketFromHost(host: string): string | undefined {
    for (const domain of this.#domains) {
      if (host.length > domain.length + 1 && host.endsWith("." + domain)) {
        return host.slice(0, -(domain.length + 1));
      }
    }
    return AMAZON_HOST.exec(host)?.[1];
  }
}

/** Makes a server and starts to listen. */
export function serve(options: S3ServerOptions = {}): S3Server {
  return new S3Server(options).listen();
}
