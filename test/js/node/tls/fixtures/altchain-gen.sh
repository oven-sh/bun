#!/usr/bin/env bash
# Regenerates the altchain-* fixtures used by the "expired duplicate issuer"
# tests in node-tls-cert.test.ts and fetch-tls-cert.test.ts.
#
#   altchain-root-cert.pem         trust anchor (valid until ~2053)
#   altchain-int-valid-cert.pem    CN=altchain Intermediate CA, key K, valid
#   altchain-int-expired-cert.pem  same subject and key K, expired in 2024
#   altchain-leaf-cert.pem         CN=localhost leaf issued by K
#   altchain-leaf-key.pem          leaf private key (used by test servers)
#
# The two intermediate certificates are deliberately issued from the same CSR
# (same subject, same public key) with different serials and validity windows:
# that is the "reissued intermediate" shape that RFC 8446 section 4.4.2 tells
# clients to tolerate. Requires OpenSSL >= 3.4 for -not_before/-not_after.
set -euo pipefail
cd "$(dirname "$0")"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

openssl ecparam -genkey -name prime256v1 -out "$tmp/root-key.pem"
openssl req -x509 -new -key "$tmp/root-key.pem" -out altchain-root-cert.pem -days 9999 \
  -subj "/CN=altchain Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

openssl ecparam -genkey -name prime256v1 -out "$tmp/int-key.pem"
openssl req -new -key "$tmp/int-key.pem" -subj "/CN=altchain Intermediate CA" -out "$tmp/int.csr"
cat > "$tmp/int.ext" <<EOF
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EOF
openssl x509 -req -in "$tmp/int.csr" -CA altchain-root-cert.pem -CAkey "$tmp/root-key.pem" \
  -out altchain-int-valid-cert.pem -days 9999 -set_serial 4097 -extfile "$tmp/int.ext"
openssl x509 -req -in "$tmp/int.csr" -CA altchain-root-cert.pem -CAkey "$tmp/root-key.pem" \
  -out altchain-int-expired-cert.pem -not_before 20230101000000Z -not_after 20240101000000Z \
  -set_serial 4098 -extfile "$tmp/int.ext"

openssl ecparam -genkey -name prime256v1 -out altchain-leaf-key.pem
openssl req -new -key altchain-leaf-key.pem -subj "/CN=localhost" -out "$tmp/leaf.csr"
cat > "$tmp/leaf.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
subjectAltName=DNS:localhost,IP:127.0.0.1
EOF
openssl x509 -req -in "$tmp/leaf.csr" -CA altchain-int-valid-cert.pem -CAkey "$tmp/int-key.pem" \
  -out altchain-leaf-cert.pem -days 9999 -set_serial 8193 -extfile "$tmp/leaf.ext"

openssl verify -CAfile altchain-root-cert.pem -untrusted altchain-int-valid-cert.pem altchain-leaf-cert.pem
