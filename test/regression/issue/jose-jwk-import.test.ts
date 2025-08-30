import { test, expect } from "bun:test";

test("RSA JWK import should work with valid private key", async () => {
  // This is a test key, not for production use
  const rsaJWK = {
    kty: "RSA",
    n: "xwQ72P9z9OYshiQ-ntDYaPnnfwG6u9JAdLMZ5o0dmjlcyrvwQRdoFIKPnO65Q8mh6F_LDSxjxa2Yzo_wdjhbPZLjfUJXgCzm54cClXzT5twzo7lzoAfaJlkTsoZc2HFWqmcri0BuzmTFLZx2Q7wYBm0pXHmQKF0V-C1O6NWfd4mfBhbM-I1tHYSpAMgarSm22WDMDx-WWI7TEzy2QhaBVaENW9BKaKkJklocAZCxk18WhR0fckIGiWiSionb3VD6dnT4ytjbS8_YjVgSjBPa4Bpel8OzDNQ4VcZ7CBnqKYy2oGnUTu2I0LNOXnVQH4g7IbKf5jJQmQvKx6u1hOjEvQ",
    e: "AQAB",
    d: "Tk7Gl7CZwC5wbO2_VfPeWN3vq1_xnCW4TU5G6JNnNqvIK8rvQgp8Ew8QSBpJnCQkOKPNgO3dJ6P9gPNQRfIK2M4gYUQ3C5oC5i2O78F4iQ5D5k8wHO6xM6Sx8HQgc7O6NKK5v5UOhw9YBz8RCPzqWl3VqJy5a6wlY4BPY8vZvlYQ3V3EvjOoMNEkxh4e8Y5tOlELQP7F4LcYKrSG6QvKhHxBF6LkYhHQtKZp9J9bqQP8mYpEF9hGG7zQKvQ1mHZRvZoHQwOgC3KjpBwJQ9G7lE4NjKFhFKjJN9fHUKPl4eOHoJGQcwC_jN8_VPQfFhVx-uQZKOmvXGhGVZwGYRjgbQohRQzAQ",
    p: "9lkMQBWF2rK5FnJTX7OYyDvSBLnNbQhf_1Rj7m8mLPYqO3F4KyF1Ol4QF_QOdkHl9YEBqHYHt2GKAVHvjQQwXRFYKLzO_OQWVBGdj9WGgTMGX8G8KGyOdQ7bYgjF6pqO9OkYghMKJR_pFTHHfHVv-WZKOGKJGTlG6Jh6vHlcj5k",
    q: "0KdOCyTyW2B7LHSy_2Qh3HmJ0Qh2GQXZ5tZ6VJg6vJK7CQo4K5HoN5vL5KfOlZRpbOqKOq1Hq3GJHHf-4vZZvJF6HQ2ZG8oQ_Fv4F7E4kKVH2fYJgKjKpJ2HBXCV_0OHHqjH3oqJlKqyH5lHCYhzKLRPGgOZQ6x4vQx6zGQ_xZ8",
    dp: "QHjHyKxmK3K5KYZ-EJ4vO2l_K6LKcP7Q2GmcTFYvz0Qn7lF-nGjVQhYzXRGJ5nJqGqY1CqHKKJG7KJq7O0qz8NwY5rOQYZHjOqzL4zY2R1CTLOH3q9hJfIJQPQOG2zKjBzYxwqTQVFBQGKKmJNP9x7zzJJFjK3JQ_-KKK0nP0rM",
    dq: "BGQGWmWmvJPQZZwQ2EH3Z1YhQGzOOJKtQP-H6O2vOqYQPPJGD5Y1CqGYhGmzQQCJ6HZJCZC4GQJ7F-z0NzJ5HGzHqzOJJ1OJ6pJ8wZ4ZG1J6JQzJ4KzJhKfGQPJGzOzZzKzGJ8GQYHzGGgHFHJNVQPVGQGGPVGHQ8ZG0zKgV4Q",
    qi: "u0FCMPOcqLjH3KJcYQcHYGYjP3kJGGjqcOKpJ6CZNNPpGGCJGPJHFJlJPKOK9PJGJKKmJPJGKKKLKMJJKKNwKJKJ7KKKKKKKNKKKKLKKKNMNKKKKKwMMKKKONNJKKMNJNNKKPKKKKLKKKKKJKKKKKJKKKKKJKKKKMKKKKNKKKKLKKKKKKKM"
  };

  // Should successfully import the RSA private key
  const importedKey = await crypto.subtle.importKey(
    'jwk',
    rsaJWK,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ['sign']
  );

  expect(importedKey.type).toBe('private');
  expect(importedKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5');
  expect(importedKey.algorithm.hash.name).toBe('SHA-256');
  expect(importedKey.usages).toEqual(['sign']);
  expect(importedKey.extractable).toBe(false);
});

test("RSA JWK import should work with public key", async () => {
  // Public key portion of the test key above
  const publicJWK = {
    kty: "RSA",
    n: "xwQ72P9z9OYshiQ-ntDYaPnnfwG6u9JAdLMZ5o0dmjlcyrvwQRdoFIKPnO65Q8mh6F_LDSxjxa2Yzo_wdjhbPZLjfUJXgCzm54cClXzT5twzo7lzoAfaJlkTsoZc2HFWqmcri0BuzmTFLZx2Q7wYBm0pXHmQKF0V-C1O6NWfd4mfBhbM-I1tHYSpAMgarSm22WDMDx-WWI7TEzy2QhaBVaENW9BKaKkJklocAZCxk18WhR0fckIGiWiSionb3VD6dnT4ytjbS8_YjVgSjBPa4Bpel8OzDNQ4VcZ7CBnqKYy2oGnUTu2I0LNOXnVQH4g7IbKf5jJQmQvKx6u1hOjEvQ",
    e: "AQAB"
  };

  const importedKey = await crypto.subtle.importKey(
    'jwk',
    publicJWK,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ['verify']
  );

  expect(importedKey.type).toBe('public');
  expect(importedKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5');
  expect(importedKey.usages).toEqual(['verify']);
});

test("RSA JWK import should work with minimal private key (no CRT params)", async () => {
  // Generate a key pair and test minimal private key format
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );

  const privateJWK = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  
  // Create a minimal private key JWK (without CRT parameters)
  const minimalPrivateJWK = {
    kty: privateJWK.kty,
    n: privateJWK.n,
    e: privateJWK.e,
    d: privateJWK.d
    // Omitting p, q, dp, dq, qi
  };

  const importedKey = await crypto.subtle.importKey(
    'jwk',
    minimalPrivateJWK,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ['sign']
  );

  expect(importedKey.type).toBe('private');
  expect(importedKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5');
});

test("Jose library should work with RSA JWK import after fix", async () => {
  // This test requires the Jose library to be available
  // It should pass after the JWK import fix
  const { importJWK } = await import('jose');

  const rsaJWK = {
    kty: "RSA",
    n: "xwQ72P9z9OYshiQ-ntDYaPnnfwG6u9JAdLMZ5o0dmjlcyrvwQRdoFIKPnO65Q8mh6F_LDSxjxa2Yzo_wdjhbPZLjfUJXgCzm54cClXzT5twzo7lzoAfaJlkTsoZc2HFWqmcri0BuzmTFLZx2Q7wYBm0pXHmQKF0V-C1O6NWfd4mfBhbM-I1tHYSpAMgarSm22WDMDx-WWI7TEzy2QhaBVaENW9BKaKkJklocAZCxk18WhR0fckIGiWiSionb3VD6dnT4ytjbS8_YjVgSjBPa4Bpel8OzDNQ4VcZ7CBnqKYy2oGnUTu2I0LNOXnVQH4g7IbKf5jJQmQvKx6u1hOjEvQ",
    e: "AQAB",
    d: "Tk7Gl7CZwC5wbO2_VfPeWN3vq1_xnCW4TU5G6JNnNqvIK8rvQgp8Ew8QSBpJnCQkOKPNgO3dJ6P9gPNQRfIK2M4gYUQ3C5oC5i2O78F4iQ5D5k8wHO6xM6Sx8HQgc7O6NKK5v5UOhw9YBz8RCPzqWl3VqJy5a6wlY4BPY8vZvlYQ3V3EvjOoMNEkxh4e8Y5tOlELQP7F4LcYKrSG6QvKhHxBF6LkYhHQtKZp9J9bqQP8mYpEF9hGG7zQKvQ1mHZRvZoHQwOgC3KjpBwJQ9G7lE4NjKFhFKjJN9fHUKPl4eOHoJGQcwC_jN8_VPQfFhVx-uQZKOmvXGhGVZwGYRjgbQohRQzAQ",
    p: "9lkMQBWF2rK5FnJTX7OYyDvSBLnNbQhf_1Rj7m8mLPYqO3F4KyF1Ol4QF_QOdkHl9YEBqHYHt2GKAVHvjQQwXRFYKLzO_OQWVBGdj9WGgTMGX8G8KGyOdQ7bYgjF6pqO9OkYghMKJR_pFTHHfHVv-WZKOGKJGTlG6Jh6vHlcj5k",
    q: "0KdOCyTyW2B7LHSy_2Qh3HmJ0Qh2GQXZ5tZ6VJg6vJK7CQo4K5HoN5vL5KfOlZRpbOqKOq1Hq3GJHHf-4vZZvJF6HQ2ZG8oQ_Fv4F7E4kKVH2fYJgKjKpJ2HBXCV_0OHHqjH3oqJlKqyH5lHCYhzKLRPGgOZQ6x4vQx6zGQ_xZ8",
    dp: "QHjHyKxmK3K5KYZ-EJ4vO2l_K6LKcP7Q2GmcTFYvz0Qn7lF-nGjVQhYzXRGJ5nJqGqY1CqHKKJG7KJq7O0qz8NwY5rOQYZHjOqzL4zY2R1CTLOH3q9hJfIJQPQOG2zKjBzYxwqTQVFBQGKKmJNP9x7zzJJFjK3JQ_-KKK0nP0rM",
    dq: "BGQGWmWmvJPQZZwQ2EH3Z1YhQGzOOJKtQP-H6O2vOqYQPPJGD5Y1CqGYhGmzQQCJ6HZJCZC4GQJ7F-z0NzJ5HGzHqzOJJ1OJ6pJ8wZ4ZG1J6JQzJ4KzJhKfGQPJGzOzZzKzGJ8GQYHzGGgHFHJNVQPVGQGGPVGHQ8ZG0zKgV4Q",
    qi: "u0FCMPOcqLjH3KJcYQcHYGYjP3kJGGjqcOKpJ6CZNNPpGGCJGPJHFJlJPKOK9PJGJKKmJPJGKKKLKMJJKKNwKJKJ7KKKKKKKNKKKKLKKKNMNKKKKKwMMKKKONNJKKMNJNNKKPKKKKLKKKKKJKKKKKJKKKKKJKKKKMKKKKNKKKKLKKKKKKKM"
  };

  // This should not throw a DataError after the fix
  const importedKey = await importJWK(rsaJWK, 'RS256');
  expect(importedKey).toBeDefined();
});