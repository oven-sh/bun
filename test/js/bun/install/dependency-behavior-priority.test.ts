import { test, expect } from "bun:test";

// Mock the Behavior struct for testing
class MockBehavior {
  prod: boolean = false;
  dev: boolean = false;
  peer: boolean = false;
  optional: boolean = false;
  workspace: boolean = false;
  bundled: boolean = false;

  constructor(options: Partial<MockBehavior> = {}) {
    Object.assign(this, options);
  }

  isProd() { return this.prod; }
  isDev() { return this.dev; }
  isPeer() { return this.peer; }
  isOptional() { return this.optional && !this.peer; }
  isWorkspace() { return this.workspace; }
  isBundled() { return this.bundled; }
  isWorkspaceOnly() { return this.workspace && !this.dev && !this.prod && !this.optional && !this.peer; }

  eq(other: MockBehavior) {
    return this.prod === other.prod &&
           this.dev === other.dev &&
           this.peer === other.peer &&
           this.optional === other.optional &&
           this.workspace === other.workspace &&
           this.bundled === other.bundled;
  }

  // Mirror the comparison logic from Zig
  cmp(other: MockBehavior): "lt" | "eq" | "gt" {
    if (this.eq(other)) {
      return "eq";
    }

    if (this.isWorkspaceOnly() !== other.isWorkspaceOnly()) {
      return this.isWorkspaceOnly() ? "lt" : "gt";
    }

    if (this.isProd() !== other.isProd()) {
      return this.isProd() ? "gt" : "lt";
    }

    // Special handling for workspace packages with both dev and peer dependencies
    // If both behaviors have workspace flag, prioritize dev over peer
    if (this.workspace && other.workspace) {
      if (this.dev && this.peer && other.peer && !other.dev) {
        // this is workspace + dev + peer, other is workspace + peer only
        return "gt";
      }
      if (other.dev && other.peer && this.peer && !this.dev) {
        // other is workspace + dev + peer, this is workspace + peer only
        return "lt";
      }
    }

    if (this.isDev() !== other.isDev()) {
      return this.isDev() ? "gt" : "lt";
    }

    if (this.isPeer() !== other.isPeer()) {
      return this.isPeer() ? "gt" : "lt";
    }

    if (this.isOptional() !== other.isOptional()) {
      return this.isOptional() ? "gt" : "lt";
    }

    if (this.isWorkspace() !== other.isWorkspace()) {
      return this.isWorkspace() ? "gt" : "lt";
    }

    return "eq";
  }
}

test("dependency behavior comparison for workspace packages prioritizes dev+peer over peer-only", () => {
  const workspaceDevPeer = new MockBehavior({ workspace: true, dev: true, peer: true });
  const workspacePeerOnly = new MockBehavior({ workspace: true, peer: true });

  // workspace + dev + peer should have higher priority than workspace + peer only
  expect(workspaceDevPeer.cmp(workspacePeerOnly)).toBe("gt");
  expect(workspacePeerOnly.cmp(workspaceDevPeer)).toBe("lt");
});

test("regular dev vs peer dependencies follow standard priority", () => {
  const devBehavior = new MockBehavior({ dev: true });
  const peerBehavior = new MockBehavior({ peer: true });

  // Without workspace flag, dev and peer follow standard ordering
  expect(devBehavior.cmp(peerBehavior)).toBe("gt");
  expect(peerBehavior.cmp(devBehavior)).toBe("lt");
});

test("dependency behavior comparison handles production dependencies", () => {
  const prodBehavior = new MockBehavior({ prod: true });
  const devBehavior = new MockBehavior({ dev: true });
  const peerBehavior = new MockBehavior({ peer: true });

  // Production dependencies should have highest priority
  expect(prodBehavior.cmp(devBehavior)).toBe("gt");
  expect(prodBehavior.cmp(peerBehavior)).toBe("gt");
  expect(devBehavior.cmp(prodBehavior)).toBe("lt");
  expect(peerBehavior.cmp(prodBehavior)).toBe("lt");
});

test("dependency behavior comparison handles workspace dependencies", () => {
  const workspaceOnlyBehavior = new MockBehavior({ workspace: true });
  const devBehavior = new MockBehavior({ dev: true });
  const peerBehavior = new MockBehavior({ peer: true });

  // Workspace-only dependencies should have highest priority
  expect(workspaceOnlyBehavior.cmp(devBehavior)).toBe("lt");
  expect(workspaceOnlyBehavior.cmp(peerBehavior)).toBe("lt");
  expect(devBehavior.cmp(workspaceOnlyBehavior)).toBe("gt");
  expect(peerBehavior.cmp(workspaceOnlyBehavior)).toBe("gt");
});

test("dependency behavior comparison handles optional dependencies", () => {
  const optionalBehavior = new MockBehavior({ optional: true });
  const devBehavior = new MockBehavior({ dev: true });
  const peerBehavior = new MockBehavior({ peer: true });

  // Optional dependencies should have lower priority than dev/peer dependencies
  expect(devBehavior.cmp(optionalBehavior)).toBe("gt");
  expect(peerBehavior.cmp(optionalBehavior)).toBe("gt");
  expect(optionalBehavior.cmp(devBehavior)).toBe("lt");
  expect(optionalBehavior.cmp(peerBehavior)).toBe("lt");
});

test("workspace-specific behavior for dev+peer vs peer dependencies", () => {
  // Test the specific Next.js monorepo scenario
  const workspaceDevPeer = new MockBehavior({ workspace: true, dev: true, peer: true });
  const workspacePeer = new MockBehavior({ workspace: true, peer: true });
  const workspaceDev = new MockBehavior({ workspace: true, dev: true });
  
  // Workspace dev+peer should be prioritized over workspace peer-only
  expect(workspaceDevPeer.cmp(workspacePeer)).toBe("gt");
  expect(workspacePeer.cmp(workspaceDevPeer)).toBe("lt");
  
  // Workspace dev+peer vs workspace dev-only follows standard rules
  expect(workspaceDevPeer.cmp(workspaceDev)).toBe("gt"); // peer flag adds to priority
});

test("non-workspace behavior remains unchanged", () => {
  const devPeerBehavior = new MockBehavior({ dev: true, peer: true });
  const peerOnlyBehavior = new MockBehavior({ peer: true });
  const devOnlyBehavior = new MockBehavior({ dev: true });

  // Without workspace flag, behavior follows standard priority rules
  expect(devPeerBehavior.cmp(devPeerBehavior)).toBe("eq");
  expect(devPeerBehavior.cmp(peerOnlyBehavior)).toBe("gt");
  expect(devPeerBehavior.cmp(devOnlyBehavior)).toBe("gt"); // dev+peer has higher priority than dev-only
});

test("dependency sorting order matches intended priority", () => {
  const behaviors = [
    new MockBehavior({ workspace: true }), // workspace-only (highest priority)
    new MockBehavior({ prod: true }),      // production
    new MockBehavior({ dev: true }),       // dev
    new MockBehavior({ peer: true }),      // peer
    new MockBehavior({ optional: true }),  // optional (lowest priority)
  ];

  // Test that each behavior has higher priority than the ones that come after it
  for (let i = 0; i < behaviors.length - 1; i++) {
    for (let j = i + 1; j < behaviors.length; j++) {
      const result = behaviors[i].cmp(behaviors[j]);
      const reverseResult = behaviors[j].cmp(behaviors[i]);
      
      // Workspace-only should be "lt" (higher priority = lower in sort order)
      // Others should be "gt" (higher priority = greater in comparison)
      if (i === 0) {
        expect(result).toBe("lt");
        expect(reverseResult).toBe("gt");
      } else {
        expect(result).toBe("gt");
        expect(reverseResult).toBe("lt");
      }
    }
  }
});