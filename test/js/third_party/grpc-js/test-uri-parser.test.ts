/*
 * Copyright 2020 gRPC authors.
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
import * as uriParser from "@grpc/grpc-js/build/src/uri-parser";
import * as resolver from "@grpc/grpc-js/build/src/resolver";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

describe("URI Parser", function () {
  describe("parseUri", function () {
    const expectationList: {
      target: string;
      result: uriParser.GrpcUri | null;
    }[] = [
      {
        target: "localhost",
        result: { scheme: undefined, authority: undefined, path: "localhost" },
      },
      /* This looks weird, but it's OK because the resolver selection code will handle it */
      {
        target: "localhost:80",
        result: { scheme: "localhost", authority: undefined, path: "80" },
      },
      {
        target: "dns:localhost",
        result: { scheme: "dns", authority: undefined, path: "localhost" },
      },
      {
        target: "dns:///localhost",
        result: { scheme: "dns", authority: "", path: "localhost" },
      },
      {
        target: "dns://authority/localhost",
        result: { scheme: "dns", authority: "authority", path: "localhost" },
      },
      {
        target: "//authority/localhost",
        result: {
          scheme: undefined,
          authority: "authority",
          path: "localhost",
        },
      },
      // Regression test for https://github.com/grpc/grpc-node/issues/1359
      {
        target: "dns:foo-internal.aws-us-east-2.tracing.staging-edge.foo-data.net:443:443",
        result: {
          scheme: "dns",
          authority: undefined,
          path: "foo-internal.aws-us-east-2.tracing.staging-edge.foo-data.net:443:443",
        },
      },
    ];
    for (const { target, result } of expectationList) {
      it(target, function () {
        assert.deepStrictEqual(uriParser.parseUri(target), result);
      });
    }
  });

  describe.todo("parseUri + mapUriDefaultScheme", function () {
    const expectationList: {
      target: string;
      result: uriParser.GrpcUri | null;
    }[] = [
      {
        target: "localhost",
        result: { scheme: "dns", authority: undefined, path: "localhost" },
      },
      {
        target: "localhost:80",
        result: { scheme: "dns", authority: undefined, path: "localhost:80" },
      },
      {
        target: "dns:localhost",
        result: { scheme: "dns", authority: undefined, path: "localhost" },
      },
      {
        target: "dns:///localhost",
        result: { scheme: "dns", authority: "", path: "localhost" },
      },
      {
        target: "dns://authority/localhost",
        result: { scheme: "dns", authority: "authority", path: "localhost" },
      },
      {
        target: "unix:socket",
        result: { scheme: "unix", authority: undefined, path: "socket" },
      },
      {
        target: "bad:path",
        result: { scheme: "dns", authority: undefined, path: "bad:path" },
      },
    ];
    for (const { target, result } of expectationList) {
      it(target, function () {
        assert.deepStrictEqual(resolver.mapUriDefaultScheme(uriParser.parseUri(target) ?? { path: "null" }), result);
      });
    }
  });

  describe("splitHostPort", function () {
    const expectationList: {
      path: string;
      result: uriParser.HostPort | null;
    }[] = [
      { path: "localhost", result: { host: "localhost" } },
      { path: "localhost:123", result: { host: "localhost", port: 123 } },
      { path: "12345:6789", result: { host: "12345", port: 6789 } },
      { path: "[::1]:123", result: { host: "::1", port: 123 } },
      { path: "[::1]", result: { host: "::1" } },
      { path: "[", result: null },
      { path: "[123]", result: null },
      // Regression test for https://github.com/grpc/grpc-node/issues/1359
      {
        path: "foo-internal.aws-us-east-2.tracing.staging-edge.foo-data.net:443:443",
        result: {
          host: "foo-internal.aws-us-east-2.tracing.staging-edge.foo-data.net:443:443",
        },
      },
    ];
    for (const { path, result } of expectationList) {
      it(path, function () {
        assert.deepStrictEqual(uriParser.splitHostPort(path), result);
      });
    }
  });
});
