const bytes = crypto.getRandomValues(new Uint8Array(8));
console.log(
  bytes.length,
  crypto.randomUUID().length,
  typeof crypto.subtle,
  crypto instanceof Crypto,
  (crypto as any).timingSafeEqual(new Uint8Array([1]), new Uint8Array([1])),
);
