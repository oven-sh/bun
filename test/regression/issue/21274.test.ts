import { X509Certificate } from "node:crypto";

test("#21274", () => {
  const base64cert =
    "MIID8DCCAtigAwIBAgIQUi5nD9Oz+6wOGTN+ITe0kzANBgkqhkiG9w0BAQsFADA7MQswCQYDVQQGEwJVUzEeMBwGA1UEChMVR29vZ2xlIFRydXN0IFNlcnZpY2VzMQwwCgYDVQQDEwNXUjEwHhcNMjQxMTIwMDcyNDQ2WhcNMjUwMjE4MDcyNDQ1WjAAMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAENPs5SP+Q0bi1xZzO6yOZSRcLRcuf8wzSI2CAj84L678Lpxg5jw2Ausf9a1JOSNGvu2XuLOqnD9HQetMN4T8OPF9iA4bjh2L6BXxrUz2qYus26mUgRlWJDFBra0YZyuPTo4IB1zCCAdMwDgYDVR0PAQH/BAQDAgeAMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjAMBgNVHRMBAf8EAjAAMB0GA1UdDgQWBBRRGVrJqojOa5ijQyjlA9zvGUBQgDAfBgNVHSMEGDAWgBRmaUnU3iqckQPPiQ4kuA4wA26ILjBeBggrBgEFBQcBAQRSMFAwJwYIKwYBBQUHMAGGG2h0dHA6Ly9vLnBraS5nb29nL3Mvd3IxL1VpNDAlBggrBgEFBQcwAoYZaHR0cDovL2kucGtpLmdvb2cvd3IxLmNydDCBkQYDVR0RAQH/BIGGMIGDgoGAKi5saWZlY3ljbGUtcHJvYmVyLXByb2QtODkzMDhlNGUtOTkyNy00MjgwLTllMTQtMzMzMGY2OTAwMzk2LmFzaWEtbm9ydGhlYXN0MS5tYW5hZ2Vka2Fma2EuZ21rLWxpZmVjeWNsZS1wcm9iZXItcHJvZC0xLmNsb3VkLmdvb2cwEwYDVR0gBAwwCjAIBgZngQwBAgEwNgYDVR0fBC8wLTAroCmgJ4YlaHR0cDovL2MucGtpLmdvb2cvd3IxL1RqYnUyODV1bUkwLmNybDATBgorBgEEAdZ5AgQDAQH/BAIFADANBgkqhkiG9w0BAQsFAAOCAQEAZx5ErAK/wzvI5/4bAehfj2IufpM0bo7oUbOb8eVaRilZcKQFTIE+EIuk27IeFok2kt24y4W15FL/76TAFQIbwfMZQ00EUqrTqna+zxR5M+QH7Zh6Ka9ArBtgA66CH3dHtOoYfB8OPfPoZUecCeH5pt2fTcOWIosv1Cy3dCwX0T5IaszLafj44qsA6OeXwtlemK8MAOXO0m0CcfQRHH3QcW1dGRUqkdHUiYP+vK18hA2IsNcA6G05ziU6sf52qEYMpfdd5ZQB+GsWrM1S8p3TGKgloj5zZTg4tWAh5nHs2pWCY4Etd1CX6SdLGT9r08XF6DOAecyOy7yjKHBTuFtNPQ==";
  const buff = Buffer.from(base64cert, "base64");
  const cert = new X509Certificate(buff);

  expect(cert.subject).toBeUndefined();
  expect(cert.subjectAltName).toEqual(
    "DNS:*.lifecycle-prober-prod-89308e4e-9927-4280-9e14-3330f6900396.asia-northeast1.managedkafka.gmk-lifecycle-prober-prod-1.cloud.goog",
  );
  expect(cert.issuer).toEqual("C=US\nO=Google Trust Services\nCN=WR1");
  expect(cert.infoAccess).toEqual(
    "OCSP - URI:http://o.pki.goog/s/wr1/Ui4\nCA Issuers - URI:http://i.pki.goog/wr1.crt\n",
  );
  expect(cert.validFrom).toEqual("Nov 20 07:24:46 2024 GMT");
  expect(cert.validTo).toEqual("Feb 18 07:24:45 2025 GMT");
  expect(cert.validFromDate).toEqual(new Date("2024-11-20T07:24:46.000Z"));
  expect(cert.validToDate).toEqual(new Date("2025-02-18T07:24:45.000Z"));
  expect(cert.fingerprint).toEqual("32:61:99:38:7E:FB:CF:07:35:38:B7:3F:99:0C:3A:90:A4:1D:8A:09");
  expect(cert.fingerprint256).toEqual(
    "C1:22:19:60:AF:DC:88:3E:39:A8:93:4A:A0:F6:D9:C2:5D:F7:61:94:8E:D7:69:06:34:74:22:48:77:ED:2B:C0",
  );
  expect(cert.fingerprint512).toEqual(
    "21:63:68:1D:1D:C8:1D:94:9A:B4:F7:E6:B6:CD:D1:1B:C5:46:2B:12:C9:DC:C3:BD:DF:F2:74:16:E8:DB:D7:82:16:9F:DF:D8:36:B7:AB:91:AF:EF:D4:D2:08:BD:09:88:FF:3A:52:D7:99:A9:D6:17:CD:FB:B9:F2:B8:0E:FD:CC",
  );
  expect(cert.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1", "1.3.6.1.5.5.7.3.2"]);
  expect(cert.serialNumber).toEqual("522e670fd3b3fbac0e19337e2137b493");
});
