/*
 * @see `test/parallel/test-crypto-x509.js` in Node's codebase
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { X509Certificate } from "crypto";
import path from "path";

const fixturePath = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", "x509", ...segs);
const fixture = (...segs: string[]) => Bun.file(fixturePath(...segs));

let cert: string, key: string, ca: string;
const der = Buffer.from(
  "308203e8308202d0a0030201020214147d36c1c2f74206de9fab5f2226d78adb00a42630" +
    "0d06092a864886f70d01010b0500307a310b3009060355040613025553310b3009060355" +
    "04080c024341310b300906035504070c025346310f300d060355040a0c064a6f79656e74" +
    "3110300e060355040b0c074e6f64652e6a73310c300a06035504030c036361313120301e" +
    "06092a864886f70d010901161172794074696e79636c6f7564732e6f72673020170d3232" +
    "303930333231343033375a180f32323936303631373231343033375a307d310b30090603" +
    "55040613025553310b300906035504080c024341310b300906035504070c025346310f30" +
    "0d060355040a0c064a6f79656e743110300e060355040b0c074e6f64652e6a73310f300d" +
    "06035504030c066167656e74313120301e06092a864886f70d010901161172794074696e" +
    "79636c6f7564732e6f726730820122300d06092a864886f70d01010105000382010f0030" +
    "82010a0282010100d456320afb20d3827093dc2c4284ed04dfbabd56e1ddae529e28b790" +
    "cd4256db273349f3735ffd337c7a6363ecca5a27b7f73dc7089a96c6d886db0c62388f1c" +
    "dd6a963afcd599d5800e587a11f908960f84ed50ba25a28303ecda6e684fbe7baedc9ce8" +
    "801327b1697af25097cee3f175e400984c0db6a8eb87be03b4cf94774ba56fffc8c63c68" +
    "d6adeb60abbe69a7b14ab6a6b9e7baa89b5adab8eb07897c07f6d4fa3d660dff574107d2" +
    "8e8f63467a788624c574197693e959cea1362ffae1bba10c8c0d88840abfef103631b2e8" +
    "f5c39b5548a7ea57e8a39f89291813f45a76c448033a2b7ed8403f4baa147cf35e2d2554" +
    "aa65ce49695797095bf4dc6b0203010001a361305f305d06082b06010505070101045130" +
    "4f302306082b060105050730018617687474703a2f2f6f6373702e6e6f64656a732e6f72" +
    "672f302806082b06010505073002861c687474703a2f2f63612e6e6f64656a732e6f7267" +
    "2f63612e63657274300d06092a864886f70d01010b05000382010100c3349810632ccb7d" +
    "a585de3ed51e34ed154f0f7215608cf2701c00eda444dc2427072c8aca4da6472c1d9e68" +
    "f177f99a90a8b5dbf3884586d61cb1c14ea7016c8d38b70d1b46b42947db30edc1e9961e" +
    "d46c0f0e35da427bfbe52900771817e733b371adf19e12137235141a34347db0dfc05579" +
    "8b1f269f3bdf5e30ce35d1339d56bb3c570de9096215433047f87ca42447b44e7e6b5d0e" +
    "48f7894ab186f85b6b1a74561b520952fea888617f32f582afce1111581cd63efcc68986" +
    "00d248bb684dedb9c3d6710c38de9e9bc21f9c3394b729d5f707d64ea890603e5989f8fa" +
    "59c19ad1a00732e7adc851b89487cc00799dde068aa64b3b8fd976e8bc113ef2",
  "hex",
);

beforeAll(async () => {
  [cert, key, ca] = await Promise.all([
    fixture("agent1-cert.pem").text(),
    fixture("agent1-key.pem").text(),
    fixture("ca1-cert.pem").text(),
  ]);
});

describe("Given agent1-cert.pem", () => {
  let x509: X509Certificate;

  beforeAll(() => {
    x509 = new X509Certificate(cert);
  });

  it("When constructed, creates a new X509Certificate instance", () => {
    expect(x509).toBeInstanceOf(X509Certificate);
  });

  it("is not for a certificate authority", () => {
    expect(x509.ca).toBe(false);
  });
  it("is issued by Ryan Dahl ca1", () => {
    const expectedIssuer = `C=US
ST=CA
L=SF
O=Joyent
OU=Node.js
CN=ca1
emailAddress=ry@tinyclouds.org`;
    expect(x509.issuer).toBe(expectedIssuer);
  });

  it("Is issued to Ryan Dahl agent1", () => {
    const expectedSubject = `C=US
ST=CA
L=SF
O=Joyent
OU=Node.js
CN=agent1
emailAddress=ry@tinyclouds.org`;
    expect(x509.subject).toBe(expectedSubject);
  });
});
