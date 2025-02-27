// Regression test for issue #11367 (https://github.com/oven-sh/bun/issues/11367)
// This test verifies that toBeCloseTo assertions are properly counted
// in the expect() call counter.

import { describe, it, expect } from 'bun:test';
import { spawn } from 'child_process';

describe('toBeCloseTo assertion counter', () => {
  it('should correctly count toBeCloseTo assertions', async () => {
    // Create a test file that only uses toBeCloseTo assertions
    const testContent = `
      import { describe, it, expect } from 'bun:test';
      
      describe('Assertion counter test', () => {
        it('should count toBeCloseTo assertions', () => {
          // This will fail if toBeCloseTo doesn't increment the counter
          expect.assertions(3);
          
          // Only use toBeCloseTo assertions
          expect(1.0001).toBeCloseTo(1, 3);
          expect(2.0001).toBeCloseTo(2, 3);
          expect(3.0001).toBeCloseTo(3, 3);
        });
      });
    `;
    
    // Write the test file
    await Bun.write('./tmp-toBeCloseTo-test.js', testContent);
    
    try {
      // Run the test with our debug build
      const result = await new Promise((resolve) => {
        let output = '';
        // Use the debug build which has the fix
        const proc = spawn('./build/debug/bun-debug', ['test', './tmp-toBeCloseTo-test.js']);
        
        proc.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
          output += data.toString();
        });
        
        proc.on('close', (code) => {
          resolve({
            code,
            output
          });
        });
      });
      
      // Check that our test passes with the fix
      expect(result.code).toBe(0);
      expect(result.output).toContain("3 expect() calls");
      expect(result.output).toContain("1 pass");
      expect(result.output).not.toContain("AssertionError");
    } finally {
      // Clean up test file
      Bun.spawnSync(['rm', './tmp-toBeCloseTo-test.js']);
    }
  });
});