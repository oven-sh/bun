import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Browser, Page } from "bun:browser";

describe("Bun.Browser", () => {
  describe("Browser.launch()", () => {
    test("should launch a browser instance", async () => {
      const browser = await Bun.browser({ headless: true });
      expect(browser).toBeDefined();
      expect(browser.isConnected).toBe(true);
      await browser.close();
    });

    test("should launch with custom options", async () => {
      const browser = await Bun.browser({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        timeout: 30000,
      });
      expect(browser).toBeDefined();
      expect(browser.isConnected).toBe(true);
      await browser.close();
    });

    test("should have WebSocket endpoint", async () => {
      const browser = await Bun.browser({ headless: true });
      expect(browser.wsEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser$/);
      await browser.close();
    });

    test("should have process information", async () => {
      const browser = await Bun.browser({ headless: true });
      expect(browser.process).toBeDefined();
      await browser.close();
    });
  });

  describe("Browser methods", () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await Bun.browser({ headless: true });
    });

    afterAll(async () => {
      await browser.close();
    });

    test("should create new page", async () => {
      const page = await browser.newPage();
      expect(page).toBeDefined();
      expect(page.url()).toBe("about:blank");
      await page.close();
    });

    test("should list pages", async () => {
      const page1 = await browser.newPage();
      const page2 = await browser.newPage();
      
      const pages = await browser.pages();
      expect(pages.length).toBeGreaterThanOrEqual(2);
      
      await page1.close();
      await page2.close();
    });

    test("should get version information", async () => {
      const version = await browser.version();
      expect(version).toBeDefined();
      expect(version.Browser).toBeDefined();
      expect(version["Protocol-Version"]).toBeDefined();
      expect(version["User-Agent"]).toBeDefined();
    });

    test("should disconnect from browser", async () => {
      const tempBrowser = await Bun.browser({ headless: true });
      expect(tempBrowser.isConnected).toBe(true);
      
      await tempBrowser.disconnect();
      expect(tempBrowser.isConnected).toBe(false);
    });
  });
});

describe("Page", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await Bun.browser({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page.close();
    await browser.close();
  });

  describe("Navigation", () => {
    test("should navigate to URL", async () => {
      const response = await page.goto("https://example.com");
      expect(response).toBeDefined();
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });

    test("should get current URL", async () => {
      await page.goto("https://example.com");
      expect(page.url()).toBe("https://example.com");
    });

    test("should get page title", async () => {
      await page.goto("https://example.com");
      const title = await page.title();
      expect(typeof title).toBe("string");
    });

    test("should reload page", async () => {
      await page.goto("https://example.com");
      const response = await page.reload();
      expect(response).toBeDefined();
    });

    test("should go back and forward", async () => {
      await page.goto("https://example.com");
      await page.goto("https://httpbin.org");
      
      const backResponse = await page.goBack();
      expect(backResponse).toBeDefined();
      
      const forwardResponse = await page.goForward();
      expect(forwardResponse).toBeDefined();
    });
  });

  describe("Content manipulation", () => {
    test("should get page content", async () => {
      await page.goto("data:text/html,<html><body><h1>Test</h1></body></html>");
      const content = await page.content();
      expect(content).toContain("<h1>Test</h1>");
    });

    test("should set page content", async () => {
      const html = "<html><body><h1>Custom Content</h1></body></html>";
      await page.setContent(html);
      const content = await page.content();
      expect(content).toContain("Custom Content");
    });
  });

  describe("JavaScript evaluation", () => {
    test("should evaluate expression", async () => {
      const result = await page.evaluate("1 + 2");
      expect(result).toBe(3);
    });

    test("should evaluate function", async () => {
      const result = await page.evaluate(() => {
        return document.title;
      });
      expect(typeof result).toBe("string");
    });

    test("should evaluate function with arguments", async () => {
      const result = await page.evaluate((a, b) => a + b, 5, 3);
      expect(result).toBe(8);
    });

    test("should handle evaluation errors", async () => {
      try {
        await page.evaluate("throw new Error('Test error')");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("Test error");
      }
    });
  });

  describe("Element interaction", () => {
    test("should find element with querySelector", async () => {
      await page.setContent("<html><body><button id='test-btn'>Click me</button></body></html>");
      const button = await page.querySelector("#test-btn");
      expect(button).toBeDefined();
    });

    test("should find multiple elements with querySelectorAll", async () => {
      await page.setContent("<html><body><div class='item'>1</div><div class='item'>2</div></body></html>");
      const elements = await page.querySelectorAll(".item");
      expect(elements.length).toBe(2);
    });

    test("should click element", async () => {
      await page.setContent(`
        <html><body>
          <button id='test-btn' onclick='this.textContent = "Clicked"'>Click me</button>
        </body></html>
      `);
      
      await page.click("#test-btn");
      const text = await page.evaluate(() => document.getElementById("test-btn").textContent);
      expect(text).toBe("Clicked");
    });

    test("should type text", async () => {
      await page.setContent("<html><body><input id='test-input' /></body></html>");
      await page.type("#test-input", "Hello World");
      
      const value = await page.evaluate(() => document.getElementById("test-input").value);
      expect(value).toBe("Hello World");
    });
  });

  describe("Waiting", () => {
    test("should wait for selector", async () => {
      await page.setContent("<html><body></body></html>");
      
      // Add element after delay
      setTimeout(() => {
        page.evaluate(() => {
          const div = document.createElement("div");
          div.id = "delayed-element";
          document.body.appendChild(div);
        });
      }, 100);
      
      const element = await page.waitForSelector("#delayed-element", { timeout: 1000 });
      expect(element).toBeDefined();
    });

    test("should wait for timeout", async () => {
      const start = Date.now();
      await page.waitForTimeout(100);
      const end = Date.now();
      expect(end - start).toBeGreaterThanOrEqual(100);
    });

    test("should wait for function", async () => {
      await page.setContent("<html><body><div id='counter'>0</div></body></html>");
      
      // Start a counter
      page.evaluate(() => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          document.getElementById("counter").textContent = count.toString();
          if (count >= 5) clearInterval(interval);
        }, 50);
      });
      
      const result = await page.waitForFunction(() => {
        return parseInt(document.getElementById("counter").textContent) >= 5;
      }, { timeout: 1000 });
      
      expect(result).toBeDefined();
    });
  });

  describe("Viewport and device emulation", () => {
    test("should set viewport", async () => {
      await page.setViewport({ width: 1024, height: 768 });
      const viewport = page.viewport();
      expect(viewport.width).toBe(1024);
      expect(viewport.height).toBe(768);
    });

    test("should emulate device", async () => {
      await page.emulate({
        viewport: { width: 375, height: 667, isMobile: true, hasTouch: true },
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
      });
      
      const viewport = page.viewport();
      expect(viewport.isMobile).toBe(true);
      expect(viewport.hasTouch).toBe(true);
    });
  });

  describe("Screenshots", () => {
    test("should take screenshot", async () => {
      await page.goto("data:text/html,<html><body><h1>Screenshot Test</h1></body></html>");
      const screenshot = await page.screenshot({ type: "png" });
      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);
    });

    test("should take full page screenshot", async () => {
      await page.goto("data:text/html,<html><body style='height: 2000px;'><h1>Long Page</h1></body></html>");
      const screenshot = await page.screenshot({ fullPage: true });
      expect(screenshot).toBeInstanceOf(Buffer);
    });

    test("should take element screenshot", async () => {
      await page.setContent("<html><body><div id='test' style='width: 100px; height: 100px; background: red;'></div></body></html>");
      const element = await page.querySelector("#test");
      const screenshot = await element.screenshot();
      expect(screenshot).toBeInstanceOf(Buffer);
    });
  });

  describe("Cookies", () => {
    test("should set and get cookies", async () => {
      await page.goto("https://example.com");
      
      await page.setCookie([
        { name: "test-cookie", value: "test-value", domain: "example.com" }
      ]);
      
      const cookies = await page.cookies();
      const testCookie = cookies.find(c => c.name === "test-cookie");
      expect(testCookie).toBeDefined();
      expect(testCookie.value).toBe("test-value");
    });

    test("should delete cookies", async () => {
      await page.goto("https://example.com");
      
      await page.setCookie([
        { name: "delete-me", value: "will-be-deleted", domain: "example.com" }
      ]);
      
      await page.deleteCookie([{ name: "delete-me" }]);
      
      const cookies = await page.cookies();
      const deletedCookie = cookies.find(c => c.name === "delete-me");
      expect(deletedCookie).toBeUndefined();
    });
  });

  describe("Input devices", () => {
    test("should use keyboard", async () => {
      await page.setContent("<html><body><input id='test-input' /></body></html>");
      await page.focus("#test-input");
      
      await page.keyboard.type("Hello");
      await page.keyboard.press("Space");
      await page.keyboard.type("World");
      
      const value = await page.evaluate(() => document.getElementById("test-input").value);
      expect(value).toBe("Hello World");
    });

    test("should use mouse", async () => {
      await page.setContent(`
        <html><body>
          <button id='test-btn' style='position: absolute; top: 100px; left: 100px;'
                  onclick='this.textContent = "Clicked"'>Click me</button>
        </body></html>
      `);
      
      await page.mouse.click(100, 100);
      const text = await page.evaluate(() => document.getElementById("test-btn").textContent);
      expect(text).toBe("Clicked");
    });

    test("should use touchscreen", async () => {
      await page.setViewport({ width: 375, height: 667, hasTouch: true });
      await page.setContent(`
        <html><body>
          <div id='touch-area' style='width: 200px; height: 200px; background: blue;'
               ontouchstart='this.style.background = "red"'>Touch me</div>
        </body></html>
      `);
      
      await page.touchscreen.tap(100, 100);
      const color = await page.evaluate(() => 
        getComputedStyle(document.getElementById("touch-area")).backgroundColor
      );
      expect(color).toBe("red");
    });
  });

  describe("Page events", () => {
    test("should handle page events", async () => {
      let dialogMessage = "";
      
      page.on("dialog", (dialog) => {
        dialogMessage = dialog.message();
        dialog.accept();
      });
      
      await page.evaluate(() => alert("Test alert"));
      expect(dialogMessage).toBe("Test alert");
    });

    test("should handle console events", async () => {
      const logs: string[] = [];
      
      page.on("console", (msg) => {
        logs.push(msg.text());
      });
      
      await page.evaluate(() => console.log("Test message"));
      expect(logs).toContain("Test message");
    });
  });

  describe("Network interception", () => {
    test("should set extra HTTP headers", async () => {
      await page.setExtraHTTPHeaders({
        "X-Custom-Header": "test-value"
      });
      
      // This would require a server to verify the header was sent
      // For now, just verify the method doesn't throw
      expect(true).toBe(true);
    });

    test("should set user agent", async () => {
      const customUA = "Custom User Agent 1.0";
      await page.setUserAgent(customUA);
      
      const userAgent = await page.evaluate(() => navigator.userAgent);
      expect(userAgent).toBe(customUA);
    });
  });

  describe("Script and style injection", () => {
    test("should add script tag", async () => {
      await page.goto("data:text/html,<html><body></body></html>");
      
      await page.addScriptTag({
        content: "window.testValue = 'injected';"
      });
      
      const value = await page.evaluate(() => window.testValue);
      expect(value).toBe("injected");
    });

    test("should add style tag", async () => {
      await page.goto("data:text/html,<html><body><div id='test'>Test</div></body></html>");
      
      await page.addStyleTag({
        content: "#test { color: red; }"
      });
      
      const color = await page.evaluate(() => 
        getComputedStyle(document.getElementById("test")).color
      );
      expect(color).toBe("rgb(255, 0, 0)");
    });
  });
});

describe("Error handling", () => {
  test("should handle browser launch failure", async () => {
    try {
      await Bun.browser({ executablePath: "/nonexistent/chrome" });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error.message).toContain("Failed to launch Chrome");
    }
  });

  test("should handle closed page operations", async () => {
    const browser = await Bun.browser({ headless: true });
    const page = await browser.newPage();
    await page.close();
    
    try {
      await page.goto("https://example.com");
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error.message).toContain("Page is closed");
    }
    
    await browser.close();
  });

  test("should handle network timeouts", async () => {
    const browser = await Bun.browser({ headless: true });
    const page = await browser.newPage();
    
    try {
      await page.goto("https://httpbin.org/delay/10", { timeout: 1000 });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error.message).toContain("timeout");
    }
    
    await page.close();
    await browser.close();
  });
});