import { expect } from "bun:test";
import { devTest } from "../bake-harness";

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
