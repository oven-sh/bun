/*
 * Copyright 2019 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import * as loader from "@grpc/proto-loader";
import * as assert2 from "./assert2";
import * as path from "path";
import grpc from "@grpc/grpc-js";
import * as fsPromises from "fs/promises";
import * as os from "os";

import { GrpcObject, ServiceClientConstructor, ServiceClient, loadPackageDefinition } from "@grpc/grpc-js";
import { readFileSync } from "fs";
import { HealthListener, SubchannelInterface } from "@grpc/grpc-js/build/src/subchannel-interface";
import type { EntityTypes, SubchannelRef } from "@grpc/grpc-js/build/src/channelz";
import { Subchannel } from "@grpc/grpc-js/build/src/subchannel";
import { ConnectivityState } from "@grpc/grpc-js/build/src/connectivity-state";

const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

export function mockFunction(): never {
  throw new Error("Not implemented");
}

export function loadProtoFile(file: string): GrpcObject {
  const packageDefinition = loader.loadSync(file, protoLoaderOptions);
  return loadPackageDefinition(packageDefinition);
}

const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

const ca = readFileSync(path.join(__dirname, "fixtures", "ca.pem"));
const key = readFileSync(path.join(__dirname, "fixtures", "server1.key"));
const cert = readFileSync(path.join(__dirname, "fixtures", "server1.pem"));

const serviceImpl = {
  echo: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    callback(null, call.request);
  },
};

export class TestServer {
  private server: grpc.Server;
  private target: string | null = null;
  constructor(
    public useTls: boolean,
    options?: grpc.ServerOptions,
  ) {
    this.server = new grpc.Server(options);
    this.server.addService(echoService.service, serviceImpl);
  }

  private getCredentials(): grpc.ServerCredentials {
    if (this.useTls) {
      return grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }], false);
    } else {
      return grpc.ServerCredentials.createInsecure();
    }
  }

  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.bindAsync("localhost:0", this.getCredentials(), (error, port) => {
        if (error) {
          reject(error);
          return;
        }
        this.target = `localhost:${port}`;
        resolve();
      });
    });
  }

  startUds(): Promise<void> {
    return fsPromises.mkdtemp(path.join(os.tmpdir(), "uds")).then(dir => {
      return new Promise<void>((resolve, reject) => {
        const target = `unix://${dir}/socket`;
        this.server.bindAsync(target, this.getCredentials(), (error, port) => {
          if (error) {
            reject(error);
            return;
          }
          this.target = target;
          resolve();
        });
      });
    });
  }

  shutdown() {
    this.server.forceShutdown();
  }

  getTarget() {
    if (this.target === null) {
      throw new Error("Server not yet started");
    }
    return this.target;
  }
}

export class TestClient {
  private client: ServiceClient;
  constructor(target: string, useTls: boolean, options?: grpc.ChannelOptions) {
    let credentials: grpc.ChannelCredentials;
    if (useTls) {
      credentials = grpc.credentials.createSsl(ca);
    } else {
      credentials = grpc.credentials.createInsecure();
    }
    this.client = new echoService(target, credentials, options);
  }

  static createFromServer(server: TestServer, options?: grpc.ChannelOptions) {
    return new TestClient(server.getTarget(), server.useTls, options);
  }

  waitForReady(deadline: grpc.Deadline, callback: (error?: Error) => void) {
    this.client.waitForReady(deadline, callback);
  }

  sendRequest(callback: (error?: grpc.ServiceError) => void) {
    this.client.echo({}, callback);
  }

  sendRequestWithMetadata(metadata: grpc.Metadata, callback: (error?: grpc.ServiceError) => void) {
    this.client.echo({}, metadata, callback);
  }

  getChannelState() {
    return this.client.getChannel().getConnectivityState(false);
  }

  waitForClientState(deadline: grpc.Deadline, state: ConnectivityState, callback: (error?: Error) => void) {
    this.client.getChannel().watchConnectivityState(this.getChannelState(), deadline, err => {
      if (err) {
        return callback(err);
      }

      const currentState = this.getChannelState();
      if (currentState === state) {
        callback();
      } else {
        return this.waitForClientState(deadline, currentState, callback);
      }
    });
  }

  close() {
    this.client.close();
  }
}

/**
 * A mock subchannel that transitions between states on command, to test LB
 * policy behavior
 */
export class MockSubchannel implements SubchannelInterface {
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
  isHealthy(): boolean {
    return true;
  }
  addHealthStateWatcher(listener: HealthListener): void {}
  removeHealthStateWatcher(listener: HealthListener): void {}
}

export { assert2 };
