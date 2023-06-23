// import { expect, test } from "bun:test";
// import * as dns from "node:dns";

// // TODO:
// test("it exists", () => {
//   expect(dns).toBeDefined();
//   expect(dns.lookup).toBeDefined();
//   expect(dns.lookupService).toBeDefined();
//   expect(dns.resolve).toBeDefined();
//   expect(dns.resolve4).toBeDefined();
//   expect(dns.resolve6).toBeDefined();
//   expect(dns.resolveSrv).toBeDefined();
//   expect(dns.resolveTxt).toBeDefined();
//   expect(dns.resolveSoa).toBeDefined();
//   expect(dns.resolveNaptr).toBeDefined();
//   expect(dns.resolveMx).toBeDefined();
//   expect(dns.resolveCaa).toBeDefined();
//   expect(dns.resolveNs).toBeDefined();
//   expect(dns.resolvePtr).toBeDefined();
//   expect(dns.resolveCname).toBeDefined();
// });

// // //TODO: use a bun.sh SRV for testing
// test("dns.resolveSrv (_test._tcp.test.socketify.dev)", done => {
//   dns.resolveSrv("_test._tcp.test.socketify.dev", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     expect(results[0].name).toBe("_dc-srv.130c90ab9de1._test._tcp.test.socketify.dev");
//     expect(results[0].priority).toBe(50);
//     expect(results[0].weight).toBe(50);
//     expect(results[0].port).toBe(80);
//     done(err);
//   });
// });

// test("dns.resolveSrv (_test._tcp.invalid.localhost)", done => {
//   dns.resolveSrv("_test._tcp.invalid.localhost", (err, results) => {
//     expect(err).toBeTruthy();
//     expect(results).toBeUndefined(true);
//     done();
//   });
// });

// test("dns.resolveTxt (txt.socketify.dev)", done => {
//   dns.resolveTxt("txt.socketify.dev", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     expect(results[0][0]).toBe("bun_test;test");
//     done(err);
//   });
// });

// test("dns.resolveSoa (bun.sh)", done => {
//   dns.resolveSoa("bun.sh", (err, result) => {
//     expect(err).toBeNull();
//     expect(typeof result.serial).toBe("number");
//     expect(result.refresh).toBe(10000);
//     expect(result.retry).toBe(2400);
//     expect(result.expire).toBe(604800);

//     // Cloudflare might randomly change min TTL
//     expect(result.minttl).toBeNumber();

//     expect(result.nsname).toBe("hans.ns.cloudflare.com");
//     expect(result.hostmaster).toBe("dns.cloudflare.com");
//     done(err);
//   });
// });

// test("dns.resolveNaptr (naptr.socketify.dev)", done => {
//   dns.resolveNaptr("naptr.socketify.dev", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     expect(results[0].flags).toBe("S");
//     expect(results[0].service).toBe("test");
//     expect(results[0].regexp).toBe("");
//     expect(results[0].replacement).toBe("");
//     expect(results[0].order).toBe(1);
//     expect(results[0].preference).toBe(12);
//     done(err);
//   });
// });

// test("dns.resolveCaa (caa.socketify.dev)", done => {
//   dns.resolveCaa("caa.socketify.dev", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     expect(results[0].critical).toBe(0);
//     expect(results[0].issue).toBe("bun.sh");
//     done(err);
//   });
// });

// test("dns.resolveMx (bun.sh)", done => {
//   dns.resolveMx("bun.sh", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     const priority = results[0].priority;
//     expect(priority >= 0 && priority < 65535).toBe(true);
//     expect(results[0].exchange.includes(".registrar-servers.com")).toBe(true);
//     done(err);
//   });
// });

// test("dns.resolveNs (bun.sh) ", done => {
//   dns.resolveNs("bun.sh", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     expect(results[0].includes(".ns.cloudflare.com")).toBe(true);
//     done(err);
//   });
// });

// test("dns.resolvePtr (ptr.socketify.dev)", done => {
//   dns.resolvePtr("ptr.socketify.dev", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     expect(results[0]).toBe("bun.sh");
//     done(err);
//   });
// });

// test("dns.resolveCname (cname.socketify.dev)", done => {
//   dns.resolveCname("cname.socketify.dev", (err, results) => {
//     expect(err).toBeNull();
//     expect(results instanceof Array).toBe(true);
//     expect(results[0]).toBe("bun.sh");
//     done(err);
//   });
// });

// test("dns.lookup (example.com)", done => {
//   dns.lookup("example.com", (err, address, family) => {
//     expect(err).toBeNull();
//     expect(typeof address).toBe("string");
//     done(err);
//   });
// });

// test("dns.lookup (example.com) with { all: true } #2675", done => {
//   dns.lookup("example.com", { all: true }, (err, address, family) => {
//     expect(err).toBeNull();
//     expect(Array.isArray(address)).toBe(true);
//     done(err);
//   });
// });

// test("dns.lookup (localhost)", done => {
//   dns.lookup("localhost", (err, address, family) => {
//     expect(err).toBeNull();
//     if (family === 6) {
//       expect(address).toBe("::1");
//     } else {
//       expect(address).toBe("127.0.0.1");
//     }

//     done(err);
//   });
// });
