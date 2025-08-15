import { test, expect } from "bun:test";

test("SOCKS proxy protocol support - issue #7382", async () => {
  // Test that SOCKS URLs are now accepted by fetch
  try {
    const response = await fetch('http://httpbin.org/ip', {
      proxy: 'socks5://localhost:9050', // Non-existent SOCKS proxy
    });
    
    // If we get here, the protocol was accepted
    console.log('SOCKS protocol accepted by fetch');
    
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Error code:', error.code);
    
    // The key test: we should NOT get UnsupportedProxyProtocol anymore
    expect(error.code).not.toBe('UnsupportedProxyProtocol');
    expect(error.message).not.toContain('UnsupportedProxyProtocol');
    
    // We should get a connection error instead
    expect(error.code).toBe('ConnectionRefused');
  }
});