/*
 * Copyright 2024 gRPC authors.
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
import * as path from "path";
import * as fs from "fs/promises";
import * as grpc from "@grpc/grpc-js";
import { beforeAll, describe, it } from "bun:test";
const { experimental } = grpc;
describe("Certificate providers", () => {
  describe("File watcher", () => {
    const [caPath, keyPath, certPath] = ["ca.pem", "server1.key", "server1.pem"].map(file =>
      path.join(__dirname, "fixtures", file),
    );
    let caData: Buffer, keyData: Buffer, certData: Buffer;
    beforeAll(async () => {
      [caData, keyData, certData] = await Promise.all(
        [caPath, keyPath, certPath].map(filePath => fs.readFile(filePath)),
      );
    });
    it("Should reject a config with no files", () => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        refreshIntervalMs: 1000,
      };
      assert.throws(() => {
        new experimental.FileWatcherCertificateProvider(config);
      });
    });
    it("Should accept a config with just a CA certificate", () => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        caCertificateFile: caPath,
        refreshIntervalMs: 1000,
      };
      assert.doesNotThrow(() => {
        new experimental.FileWatcherCertificateProvider(config);
      });
    });
    it("Should accept a config with just a key and certificate", () => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        certificateFile: certPath,
        privateKeyFile: keyPath,
        refreshIntervalMs: 1000,
      };
      assert.doesNotThrow(() => {
        new experimental.FileWatcherCertificateProvider(config);
      });
    });
    it("Should accept a config with all files", () => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        caCertificateFile: caPath,
        certificateFile: certPath,
        privateKeyFile: keyPath,
        refreshIntervalMs: 1000,
      };
      assert.doesNotThrow(() => {
        new experimental.FileWatcherCertificateProvider(config);
      });
    });
    it("Should reject a config with a key but no certificate", () => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        caCertificateFile: caPath,
        privateKeyFile: keyPath,
        refreshIntervalMs: 1000,
      };
      assert.throws(() => {
        new experimental.FileWatcherCertificateProvider(config);
      });
    });
    it("Should reject a config with a certificate but no key", () => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        caCertificateFile: caPath,
        privateKeyFile: keyPath,
        refreshIntervalMs: 1000,
      };
      assert.throws(() => {
        new experimental.FileWatcherCertificateProvider(config);
      });
    });
    it("Should find the CA file when configured for it", done => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        caCertificateFile: caPath,
        refreshIntervalMs: 1000,
      };
      const provider = new experimental.FileWatcherCertificateProvider(config);
      const listener: experimental.CaCertificateUpdateListener = update => {
        if (update) {
          provider.removeCaCertificateListener(listener);
          assert(update.caCertificate.equals(caData));
          done();
        }
      };
      provider.addCaCertificateListener(listener);
    });
    it("Should find the identity certificate files when configured for it", done => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        certificateFile: certPath,
        privateKeyFile: keyPath,
        refreshIntervalMs: 1000,
      };
      const provider = new experimental.FileWatcherCertificateProvider(config);
      const listener: experimental.IdentityCertificateUpdateListener = update => {
        if (update) {
          provider.removeIdentityCertificateListener(listener);
          assert(update.certificate.equals(certData));
          assert(update.privateKey.equals(keyData));
          done();
        }
      };
      provider.addIdentityCertificateListener(listener);
    });
    it("Should find all files when configured for it", done => {
      const config: experimental.FileWatcherCertificateProviderConfig = {
        caCertificateFile: caPath,
        certificateFile: certPath,
        privateKeyFile: keyPath,
        refreshIntervalMs: 1000,
      };
      const provider = new experimental.FileWatcherCertificateProvider(config);
      let seenCaUpdate = false;
      let seenIdentityUpdate = false;
      const caListener: experimental.CaCertificateUpdateListener = update => {
        if (update) {
          provider.removeCaCertificateListener(caListener);
          assert(update.caCertificate.equals(caData));
          seenCaUpdate = true;
          if (seenIdentityUpdate) {
            done();
          }
        }
      };
      const identityListener: experimental.IdentityCertificateUpdateListener = update => {
        if (update) {
          provider.removeIdentityCertificateListener(identityListener);
          assert(update.certificate.equals(certData));
          assert(update.privateKey.equals(keyData));
          seenIdentityUpdate = true;
          if (seenCaUpdate) {
            done();
          }
        }
      };
      provider.addCaCertificateListener(caListener);
      provider.addIdentityCertificateListener(identityListener);
    });
  });
});
