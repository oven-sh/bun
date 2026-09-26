// Runs the server in a process of its own. A test that moves much data uses
// it, so that the work of the server does not run on the thread of the test.

import { join } from "node:path";
import type { CredentialOptions } from "./server.ts";

export interface SpawnOptions {
  /** The program that runs the server. The default is the Bun that runs the caller. */
  bunExe?: string;
  env?: Record<string, string | undefined>;
  /** Where the errors of the server go. The default is the stderr of the caller. */
  stderr?: "inherit" | "ignore";
  credentials?: Pick<CredentialOptions, "accessKeyId" | "secretAccessKey" | "sessionToken">;
  region?: string;
  domains?: string[];
  /** The buckets that exist at the start. A bucket can be in another region than the server. */
  buckets?: (string | { name: string; region?: string })[];
  /** How long the server can take until it listens, in milliseconds. The default is 60 seconds. */
  startTimeout?: number;
}

export interface SpawnedServer extends AsyncDisposable {
  /** The endpoint for path-style requests, without a slash at the end. */
  readonly url: string;
  readonly port: number;
  /** The options for `new Bun.S3Client()` that connect it to the server. */
  clientOptions(bucket?: string): {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region?: string;
    bucket?: string;
  };
  stop(): Promise<void>;
}

/**
 * Reads a value of the `--bucket` option of the program: `<name>` or
 * `<name>@<region>`. The result is `undefined` for a value of another form.
 */
export function parseBucketOption(value: string): { name: string; region?: string } | undefined {
  const [name, region, ...more] = value.split("@");
  if (name === "" || region === "" || more.length > 0) return undefined;
  return region === undefined ? { name } : { name, region };
}

/** Starts the server in a child process and waits until it listens. */
export async function spawnServer(options: SpawnOptions = {}): Promise<SpawnedServer> {
  const args = ["--port", "0", "--exit-on-stdin-close"];
  if (options.credentials) {
    args.push("--access-key", options.credentials.accessKeyId, "--secret-key", options.credentials.secretAccessKey);
    if (options.credentials.sessionToken !== undefined) {
      args.push("--session-token", options.credentials.sessionToken);
    }
  }
  if (options.region !== undefined) args.push("--region", options.region);
  for (const domain of options.domains ?? []) args.push("--domain", domain);
  for (const bucket of options.buckets ?? []) {
    const { name, region } = typeof bucket === "string" ? { name: bucket, region: undefined } : bucket;
    args.push("--bucket", region === undefined ? name : `${name}@${region}`);
  }

  const child = Bun.spawn({
    cmd: [options.bunExe ?? process.execPath, join(import.meta.dir, "..", "cli.ts"), ...args],
    env: options.env ?? process.env,
    // The server stops when this pipe closes, also when this process ends without a call to stop().
    stdin: "pipe",
    stdout: "pipe",
    stderr: options.stderr ?? "inherit",
  });

  const stop = async () => {
    child.stdin.end();
    child.kill();
    await child.exited;
  };

  // A server that does not start must not let the caller wait without an end.
  const startTimeout = options.startTimeout ?? 60_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, startTimeout);

  let address: { url: string; port: number } & ReturnType<SpawnedServer["clientOptions"]>;
  try {
    // The first line of the output is a JSON object with the address of the server.
    let output = "";
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      output += decoder.decode(chunk, { stream: true });
      if (output.includes("\n")) break;
    }
    const newline = output.indexOf("\n");
    if (newline === -1) {
      throw new Error(
        timedOut
          ? `The s3-server process did not listen after ${startTimeout} ms`
          : "The s3-server process ended before it listened",
      );
    }
    address = JSON.parse(output.slice(0, newline));
  } catch (error) {
    // The process must not stay when the start fails.
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const { url, port, ...client } = address;
  return {
    url,
    port,
    clientOptions: bucket => ({ ...client, ...(bucket === undefined ? {} : { bucket }) }),
    stop,
    [Symbol.asyncDispose]: stop,
  };
}
