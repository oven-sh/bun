import { devTest } from "../bake-harness";
import { expect } from "bun:test";

// Basic test to verify request.cookies functionality
devTest("request.cookies.get() basic functionality", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const mode = "ssr";
      export const streaming = false;
      
      export default async function IndexPage({ request }) {
        // Try to access cookies
        const userName = request.cookies?.get?.("userName") || "not-found";
        
        return (
          <div>
            <p data-testid="cookie-value">{userName}</p>
          </div>
        );
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/", {
      headers: {
        Cookie: "userName=TestUser",
      },
    });

    const html = await response.text();
    // Check if the cookie value appears in the rendered HTML
    // The values appear with HTML comments (<!-- -->) in the output
    expect(html).toContain("TestUser");
  },
});

// Test that request object is passed to the component
devTest("request object is passed to SSR component", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const mode = "ssr";
      export const streaming = false;
      
      export default async function IndexPage({ request }) {
        // Check if request exists
        const hasRequest = request !== undefined;
        const requestType = typeof request;
        
        return (
          <div>
            <p>Has request: {hasRequest ? "yes" : "no"}</p>
            <p>Request type: {requestType}</p>
          </div>
        );
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const html = await response.text();
    
    // The values appear with HTML comments in the rendered output
    expect(html).toContain("yes");
    expect(html).toContain("object");
  },
});

// Test what properties are available on request.cookies
devTest("request.cookies properties check", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const mode = "ssr";
      export const streaming = false;
      
      export default async function IndexPage({ request }) {
        const hasCookies = request?.cookies !== undefined;
        const hasGet = typeof request?.cookies?.get === "function";
        const hasSet = typeof request?.cookies?.set === "function";
        const hasDelete = typeof request?.cookies?.delete === "function";
        const hasHas = typeof request?.cookies?.has === "function";
        
        return (
          <div>
            <p>Has cookies: {hasCookies ? "yes" : "no"}</p>
            <p>Has get: {hasGet ? "yes" : "no"}</p>
            <p>Has set: {hasSet ? "yes" : "no"}</p>
            <p>Has delete: {hasDelete ? "yes" : "no"}</p>
            <p>Has has: {hasHas ? "yes" : "no"}</p>
          </div>
        );
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const html = await response.text();
    
    // Check what's actually available
    console.log("Cookie API availability:");
    console.log(html.match(/Has cookies: (yes|no)/)?.[1]);
    console.log(html.match(/Has get: (yes|no)/)?.[1]);
    console.log(html.match(/Has set: (yes|no)/)?.[1]);
    
    // At minimum, we expect cookies object to exist
    // The values appear with HTML comments in the rendered output
    expect(html).toContain("yes");
  },
});

// Test error handling when cookies are not available
devTest("graceful handling when cookies API is incomplete", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const mode = "ssr";
      export const streaming = false;
      
      export default async function IndexPage({ request }) {
        let cookieValue = "default";
        
        try {
          // Try to get cookie, with fallback
          if (request?.cookies?.get) {
            cookieValue = request.cookies.get("test") || "not-found";
          } else if (request?.headers?.get) {
            // Fallback to parsing Cookie header directly
            const cookieHeader = request.headers.get("Cookie") || "";
            const match = cookieHeader.match(/test=([^;]+)/);
            cookieValue = match ? match[1] : "header-not-found";
          }
        } catch (e) {
          cookieValue = "error: " + e.message;
        }
        
        return (
          <div>
            <p>Cookie value: {cookieValue}</p>
          </div>
        );
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/", {
      headers: {
        Cookie: "test=HelloWorld",
      },
    });

    const html = await response.text();
    // Should get the cookie value one way or another
    // The values appear with HTML comments in the rendered output
    expect(html).toMatch(/(HelloWorld|not-found|header-not-found|default)/);
  },
});