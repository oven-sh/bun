import { test, expect, describe, beforeAll, afterAll } from "bun:test";

describe("Bun.Browser Integration", () => {
  test("should launch browser and create page", async () => {
    let browser;
    let page;
    
    try {
      // Launch browser with minimal options
      browser = await Bun.browser({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
        ],
        timeout: 10000,
      });
      
      expect(browser).toBeDefined();
      expect(browser.isConnected).toBe(true);
      
      // Create a new page
      page = await browser.newPage();
      expect(page).toBeDefined();
      expect(page.url()).toBe("about:blank");
      
      // Navigate to a simple data URL
      const response = await page.goto("data:text/html,<html><body><h1>Test Page</h1></body></html>");
      expect(response).toBeDefined();
      expect(response.ok).toBe(true);
      
      // Get page content
      const content = await page.content();
      expect(content).toContain("<h1>Test Page</h1>");
      
      // Get page title
      await page.setContent("<html><head><title>Test Title</title></head><body></body></html>");
      const title = await page.title();
      expect(title).toBe("Test Title");
      
    } catch (error) {
      console.error("Browser test failed:", error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
    }
  }, 30000); // 30 second timeout for this integration test

  test("should handle simple JavaScript evaluation", async () => {
    let browser;
    let page;
    
    try {
      browser = await Bun.browser({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        timeout: 10000,
      });
      
      page = await browser.newPage();
      
      // Evaluate simple expression
      const result1 = await page.evaluate("2 + 2");
      expect(result1).toBe(4);
      
      // Evaluate function
      const result2 = await page.evaluate(() => {
        return "Hello from page context";
      });
      expect(result2).toBe("Hello from page context");
      
      // Evaluate with arguments
      const result3 = await page.evaluate((a, b) => a * b, 6, 7);
      expect(result3).toBe(42);
      
    } catch (error) {
      console.error("JavaScript evaluation test failed:", error);
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
    }
  }, 30000);

  test("should handle viewport manipulation", async () => {
    let browser;
    let page;
    
    try {
      browser = await Bun.browser({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        timeout: 10000,
      });
      
      page = await browser.newPage();
      
      // Set custom viewport
      await page.setViewport({
        width: 800,
        height: 600,
        deviceScaleFactor: 2.0,
      });
      
      const viewport = page.viewport();
      expect(viewport.width).toBe(800);
      expect(viewport.height).toBe(600);
      expect(viewport.deviceScaleFactor).toBe(2.0);
      
    } catch (error) {
      console.error("Viewport test failed:", error);
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
    }
  }, 30000);

  test("should handle basic DOM interaction", async () => {
    let browser;
    let page;
    
    try {
      browser = await Bun.browser({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        timeout: 10000,
      });
      
      page = await browser.newPage();
      
      // Set up a test page
      await page.setContent(`
        <html>
          <body>
            <button id="test-btn">Click Me</button>
            <input id="test-input" type="text" />
            <div id="result"></div>
            <script>
              document.getElementById('test-btn').onclick = function() {
                document.getElementById('result').textContent = 'Button clicked!';
              };
            </script>
          </body>
        </html>
      `);
      
      // Find button element
      const button = await page.querySelector("#test-btn");
      expect(button).toBeDefined();
      
      // Click the button
      await page.click("#test-btn");
      
      // Check the result
      const resultText = await page.evaluate(() => {
        return document.getElementById("result").textContent;
      });
      expect(resultText).toBe("Button clicked!");
      
      // Type in input field
      await page.type("#test-input", "Hello World");
      const inputValue = await page.evaluate(() => {
        return document.getElementById("test-input").value;
      });
      expect(inputValue).toBe("Hello World");
      
    } catch (error) {
      console.error("DOM interaction test failed:", error);
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
    }
  }, 30000);

  test("should take screenshots", async () => {
    let browser;
    let page;
    
    try {
      browser = await Bun.browser({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        timeout: 10000,
      });
      
      page = await browser.newPage();
      
      // Navigate to a simple page
      await page.setContent(`
        <html>
          <body style="background: linear-gradient(45deg, #ff6b6b, #4ecdc4); height: 100vh; display: flex; align-items: center; justify-content: center;">
            <h1 style="color: white; font-family: Arial; font-size: 48px;">Screenshot Test</h1>
          </body>
        </html>
      `);
      
      // Take a screenshot
      const screenshot = await page.screenshot({
        type: "png",
        encoding: "binary",
      });
      
      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);
      
      // Verify it's a valid PNG by checking the header
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(screenshot.subarray(0, 8)).toEqual(pngHeader);
      
    } catch (error) {
      console.error("Screenshot test failed:", error);
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
    }
  }, 30000);

  test("should handle multiple pages", async () => {
    let browser;
    const pages = [];
    
    try {
      browser = await Bun.browser({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        timeout: 10000,
      });
      
      // Create multiple pages
      for (let i = 0; i < 3; i++) {
        const page = await browser.newPage();
        await page.setContent(`<html><body><h1>Page ${i + 1}</h1></body></html>`);
        pages.push(page);
      }
      
      // Get all pages
      const allPages = await browser.pages();
      expect(allPages.length).toBeGreaterThanOrEqual(3);
      
      // Verify each page has the correct content
      for (let i = 0; i < pages.length; i++) {
        const content = await pages[i].content();
        expect(content).toContain(`Page ${i + 1}`);
      }
      
    } catch (error) {
      console.error("Multiple pages test failed:", error);
      throw error;
    } finally {
      // Close all pages
      for (const page of pages) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }
      
      if (browser) {
        await browser.close();
      }
    }
  }, 30000);
});