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

import assert from "node:assert";
import * as protoLoader from "@grpc/proto-loader";
import grpc from "@grpc/grpc-js";

import { ProtoGrpcType } from "@grpc/grpc-js/build/src/generated/channelz";
import { ChannelzClient } from "@grpc/grpc-js/build/src/generated/grpc/channelz/v1/Channelz";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";
import { loadProtoFile } from "./common";
import { afterAll, beforeAll, describe, it, beforeEach, afterEach } from "bun:test";

const loadedChannelzProto = protoLoader.loadSync("channelz.proto", {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [`${__dirname}/fixtures`],
});
const channelzGrpcObject = grpc.loadPackageDefinition(loadedChannelzProto) as unknown as ProtoGrpcType;

const TestServiceClient = loadProtoFile(`${__dirname}/fixtures/test_service.proto`)
  .TestService as ServiceClientConstructor;

const testServiceImpl: grpc.UntypedServiceImplementation = {
  unary(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
    if (call.request.error) {
      setTimeout(() => {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: call.request.message,
        });
      }, call.request.errorAfter);
    } else {
      callback(null, { count: 1 });
    }
  },
};

describe("Channelz", () => {
  let channelzServer: grpc.Server;
  let channelzClient: ChannelzClient;
  let testServer: grpc.Server;
  let testClient: ServiceClient;

  beforeAll(done => {
    channelzServer = new grpc.Server();
    channelzServer.addService(grpc.getChannelzServiceDefinition(), grpc.getChannelzHandlers());
    channelzServer.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        done(error);
        return;
      }
      channelzServer.start();
      channelzClient = new channelzGrpcObject.grpc.channelz.v1.Channelz(
        `localhost:${port}`,
        grpc.credentials.createInsecure(),
      );
      done();
    });
  });

  afterAll(() => {
    channelzClient.close();
    channelzServer.forceShutdown();
  });

  beforeEach(done => {
    testServer = new grpc.Server();
    testServer.addService(TestServiceClient.service, testServiceImpl);
    testServer.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        done(error);
        return;
      }
      testServer.start();
      testClient = new TestServiceClient(`localhost:${port}`, grpc.credentials.createInsecure());
      done();
    });
  });

  afterEach(() => {
    testClient.close();
    testServer.forceShutdown();
  });

  it("should see a newly created channel", done => {
    // Test that the specific test client channel info can be retrieved
    channelzClient.GetChannel({ channel_id: testClient.getChannel().getChannelzRef().id }, (error, result) => {
      assert.ifError(error);
      assert(result);
      assert(result.channel);
      assert(result.channel.ref);
      assert.strictEqual(+result.channel.ref.channel_id, testClient.getChannel().getChannelzRef().id);
      // Test that the channel is in the list of top channels
      channelzClient.getTopChannels(
        {
          start_channel_id: testClient.getChannel().getChannelzRef().id,
          max_results: 1,
        },
        (error, result) => {
          assert.ifError(error);
          assert(result);
          assert.strictEqual(result.channel.length, 1);
          assert(result.channel[0].ref);
          assert.strictEqual(+result.channel[0].ref.channel_id, testClient.getChannel().getChannelzRef().id);
          done();
        },
      );
    });
  });

  it("should see a newly created server", done => {
    // Test that the specific test server info can be retrieved
    channelzClient.getServer({ server_id: testServer.getChannelzRef().id }, (error, result) => {
      assert.ifError(error);
      assert(result);
      assert(result.server);
      assert(result.server.ref);
      assert.strictEqual(+result.server.ref.server_id, testServer.getChannelzRef().id);
      // Test that the server is in the list of servers
      channelzClient.getServers(
        { start_server_id: testServer.getChannelzRef().id, max_results: 1 },
        (error, result) => {
          assert.ifError(error);
          assert(result);
          assert.strictEqual(result.server.length, 1);
          assert(result.server[0].ref);
          assert.strictEqual(+result.server[0].ref.server_id, testServer.getChannelzRef().id);
          done();
        },
      );
    });
  });

  it("should count successful calls", done => {
    testClient.unary({}, (error: grpc.ServiceError, value: unknown) => {
      assert.ifError(error);
      // Channel data tests
      channelzClient.GetChannel({ channel_id: testClient.getChannel().getChannelzRef().id }, (error, channelResult) => {
        assert.ifError(error);
        assert(channelResult);
        assert(channelResult.channel);
        assert(channelResult.channel.ref);
        assert(channelResult.channel.data);
        assert.strictEqual(+channelResult.channel.data.calls_started, 1);
        assert.strictEqual(+channelResult.channel.data.calls_succeeded, 1);
        assert.strictEqual(+channelResult.channel.data.calls_failed, 0);
        assert.strictEqual(channelResult.channel.subchannel_ref.length, 1);
        channelzClient.getSubchannel(
          {
            subchannel_id: channelResult.channel.subchannel_ref[0].subchannel_id,
          },
          (error, subchannelResult) => {
            assert.ifError(error);
            assert(subchannelResult);
            assert(subchannelResult.subchannel);
            assert(subchannelResult.subchannel.ref);
            assert(subchannelResult.subchannel.data);
            assert.strictEqual(
              subchannelResult.subchannel.ref.subchannel_id,
              channelResult.channel!.subchannel_ref[0].subchannel_id,
            );
            assert.strictEqual(+subchannelResult.subchannel.data.calls_started, 1);
            assert.strictEqual(+subchannelResult.subchannel.data.calls_succeeded, 1);
            assert.strictEqual(+subchannelResult.subchannel.data.calls_failed, 0);
            assert.strictEqual(subchannelResult.subchannel.socket_ref.length, 1);
            channelzClient.getSocket(
              {
                socket_id: subchannelResult.subchannel.socket_ref[0].socket_id,
              },
              (error, socketResult) => {
                assert.ifError(error);
                assert(socketResult);
                assert(socketResult.socket);
                assert(socketResult.socket.ref);
                assert(socketResult.socket.data);
                assert.strictEqual(
                  socketResult.socket.ref.socket_id,
                  subchannelResult.subchannel!.socket_ref[0].socket_id,
                );
                assert.strictEqual(+socketResult.socket.data.streams_started, 1);
                assert.strictEqual(+socketResult.socket.data.streams_succeeded, 1);
                assert.strictEqual(+socketResult.socket.data.streams_failed, 0);
                assert.strictEqual(+socketResult.socket.data.messages_received, 1);
                assert.strictEqual(+socketResult.socket.data.messages_sent, 1);
                // Server data tests
                channelzClient.getServer({ server_id: testServer.getChannelzRef().id }, (error, serverResult) => {
                  assert.ifError(error);
                  assert(serverResult);
                  assert(serverResult.server);
                  assert(serverResult.server.ref);
                  assert(serverResult.server.data);
                  assert.strictEqual(+serverResult.server.ref.server_id, testServer.getChannelzRef().id);
                  assert.strictEqual(+serverResult.server.data.calls_started, 1);
                  assert.strictEqual(+serverResult.server.data.calls_succeeded, 1);
                  assert.strictEqual(+serverResult.server.data.calls_failed, 0);
                  channelzClient.getServerSockets(
                    { server_id: testServer.getChannelzRef().id },
                    (error, socketsResult) => {
                      assert.ifError(error);
                      assert(socketsResult);
                      assert.strictEqual(socketsResult.socket_ref.length, 1);
                      channelzClient.getSocket(
                        {
                          socket_id: socketsResult.socket_ref[0].socket_id,
                        },
                        (error, serverSocketResult) => {
                          assert.ifError(error);
                          assert(serverSocketResult);
                          assert(serverSocketResult.socket);
                          assert(serverSocketResult.socket.ref);
                          assert(serverSocketResult.socket.data);
                          assert.strictEqual(
                            serverSocketResult.socket.ref.socket_id,
                            socketsResult.socket_ref[0].socket_id,
                          );
                          assert.strictEqual(+serverSocketResult.socket.data.streams_started, 1);
                          assert.strictEqual(+serverSocketResult.socket.data.streams_succeeded, 1);
                          assert.strictEqual(+serverSocketResult.socket.data.streams_failed, 0);
                          assert.strictEqual(+serverSocketResult.socket.data.messages_received, 1);
                          assert.strictEqual(+serverSocketResult.socket.data.messages_sent, 1);
                          done();
                        },
                      );
                    },
                  );
                });
              },
            );
          },
        );
      });
    });
  });

  it("should count failed calls", done => {
    testClient.unary({ error: true }, (error: grpc.ServiceError, value: unknown) => {
      assert(error);
      // Channel data tests
      channelzClient.GetChannel({ channel_id: testClient.getChannel().getChannelzRef().id }, (error, channelResult) => {
        assert.ifError(error);
        assert(channelResult);
        assert(channelResult.channel);
        assert(channelResult.channel.ref);
        assert(channelResult.channel.data);
        assert.strictEqual(+channelResult.channel.data.calls_started, 1);
        assert.strictEqual(+channelResult.channel.data.calls_succeeded, 0);
        assert.strictEqual(+channelResult.channel.data.calls_failed, 1);
        assert.strictEqual(channelResult.channel.subchannel_ref.length, 1);
        channelzClient.getSubchannel(
          {
            subchannel_id: channelResult.channel.subchannel_ref[0].subchannel_id,
          },
          (error, subchannelResult) => {
            assert.ifError(error);
            assert(subchannelResult);
            assert(subchannelResult.subchannel);
            assert(subchannelResult.subchannel.ref);
            assert(subchannelResult.subchannel.data);
            assert.strictEqual(
              subchannelResult.subchannel.ref.subchannel_id,
              channelResult.channel!.subchannel_ref[0].subchannel_id,
            );
            assert.strictEqual(+subchannelResult.subchannel.data.calls_started, 1);
            assert.strictEqual(+subchannelResult.subchannel.data.calls_succeeded, 0);
            assert.strictEqual(+subchannelResult.subchannel.data.calls_failed, 1);
            assert.strictEqual(subchannelResult.subchannel.socket_ref.length, 1);
            channelzClient.getSocket(
              {
                socket_id: subchannelResult.subchannel.socket_ref[0].socket_id,
              },
              (error, socketResult) => {
                assert.ifError(error);
                assert(socketResult);
                assert(socketResult.socket);
                assert(socketResult.socket.ref);
                assert(socketResult.socket.data);
                assert.strictEqual(
                  socketResult.socket.ref.socket_id,
                  subchannelResult.subchannel!.socket_ref[0].socket_id,
                );
                assert.strictEqual(+socketResult.socket.data.streams_started, 1);
                assert.strictEqual(+socketResult.socket.data.streams_succeeded, 1);
                assert.strictEqual(+socketResult.socket.data.streams_failed, 0);
                assert.strictEqual(+socketResult.socket.data.messages_received, 0);
                assert.strictEqual(+socketResult.socket.data.messages_sent, 1);
                // Server data tests
                channelzClient.getServer({ server_id: testServer.getChannelzRef().id }, (error, serverResult) => {
                  assert.ifError(error);
                  assert(serverResult);
                  assert(serverResult.server);
                  assert(serverResult.server.ref);
                  assert(serverResult.server.data);
                  assert.strictEqual(+serverResult.server.ref.server_id, testServer.getChannelzRef().id);
                  assert.strictEqual(+serverResult.server.data.calls_started, 1);
                  assert.strictEqual(+serverResult.server.data.calls_succeeded, 0);
                  assert.strictEqual(+serverResult.server.data.calls_failed, 1);
                  channelzClient.getServerSockets(
                    { server_id: testServer.getChannelzRef().id },
                    (error, socketsResult) => {
                      assert.ifError(error);
                      assert(socketsResult);
                      assert.strictEqual(socketsResult.socket_ref.length, 1);
                      channelzClient.getSocket(
                        {
                          socket_id: socketsResult.socket_ref[0].socket_id,
                        },
                        (error, serverSocketResult) => {
                          assert.ifError(error);
                          assert(serverSocketResult);
                          assert(serverSocketResult.socket);
                          assert(serverSocketResult.socket.ref);
                          assert(serverSocketResult.socket.data);
                          assert.strictEqual(
                            serverSocketResult.socket.ref.socket_id,
                            socketsResult.socket_ref[0].socket_id,
                          );
                          assert.strictEqual(+serverSocketResult.socket.data.streams_started, 1);
                          assert.strictEqual(+serverSocketResult.socket.data.streams_succeeded, 1);
                          assert.strictEqual(+serverSocketResult.socket.data.streams_failed, 0);
                          assert.strictEqual(+serverSocketResult.socket.data.messages_received, 1);
                          assert.strictEqual(+serverSocketResult.socket.data.messages_sent, 0);
                          done();
                        },
                      );
                    },
                  );
                });
              },
            );
          },
        );
      });
    });
  });
});

describe("Disabling channelz", () => {
  let testServer: grpc.Server;
  let testClient: ServiceClient;
  beforeEach(done => {
    testServer = new grpc.Server({ "grpc.enable_channelz": 0 });
    testServer.addService(TestServiceClient.service, testServiceImpl);
    testServer.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        done(error);
        return;
      }
      testServer.start();
      testClient = new TestServiceClient(`localhost:${port}`, grpc.credentials.createInsecure(), {
        "grpc.enable_channelz": 0,
      });
      done();
    });
  });

  afterEach(() => {
    testClient.close();
    testServer.forceShutdown();
  });

  it("Should still work", done => {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 1);
    testClient.unary({}, { deadline }, (error: grpc.ServiceError, value: unknown) => {
      assert.ifError(error);
      done();
    });
  });
});
