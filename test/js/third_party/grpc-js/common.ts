import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";
import { which } from "bun";
import { readFileSync } from "fs";
import path from "node:path";
import { AddressInfo } from "ws";

const nodeExecutable = which("node");
async function nodeEchoServer(env: any) {
  env = env || {};
  if (!nodeExecutable) throw new Error("node executable not found");
  const subprocess = Bun.spawn([nodeExecutable, path.join(import.meta.dir, "node-server.fixture.js")], {
    stdout: "pipe",
    stdin: "pipe",
    env: env,
  });
  const reader = subprocess.stdout.getReader();
  const data = await reader.read();
  const decoder = new TextDecoder("utf-8");
  const json = decoder.decode(data.value);
  const address = JSON.parse(json);
  const url = `${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
  return { address, url, subprocess };
}

export class TestServer {
  #server: any;
  #options: grpc.ChannelOptions;
  address: AddressInfo | null = null;
  url: string = "";
  service_type: number = 0;
  useTls = false;
  constructor(useTls: boolean, options?: grpc.ChannelOptions, service_type = 0) {
    this.#options = options || {};
    this.useTls = useTls;
    this.service_type = service_type;
  }
  async start() {
    const result = await nodeEchoServer({
      GRPC_TEST_USE_TLS: this.useTls ? "true" : "false",
      GRPC_TEST_OPTIONS: JSON.stringify(this.#options),
      GRPC_SERVICE_TYPE: this.service_type.toString(),
      "grpc-node.max_session_memory": 1024,
    });
    this.address = result.address as AddressInfo;
    this.url = result.url as string;
    this.#server = result.subprocess;
  }

  shutdown() {
    this.#server.stdin.write("shutdown");
    this.#server.kill();
  }
}

const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

function loadProtoFile(file: string) {
  const packageDefinition = loader.loadSync(file, protoLoaderOptions);
  return grpc.loadPackageDefinition(packageDefinition);
}

const protoFile = path.join(import.meta.dir, "fixtures", "echo_service.proto");
const EchoService = loadProtoFile(protoFile).EchoService as grpc.ServiceClientConstructor;

export const ca = readFileSync(path.join(import.meta.dir, "fixtures", "ca.pem"));

export class TestClient {
  #client: grpc.Client;
  constructor(url: string, useTls: boolean | grpc.ChannelCredentials, options?: grpc.ChannelOptions) {
    let credentials: grpc.ChannelCredentials;
    if (useTls instanceof grpc.ChannelCredentials) {
      credentials = useTls;
    } else if (useTls) {
      credentials = grpc.credentials.createSsl(ca);
    } else {
      credentials = grpc.credentials.createInsecure();
    }
    this.#client = new EchoService(url, credentials, options);
  }

  static createFromServerWithCredentials(
    server: TestServer,
    credentials: grpc.ChannelCredentials,
    options?: grpc.ChannelOptions,
  ) {
    if (!server.address) {
      throw new Error("Cannot create client, server not started");
    }
    return new TestClient(server.url, credentials, options);
  }

  static createFromServer(server: TestServer, options?: grpc.ChannelOptions) {
    if (!server.address) {
      throw new Error("Cannot create client, server not started");
    }
    return new TestClient(server.url, server.useTls, options);
  }

  waitForReady(deadline: grpc.Deadline, callback: (error?: Error) => void) {
    this.#client.waitForReady(deadline, callback);
  }
  get client() {
    return this.#client;
  }
  echo(...params: any[]) {
    return this.#client.echo(...params);
  }
  sendRequest(callback: (error?: grpc.ServiceError) => void) {
    this.#client.echo(
      {
        value: "hello",
        value2: 1,
      },
      callback,
    );
  }

  getChannel() {
    return this.#client.getChannel();
  }

  getChannelState() {
    return this.#client.getChannel().getConnectivityState(false);
  }

  close() {
    this.#client.close();
  }
}

export enum ConnectivityState {
  IDLE,
  CONNECTING,
  READY,
  TRANSIENT_FAILURE,
  SHUTDOWN,
}

/**
 * A mock subchannel that transitions between states on command, to test LB
 * policy behavior
 */
export class MockSubchannel implements grpc.experimental.SubchannelInterface {
  private state: grpc.connectivityState;
  private listeners: Set<grpc.experimental.ConnectivityStateListener> = new Set();
  constructor(
    private readonly address: string,
    initialState: grpc.connectivityState = grpc.connectivityState.IDLE,
  ) {
    this.state = initialState;
  }
  getConnectivityState(): grpc.connectivityState {
    return this.state;
  }
  addConnectivityStateListener(listener: grpc.experimental.ConnectivityStateListener): void {
    this.listeners.add(listener);
  }
  removeConnectivityStateListener(listener: grpc.experimental.ConnectivityStateListener): void {
    this.listeners.delete(listener);
  }
  transitionToState(nextState: grpc.connectivityState) {
    grpc.experimental.trace(
      grpc.logVerbosity.DEBUG,
      "subchannel",
      this.address + " " + ConnectivityState[this.state] + " -> " + ConnectivityState[nextState],
    );
    for (const listener of this.listeners) {
      listener(this, this.state, nextState, 0);
    }
    this.state = nextState;
  }
  startConnecting(): void {}
  getAddress(): string {
    return this.address;
  }
  throttleKeepalive(newKeepaliveTime: number): void {}
  ref(): void {}
  unref(): void {}
  getChannelzRef(): SubchannelRef {
    return {
      kind: "subchannel",
      id: -1,
      name: this.address,
    };
  }
  getRealSubchannel(): Subchannel {
    throw new Error("Method not implemented.");
  }
  realSubchannelEquals(other: grpc.experimental.SubchannelInterface): boolean {
    return this === other;
  }
}
