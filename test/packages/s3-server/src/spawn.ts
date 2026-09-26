// Runs the server in a process of its own. A test that moves much data uses
// it, so that the work of the server does not run on the thread of the test.

import { join } from "node:path";
import type { CredentialOptions } from "./server.ts";

export interface SpawnOptions {
  /** The program that runs the server. The default is the Bun that runs the caller. */
  bunExe?: string;
  env?: Record<string, string | undefined>;
  credentials?: Pick<CredentialOptions, "accessKeyId" | "secretAccessKey" | "sessionToken">;
  region?: string;
  domains?: string[];
  buckets?: string[];
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
  for (const bucket of options.buckets ?? []) args.push("--bucket", bucket);

  const child = Bun.spawn({
    cmd: [options.bunExe ?? process.execPath, join(import.meta.dir, "..", "cli.ts"), ...args],
    env: options.env ?? process.env,
    // The server stops when this pipe closes, also when this process ends without a call to stop().
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  // The first line of the output is a JSON object with the address of the server.
  let output = "";
  const decoder = new TextDecoder();
  for await (const chunk of child.stdout) {
    output += decoder.decode(chunk, { stream: true });
    if (output.includes("\n")) break;
  }
  const newline = output.indexOf("\n");
  if (newline === -1) {
    throw new Error(`The s3-server process ended with code ${await child.exited} before it listened`);
  }
  const { url, port, ...client } = JSON.parse(output.slice(0, newline)) as {
    url: string;
    port: number;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region?: string;
  };

  const stop = async () => {
    child.stdin.end();
    child.kill();
    await child.exited;
  };
  return {
    url,
    port,
    clientOptions: bucket => ({ ...client, ...(bucket === undefined ? {} : { bucket }) }),
    stop,
    [Symbol.asyncDispose]: stop,
  };
}
