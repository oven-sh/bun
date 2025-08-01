import { describe, expect, it } from "bun:test";
import { isIPv6, isMacOS, isWindows } from "harness";
import * as dgram from "node:dgram";

describe.skipIf(!isIPv6())("node:dgram", () => {
  it("adds membership successfully (IPv6)", () => {
    const socket = makeSocket6();
    socket.bind(0, () => {
      socket.addMembership("ff01::1", getInterface());
      if (!isMacOS) {
        // macOS seems to be iffy with automatically choosing an interface.
        socket.addMembership("ff02::1");
      }
    });
  });

  it("doesn't add membership given invalid inputs (IPv6)", () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = makeSocket6();
    socket.bind(0, () => {
      expect(() => {
        // fe00:: is not a valid multicast address
        socket.addMembership("fe00::", getInterface());
        reject();
      }).toThrow();
      expect(() => {
        socket.addMembership("fe00::");
        reject();
      }).toThrow();
      resolve();
    });
    return promise;
  });
});

function makeSocket6() {
  return dgram.createSocket({
    type: "udp6",
    ipv6Only: true,
  });
}

function getInterface() {
  if (isWindows) {
    return "::%1";
  }

  if (isMacOS) {
    return "::%lo0";
  }

  return "::%lo";
}
