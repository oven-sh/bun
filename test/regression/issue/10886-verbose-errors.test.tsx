/**
 * @see https://github.com/oven-sh/bun/issues/10886
 * Test to reproduce verbose error output with testing-library and Happy DOM
 * 
 * This test demonstrates that DOM elements should show concise output in test failures,
 * not an overwhelming list of all DOM prototype methods and properties.
 */
import { expect, test } from "bun:test";

test("DOM element should have concise error output when expectation fails", () => {
  // Create a button element that is not disabled
  const button = document.createElement("button");
  button.textContent = "Click me";
  button.className = "btn btn-primary";
  button.setAttribute("data-testid", "submit-button");
  
  // This assertion will fail and should show concise error output
  // Before the fix: extremely verbose output with all DOM prototype methods
  // After the fix: clean output showing only relevant DOM properties
  try {
    expect(button).toHaveProperty("disabled", true);
  } catch (error) {
    // The error should be concise and not overwhelming
    const errorMessage = error.message;
    
    // Should not contain verbose DOM prototype methods
    expect(errorMessage).not.toContain("addEventListener");
    expect(errorMessage).not.toContain("removeEventListener");
    expect(errorMessage).not.toContain("getBoundingClientRect");
    expect(errorMessage).not.toContain("scrollIntoView");
    
    // Re-throw to see the actual output during manual testing
    throw error;
  }
});

test("complex DOM element should have readable error output", () => {
  // Create a complex DOM structure
  const div = document.createElement("div");
  div.className = "container";
  div.setAttribute("data-testid", "main-container");
  div.innerHTML = '<p class="text">Hello World</p><button>Click me</button>';
  
  // This will fail and show how complex DOM elements are formatted
  try {
    expect(div).toEqual({ someProperty: "someValue" });
  } catch (error) {
    const errorMessage = error.message;
    
    // Should focus on actual properties, not prototype noise
    expect(errorMessage).not.toContain("querySelector");
    expect(errorMessage).not.toContain("appendChild");
    expect(errorMessage).not.toContain("removeChild");
    
    throw error;
  }
});