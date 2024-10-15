/*
 * Copyright 2023 gRPC authors.
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
import assert from "assert";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

import { ConnectivityState } from "@grpc/grpc-js/build/src/connectivity-state";
import { ChannelControlHelper, createChildChannelControlHelper } from "@grpc/grpc-js/build/src/load-balancer";
import {
  PickFirstLoadBalancer,
  PickFirstLoadBalancingConfig,
  shuffled,
} from "@grpc/grpc-js/build/src/load-balancer-pick-first";
import { Metadata } from "@grpc/grpc-js/build/src/metadata";
import { Picker } from "@grpc/grpc-js/build/src/picker";
import { Endpoint, subchannelAddressToString } from "@grpc/grpc-js/build/src/subchannel-address";
import { MockSubchannel, TestClient, TestServer } from "./common";
import { credentials } from "@grpc/grpc-js";

function updateStateCallBackForExpectedStateSequence(expectedStateSequence: ConnectivityState[], done: Mocha.Done) {
  const actualStateSequence: ConnectivityState[] = [];
  let lastPicker: Picker | null = null;
  let finished = false;
  return (connectivityState: ConnectivityState, picker: Picker) => {
    if (finished) {
      return;
    }
    // Ignore duplicate state transitions
    if (connectivityState === actualStateSequence[actualStateSequence.length - 1]) {
      // Ignore READY duplicate state transitions if the picked subchannel is the same
      if (
        connectivityState !== ConnectivityState.READY ||
        lastPicker?.pick({ extraPickInfo: {}, metadata: new Metadata() })?.subchannel ===
          picker.pick({ extraPickInfo: {}, metadata: new Metadata() }).subchannel
      ) {
        return;
      }
    }
    if (expectedStateSequence[actualStateSequence.length] !== connectivityState) {
      finished = true;
      done(
        new Error(
          `Unexpected state ${ConnectivityState[connectivityState]} after [${actualStateSequence.map(
            value => ConnectivityState[value],
          )}]`,
        ),
      );
      return;
    }
    actualStateSequence.push(connectivityState);
    lastPicker = picker;
    if (actualStateSequence.length === expectedStateSequence.length) {
      finished = true;
      done();
    }
  };
}

describe("Shuffler", () => {
  it("Should maintain the multiset of elements from the original array", () => {
    const originalArray = [1, 2, 2, 3, 3, 3, 4, 4, 5];
    for (let i = 0; i < 100; i++) {
      assert.deepStrictEqual(
        shuffled(originalArray).sort((a, b) => a - b),
        originalArray,
      );
    }
  });
});

describe("pick_first load balancing policy", () => {
  const config = new PickFirstLoadBalancingConfig(false);
  let subchannels: MockSubchannel[] = [];
  const creds = credentials.createInsecure();
  const baseChannelControlHelper: ChannelControlHelper = {
    createSubchannel: (subchannelAddress, subchannelArgs) => {
      const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress));
      subchannels.push(subchannel);
      return subchannel;
    },
    addChannelzChild: () => {},
    removeChannelzChild: () => {},
    requestReresolution: () => {},
    updateState: () => {},
  };
  beforeEach(() => {
    subchannels = [];
  });
  it("Should report READY when a subchannel connects", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.CONNECTING, ConnectivityState.READY],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.READY);
    });
  });
  it("Should report READY when a subchannel other than the first connects", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.CONNECTING, ConnectivityState.READY],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
    process.nextTick(() => {
      subchannels[1].transitionToState(ConnectivityState.READY);
    });
  });
  it("Should report READY when a subchannel other than the first in the same endpoint connects", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.CONNECTING, ConnectivityState.READY],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [
        {
          addresses: [
            { host: "localhost", port: 1 },
            { host: "localhost", port: 2 },
          ],
        },
      ],
      config,
    );
    process.nextTick(() => {
      subchannels[1].transitionToState(ConnectivityState.READY);
    });
  });
  it("Should report READY when updated with a subchannel that is already READY", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), ConnectivityState.READY);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence([ConnectivityState.READY], done),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
  });
  it("Should stay CONNECTING if only some subchannels fail to connect", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      updateState: updateStateCallBackForExpectedStateSequence([ConnectivityState.CONNECTING], done),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
    });
  });
  it("Should enter TRANSIENT_FAILURE when subchannels fail to connect", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.CONNECTING, ConnectivityState.TRANSIENT_FAILURE],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
    });
    process.nextTick(() => {
      subchannels[1].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
    });
  });
  it("Should stay in TRANSIENT_FAILURE if subchannels go back to CONNECTING", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.CONNECTING, ConnectivityState.TRANSIENT_FAILURE],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
      process.nextTick(() => {
        subchannels[1].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
        process.nextTick(() => {
          subchannels[0].transitionToState(ConnectivityState.CONNECTING);
          process.nextTick(() => {
            subchannels[1].transitionToState(ConnectivityState.CONNECTING);
          });
        });
      });
    });
  });
  it("Should immediately enter TRANSIENT_FAILURE if subchannels start in TRANSIENT_FAILURE", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(
          subchannelAddressToString(subchannelAddress),
          ConnectivityState.TRANSIENT_FAILURE,
        );
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence([ConnectivityState.TRANSIENT_FAILURE], done),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
  });
  it("Should enter READY if a subchannel connects after entering TRANSIENT_FAILURE mode", done => {
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(
          subchannelAddressToString(subchannelAddress),
          ConnectivityState.TRANSIENT_FAILURE,
        );
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.TRANSIENT_FAILURE, ConnectivityState.READY],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.READY);
    });
  });
  it("Should stay in TRANSIENT_FAILURE after an address update with non-READY subchannels", done => {
    let currentStartState = ConnectivityState.TRANSIENT_FAILURE;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence([ConnectivityState.TRANSIENT_FAILURE], done),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
    process.nextTick(() => {
      currentStartState = ConnectivityState.CONNECTING;
      pickFirst.updateAddressList(
        [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
        config,
      );
    });
  });
  it("Should transition from TRANSIENT_FAILURE to READY after an address update with a READY subchannel", done => {
    let currentStartState = ConnectivityState.TRANSIENT_FAILURE;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.TRANSIENT_FAILURE, ConnectivityState.READY],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList(
      [{ addresses: [{ host: "localhost", port: 1 }] }, { addresses: [{ host: "localhost", port: 2 }] }],
      config,
    );
    process.nextTick(() => {
      currentStartState = ConnectivityState.READY;
      pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 3 }] }], config);
    });
  });
  it("Should transition from READY to IDLE if the connected subchannel disconnects", done => {
    const currentStartState = ConnectivityState.READY;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence([ConnectivityState.READY, ConnectivityState.IDLE], done),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.IDLE);
    });
  });
  it("Should transition from READY to CONNECTING if the connected subchannel disconnects after an update", done => {
    let currentStartState = ConnectivityState.READY;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.READY, ConnectivityState.CONNECTING],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      currentStartState = ConnectivityState.IDLE;
      pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 2 }] }], config);
      process.nextTick(() => {
        subchannels[0].transitionToState(ConnectivityState.IDLE);
      });
    });
  });
  it("Should transition from READY to TRANSIENT_FAILURE if the connected subchannel disconnects and the update fails", done => {
    let currentStartState = ConnectivityState.READY;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.READY, ConnectivityState.TRANSIENT_FAILURE],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      currentStartState = ConnectivityState.TRANSIENT_FAILURE;
      pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 2 }] }], config);
      process.nextTick(() => {
        subchannels[0].transitionToState(ConnectivityState.IDLE);
      });
    });
  });
  it("Should transition from READY to READY if a subchannel is connected and an update has a connected subchannel", done => {
    const currentStartState = ConnectivityState.READY;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.READY, ConnectivityState.READY],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 2 }] }], config);
      process.nextTick(() => {
        subchannels[0].transitionToState(ConnectivityState.IDLE);
      });
    });
  });
  it("Should request reresolution every time each child reports TF", done => {
    let reresolutionRequestCount = 0;
    const targetReresolutionRequestCount = 3;
    const currentStartState = ConnectivityState.IDLE;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.CONNECTING, ConnectivityState.TRANSIENT_FAILURE],
        err =>
          setImmediate(() => {
            assert.strictEqual(reresolutionRequestCount, targetReresolutionRequestCount);
            done(err);
          }),
      ),
      requestReresolution: () => {
        reresolutionRequestCount += 1;
      },
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
      process.nextTick(() => {
        pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 2 }] }], config);
        process.nextTick(() => {
          subchannels[1].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
          process.nextTick(() => {
            pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 3 }] }], config);
            process.nextTick(() => {
              subchannels[2].transitionToState(ConnectivityState.TRANSIENT_FAILURE);
            });
          });
        });
      });
    });
  });
  it("Should request reresolution if the new subchannels are already in TF", done => {
    let reresolutionRequestCount = 0;
    const targetReresolutionRequestCount = 3;
    const currentStartState = ConnectivityState.TRANSIENT_FAILURE;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence([ConnectivityState.TRANSIENT_FAILURE], err =>
        setImmediate(() => {
          assert.strictEqual(reresolutionRequestCount, targetReresolutionRequestCount);
          done(err);
        }),
      ),
      requestReresolution: () => {
        reresolutionRequestCount += 1;
      },
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 2 }] }], config);
      process.nextTick(() => {
        pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 2 }] }], config);
      });
    });
  });
  it("Should reconnect to the same address list if exitIdle is called", done => {
    const currentStartState = ConnectivityState.READY;
    const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
      createSubchannel: (subchannelAddress, subchannelArgs) => {
        const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), currentStartState);
        subchannels.push(subchannel);
        return subchannel;
      },
      updateState: updateStateCallBackForExpectedStateSequence(
        [ConnectivityState.READY, ConnectivityState.IDLE, ConnectivityState.READY],
        done,
      ),
    });
    const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
    pickFirst.updateAddressList([{ addresses: [{ host: "localhost", port: 1 }] }], config);
    process.nextTick(() => {
      subchannels[0].transitionToState(ConnectivityState.IDLE);
      process.nextTick(() => {
        pickFirst.exitIdle();
      });
    });
  });
  describe("Address list randomization", () => {
    const shuffleConfig = new PickFirstLoadBalancingConfig(true);
    it("Should pick different subchannels after multiple updates", done => {
      const pickedSubchannels: Set<string> = new Set();
      const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
        createSubchannel: (subchannelAddress, subchannelArgs) => {
          const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), ConnectivityState.READY);
          subchannels.push(subchannel);
          return subchannel;
        },
        updateState: (connectivityState, picker) => {
          if (connectivityState === ConnectivityState.READY) {
            const pickedSubchannel = picker.pick({
              extraPickInfo: {},
              metadata: new Metadata(),
            }).subchannel;
            if (pickedSubchannel) {
              pickedSubchannels.add(pickedSubchannel.getAddress());
            }
          }
        },
      });
      const endpoints: Endpoint[] = [];
      for (let i = 0; i < 10; i++) {
        endpoints.push({ addresses: [{ host: "localhost", port: i + 1 }] });
      }
      const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
      /* Pick from 10 subchannels 5 times, with address randomization enabled,
       * and verify that at least two different subchannels are picked. The
       * probability choosing the same address every time is 1/10,000, which
       * I am considering an acceptable flake rate */
      pickFirst.updateAddressList(endpoints, shuffleConfig);
      process.nextTick(() => {
        pickFirst.updateAddressList(endpoints, shuffleConfig);
        process.nextTick(() => {
          pickFirst.updateAddressList(endpoints, shuffleConfig);
          process.nextTick(() => {
            pickFirst.updateAddressList(endpoints, shuffleConfig);
            process.nextTick(() => {
              pickFirst.updateAddressList(endpoints, shuffleConfig);
              process.nextTick(() => {
                assert(pickedSubchannels.size > 1);
                done();
              });
            });
          });
        });
      });
    });
    it("Should pick the same subchannel if address randomization is disabled", done => {
      /* This is the same test as the previous one, except using the config
       * that does not enable address randomization. In this case, false
       * positive probability is 1/10,000. */
      const pickedSubchannels: Set<string> = new Set();
      const channelControlHelper = createChildChannelControlHelper(baseChannelControlHelper, {
        createSubchannel: (subchannelAddress, subchannelArgs) => {
          const subchannel = new MockSubchannel(subchannelAddressToString(subchannelAddress), ConnectivityState.READY);
          subchannels.push(subchannel);
          return subchannel;
        },
        updateState: (connectivityState, picker) => {
          if (connectivityState === ConnectivityState.READY) {
            const pickedSubchannel = picker.pick({
              extraPickInfo: {},
              metadata: new Metadata(),
            }).subchannel;
            if (pickedSubchannel) {
              pickedSubchannels.add(pickedSubchannel.getAddress());
            }
          }
        },
      });
      const endpoints: Endpoint[] = [];
      for (let i = 0; i < 10; i++) {
        endpoints.push({ addresses: [{ host: "localhost", port: i + 1 }] });
      }
      const pickFirst = new PickFirstLoadBalancer(channelControlHelper, creds, {});
      pickFirst.updateAddressList(endpoints, config);
      process.nextTick(() => {
        pickFirst.updateAddressList(endpoints, config);
        process.nextTick(() => {
          pickFirst.updateAddressList(endpoints, config);
          process.nextTick(() => {
            pickFirst.updateAddressList(endpoints, config);
            process.nextTick(() => {
              pickFirst.updateAddressList(endpoints, config);
              process.nextTick(() => {
                assert(pickedSubchannels.size === 1);
                done();
              });
            });
          });
        });
      });
    });
    describe("End-to-end functionality", () => {
      const serviceConfig = {
        methodConfig: [],
        loadBalancingConfig: [
          {
            pick_first: {
              shuffleAddressList: true,
            },
          },
        ],
      };
      let server: TestServer;
      let client: TestClient;
      before(async () => {
        server = new TestServer(false);
        await server.start();
        client = TestClient.createFromServer(server, {
          "grpc.service_config": JSON.stringify(serviceConfig),
        });
      });
      after(() => {
        client.close();
        server.shutdown();
      });
      it("Should still work with shuffleAddressList set", done => {
        client.sendRequest(error => {
          done(error);
        });
      });
    });
  });
});
