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

// Allow `any` data type for testing runtime type checking.
// tslint:disable no-any
import assert from "assert";
import * as resolverManager from "@grpc/grpc-js/build/src/resolver";
import * as resolver_dns from "@grpc/grpc-js/build/src/resolver-dns";
import * as resolver_uds from "@grpc/grpc-js/build/src/resolver-uds";
import * as resolver_ip from "@grpc/grpc-js/build/src/resolver-ip";
import { ServiceConfig } from "@grpc/grpc-js/build/src/service-config";
import { StatusObject } from "@grpc/grpc-js/build/src/call-interface";
import { isIPv6 } from "harness";
import {
  Endpoint,
  SubchannelAddress,
  endpointToString,
  subchannelAddressEqual,
} from "@grpc/grpc-js/build/src/subchannel-address";
import { parseUri, GrpcUri } from "@grpc/grpc-js/build/src/uri-parser";
import { GRPC_NODE_USE_ALTERNATIVE_RESOLVER } from "@grpc/grpc-js/build/src/environment";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

function hasMatchingAddress(endpointList: Endpoint[], expectedAddress: SubchannelAddress): boolean {
  for (const endpoint of endpointList) {
    for (const address of endpoint.addresses) {
      if (subchannelAddressEqual(address, expectedAddress)) {
        return true;
      }
    }
  }
  return false;
}

describe("Name Resolver", () => {
  before(() => {
    resolver_dns.setup();
    resolver_uds.setup();
    resolver_ip.setup();
  });
  describe("DNS Names", function () {
    // For some reason DNS queries sometimes take a long time on Windows
    it("Should resolve localhost properly", function (done) {
      if (GRPC_NODE_USE_ALTERNATIVE_RESOLVER) {
        this.skip();
      }
      const target = resolverManager.mapUriDefaultScheme(parseUri("localhost:50051")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 50051 }));
          if (isIPv6()) {
            assert(hasMatchingAddress(endpointList, { host: "::1", port: 50051 }));
          }
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("Should default to port 443", function (done) {
      if (GRPC_NODE_USE_ALTERNATIVE_RESOLVER) {
        this.skip();
      }
      const target = resolverManager.mapUriDefaultScheme(parseUri("localhost")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 443 }));
          if (isIPv6()) {
            assert(hasMatchingAddress(endpointList, { host: "::1", port: 443 }));
          }
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("Should correctly represent an ipv4 address", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("1.2.3.4")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "1.2.3.4", port: 443 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("Should correctly represent an ipv6 address", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("::1")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "::1", port: 443 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("Should correctly represent a bracketed ipv6 address", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("[::1]:50051")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "::1", port: 50051 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("Should resolve a public address", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("example.com")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(endpointList.length > 0);
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    // Created DNS TXT record using TXT sample from https://github.com/grpc/proposal/blob/master/A2-service-configs-in-dns.md
    // "grpc_config=[{\"serviceConfig\":{\"loadBalancingPolicy\":\"round_robin\",\"methodConfig\":[{\"name\":[{\"service\":\"MyService\",\"method\":\"Foo\"}],\"waitForReady\":true}]}}]"
    it.skip("Should resolve a name with TXT service config", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("grpctest.kleinsch.com")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          if (serviceConfig !== null) {
            assert(serviceConfig.loadBalancingPolicy === "round_robin", "Should have found round robin LB policy");
            done();
          }
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it.skip("Should not resolve TXT service config if we disabled service config", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("grpctest.kleinsch.com")!)!;
      let count = 0;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          assert(serviceConfig === null, "Should not have found service config");
          count++;
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {
        "grpc.service_config_disable_resolution": 1,
      });
      resolver.updateResolution();
      setTimeout(() => {
        assert(count === 1, "Should have only resolved once");
        done();
      }, 2_000);
    });
    /* The DNS entry for loopback4.unittest.grpc.io only has a single A record
     * with the address 127.0.0.1, but the Mac DNS resolver appears to use
     * NAT64 to create an IPv6 address in that case, so it instead returns
     * 64:ff9b::7f00:1. Handling that kind of translation is outside of the
     * scope of this test, so we are skipping it. The test primarily exists
     * as a regression test for https://github.com/grpc/grpc-node/issues/1044,
     * and the test 'Should resolve gRPC interop servers' tests the same thing.
     */
    it.skip("Should resolve a name with multiple dots", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("loopback4.unittest.grpc.io")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(
            hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 443 }),
            `None of [${endpointList.map(addr => endpointToString(addr))}] matched '127.0.0.1:443'`,
          );
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    /* TODO(murgatroid99): re-enable this test, once we can get the IPv6 result
     * consistently */
    it.skip("Should resolve a DNS name to an IPv6 address", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("loopback6.unittest.grpc.io")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "::1", port: 443 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    /* This DNS name resolves to only the IPv4 address on Windows, and only the
     * IPv6 address on Mac. There is no result that we can consistently test
     * for here. */
    it.skip("Should resolve a DNS name to IPv4 and IPv6 addresses", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("loopback46.unittest.grpc.io")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(
            hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 443 }),
            `None of [${endpointList.map(addr => endpointToString(addr))}] matched '127.0.0.1:443'`,
          );
          /* TODO(murgatroid99): check for IPv6 result, once we can get that
           * consistently */
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("Should resolve a name with a hyphen", done => {
      /* TODO(murgatroid99): Find or create a better domain name to test this with.
       * This is just the first one I found with a hyphen. */
      const target = resolverManager.mapUriDefaultScheme(parseUri("network-tools.com")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(endpointList.length > 0);
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    /* This test also serves as a regression test for
     * https://github.com/grpc/grpc-node/issues/1044, specifically handling
     * hyphens and multiple periods in a DNS name. It should not be skipped
     * unless there is another test for the same issue. */
    it("Should resolve gRPC interop servers", done => {
      let completeCount = 0;
      const target1 = resolverManager.mapUriDefaultScheme(parseUri("grpc-test.sandbox.googleapis.com")!)!;
      const target2 = resolverManager.mapUriDefaultScheme(parseUri("grpc-test4.sandbox.googleapis.com")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          assert(endpointList.length > 0);
          completeCount += 1;
          if (completeCount === 2) {
            // Only handle the first resolution result
            listener.onSuccessfulResolution = () => {};
            done();
          }
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver1 = resolverManager.createResolver(target1, listener, {});
      resolver1.updateResolution();
      const resolver2 = resolverManager.createResolver(target2, listener, {});
      resolver2.updateResolution();
    });
    it.todo(
      "should not keep repeating successful resolutions",
      function (done) {
        if (GRPC_NODE_USE_ALTERNATIVE_RESOLVER) {
          this.skip();
        }
        const target = resolverManager.mapUriDefaultScheme(parseUri("localhost")!)!;
        let resultCount = 0;
        const resolver = resolverManager.createResolver(
          target,
          {
            onSuccessfulResolution: (
              endpointList: Endpoint[],
              serviceConfig: ServiceConfig | null,
              serviceConfigError: StatusObject | null,
            ) => {
              assert(hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 443 }));
              assert(hasMatchingAddress(endpointList, { host: "::1", port: 443 }));
              resultCount += 1;
              if (resultCount === 1) {
                process.nextTick(() => resolver.updateResolution());
              }
            },
            onError: (error: StatusObject) => {
              assert.ifError(error);
            },
          },
          { "grpc.dns_min_time_between_resolutions_ms": 2000 },
        );
        resolver.updateResolution();
        setTimeout(() => {
          assert.strictEqual(resultCount, 2, `resultCount ${resultCount} !== 2`);
          done();
        }, 10_000);
      },
      15_000,
    );
    it("should not keep repeating failed resolutions", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("host.invalid")!)!;
      let resultCount = 0;
      const resolver = resolverManager.createResolver(
        target,
        {
          onSuccessfulResolution: (
            endpointList: Endpoint[],
            serviceConfig: ServiceConfig | null,
            serviceConfigError: StatusObject | null,
          ) => {
            assert.fail("Resolution succeeded unexpectedly");
          },
          onError: (error: StatusObject) => {
            resultCount += 1;
            if (resultCount === 1) {
              process.nextTick(() => resolver.updateResolution());
            }
          },
        },
        {},
      );
      resolver.updateResolution();
      setTimeout(() => {
        assert.strictEqual(resultCount, 2, `resultCount ${resultCount} !== 2`);
        done();
      }, 10_000);
    }, 15_000);
  });
  describe("UDS Names", () => {
    it("Should handle a relative Unix Domain Socket name", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("unix:socket")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { path: "socket" }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("Should handle an absolute Unix Domain Socket name", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("unix:///tmp/socket")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { path: "/tmp/socket" }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
  });
  describe("IP Addresses", () => {
    it("should handle one IPv4 address with no port", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("ipv4:127.0.0.1")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 443 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("should handle one IPv4 address with a port", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("ipv4:127.0.0.1:50051")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 50051 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("should handle multiple IPv4 addresses with different ports", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("ipv4:127.0.0.1:50051,127.0.0.1:50052")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 50051 }));
          assert(hasMatchingAddress(endpointList, { host: "127.0.0.1", port: 50052 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("should handle one IPv6 address with no port", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("ipv6:::1")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "::1", port: 443 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("should handle one IPv6 address with a port", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("ipv6:[::1]:50051")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "::1", port: 50051 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
    it("should handle multiple IPv6 addresses with different ports", done => {
      const target = resolverManager.mapUriDefaultScheme(parseUri("ipv6:[::1]:50051,[::1]:50052")!)!;
      const listener: resolverManager.ResolverListener = {
        onSuccessfulResolution: (
          endpointList: Endpoint[],
          serviceConfig: ServiceConfig | null,
          serviceConfigError: StatusObject | null,
        ) => {
          // Only handle the first resolution result
          listener.onSuccessfulResolution = () => {};
          assert(hasMatchingAddress(endpointList, { host: "::1", port: 50051 }));
          assert(hasMatchingAddress(endpointList, { host: "::1", port: 50052 }));
          done();
        },
        onError: (error: StatusObject) => {
          done(new Error(`Failed with status ${error.details}`));
        },
      };
      const resolver = resolverManager.createResolver(target, listener, {});
      resolver.updateResolution();
    });
  });
  describe("getDefaultAuthority", () => {
    class OtherResolver implements resolverManager.Resolver {
      updateResolution() {
        return [];
      }

      destroy() {}

      static getDefaultAuthority(target: GrpcUri): string {
        return "other";
      }
    }

    it("Should return the correct authority if a different resolver has been registered", () => {
      resolverManager.registerResolver("other", OtherResolver);
      const target = resolverManager.mapUriDefaultScheme(parseUri("other:name")!)!;
      console.log(target);

      const authority = resolverManager.getDefaultAuthority(target);
      assert.equal(authority, "other");
    });
  });
});
