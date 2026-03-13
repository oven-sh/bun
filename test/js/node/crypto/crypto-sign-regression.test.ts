import { expect, test } from "bun:test";
import { constants, sign } from "crypto";

const DUMMY_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIICeAIBADANBgkqhkiG9w0BAQEFAASCAmIwggJeAgEAAoGBAMx5bEJhDzwNBG1m
mIYn/V1HMK9g8WTVaHym4F4iPcTdZ4RYUrMa/xOUwPMAfrOJdf3joSUFWBx3ZPdW
hrvpqjmcmgoYDRJzZwVKJ1uqTko6Anm3gplWl6JP3nGOL9Vt5K5xAJWif5fHPfCx
LA2p/SnJDNmcyOWURUCRVCDlZgJRAgMBAAECgYEAt8a+ZZ7EyY1NmGJo3dMdZnPw
rwArlhw08CwwZorSB5mTS6Dym2W9MsU08nNUbVs0AIBRumtmOReaWK+dI1GtmsT+
/5YOrE8aU9xcTgMzZjr9AjI9cSc5J9etqqTjUplKfC5Ay0WBhPlx66MPAcTsq/u/
IdPYvhvgXuJm6X3oDP0CQQDllIopSYXW+EzfpsdTsY1dW+xKM90NA7hUFLbIExwc
vL9dowJcNvPNtOOA8Zrt0guVz0jZU/wPYZhvAm2/ab93AkEA5AFCfcAXrfC2lnDe
9G5x/DGaB5jAsQXi9xv+/QECyAN3wzSlQNAZO8MaNr2IUpKuqMfxl0sPJSsGjOMY
e8aOdwJBAIM7U3aiVmU5bgfyN8J5ncsd/oWz+8mytK0rYgggFFPA+Mq3oWPA7cBK
hDly4hLLnF+4K3Y/cbgBG7do9f8SnaUCQQCLvfXpqp0Yv4q4487SUwrLff8gns+i
76+uslry5/azbeSuIIsUETcV+LsNR9bQfRRNX9ZDWv6aUid+nAU6f3R7AkAFoONM
mr4hjSGiU1o91Duatf4tny1Hp/hw2VoZAb5zxAlMtMifDg4Aqg4XFgptST7IUzTN
K3P7zdJ30gregvjI
-----END PRIVATE KEY-----`;

test("crypto.sign() supports all RSA digest variants", () => {
  const message = Buffer.from("test message");

  const digests = [
    "rsa-sha1",
    "RSA-SHA1",
    "rsa-sha224",
    "RSA-SHA224",
    "rsa-sha256",
    "RSA-SHA256",
    "rsa-sha384",
    "RSA-SHA384",
    "rsa-sha512",
    "RSA-SHA512",
  ];

  for (const digest of digests) {
    const signature = sign(digest, message, {
      key: DUMMY_PRIVATE_KEY,
      padding: constants.RSA_PKCS1_PSS_PADDING,
    });
    expect(signature).toBeInstanceOf(Buffer);
    expect(signature.length).toBeGreaterThan(0);
  }
});
