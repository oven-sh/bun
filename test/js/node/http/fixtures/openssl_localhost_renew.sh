#!/usr/bin/env bash
# Regenerates the openssl_localhost fixture set:
#   openssl_localhost_ca.pem  CA certificate (self-signed, key discarded)
#   openssl_localhost.crt     leaf for localhost, signed by the CA
#   openssl_localhost.key     leaf key, PKCS#8, encrypted with passphrase 123123123
# Used by test/js/bun/test/parallel/test-http-should-accept-custom-certs-when-provided.ts
# and test/js/bun/test/parallel/test-http-should-error-with-faulty-args.ts.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

subj="/C=US/ST=CA/L=San Francisco/O=Oven/OU=Team Bun"
days=99999
passphrase=123123123

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

openssl req -x509 -new -newkey rsa:2048 -nodes -sha256 -days "$days" \
  -subj "$subj/CN=Bun test CA" \
  -addext "basicConstraints = critical, CA:TRUE" \
  -addext "keyUsage = critical, keyCertSign, cRLSign" \
  -keyout "$tmp/ca.key" -out openssl_localhost_ca.pem

openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -subj "$subj/CN=localhost" \
  -keyout "$tmp/leaf.key" -out "$tmp/leaf.csr"

printf '%s\n' \
  "basicConstraints = CA:FALSE" \
  "keyUsage = critical, digitalSignature, keyEncipherment" \
  "extendedKeyUsage = serverAuth" \
  "subjectKeyIdentifier = hash" \
  "authorityKeyIdentifier = keyid, issuer" \
  "subjectAltName = DNS:localhost, IP:127.0.0.1, IP:::1" \
  > "$tmp/leaf.ext"

openssl x509 -req -in "$tmp/leaf.csr" -sha256 -days "$days" \
  -CA openssl_localhost_ca.pem -CAkey "$tmp/ca.key" \
  -CAserial "$tmp/ca.srl" -CAcreateserial \
  -extfile "$tmp/leaf.ext" \
  -out openssl_localhost.crt

openssl pkcs8 -topk8 -in "$tmp/leaf.key" -passout "pass:$passphrase" -out openssl_localhost.key

openssl verify -CAfile openssl_localhost_ca.pem openssl_localhost.crt
openssl x509 -in openssl_localhost.crt -noout -subject -dates -ext subjectAltName
