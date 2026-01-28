#!/usr/bin/env bun
/**
 * CI preparation script for Docker test services
 *
 * This script pre-pulls and builds all Docker images needed for tests
 * to avoid failures during test execution.
 *
 * Usage: bun test/docker/prepare-ci.ts
 */

import { prepareImages } from "./index";

async function main() {
  console.log("Preparing Docker test infrastructure for CI...");

  try {
    await prepareImages();
    console.log("✅ Docker test infrastructure is ready");
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to prepare Docker test infrastructure:", error);
    process.exit(1);
  }
}

main();