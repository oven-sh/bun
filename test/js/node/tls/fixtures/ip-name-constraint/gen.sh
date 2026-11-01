#!/bin/bash
# Regenerates the certificates of this directory, in the current directory. Needs OpenSSL 3.
#
# Two CAs with an iPAddress nameConstraints extension (RFC 5280, section 4.2.1.10):
#   root-cert.pem          permits only 127.0.0.1, ::1 and DNS:localhost. This is the shape a local development CA
#                          takes when it follows RFC 5280 best practice (the Obsidian Local REST API plugin is one).
#   root-excluded-cert.pem excludes 127.0.0.0/8.
# Leaves, all with leaf-key.pem:
#   leaf-cert.pem          issued by root, SAN DNS:localhost, IP:127.0.0.1, IP:::1 (inside the permitted subtrees)
#   leaf-other-ip-cert.pem issued by root, SAN IP:127.0.0.1, IP:10.0.0.1 (10.0.0.1 is outside the permitted subtrees)
#   leaf-excluded-cert.pem issued by root-excluded, SAN IP:127.0.0.1 (inside the excluded subtree)
set -e
tmp=$(mktemp -d)
key() { openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "$1-key.pem"; }
leaf() { printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$1"; }
ca() { printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nnameConstraints=critical,%s\n' "$1"; }
# sign <name> <subject> <"self" or the name of the issuer> <extensions> [key name]
sign() {
  local key=${5:-$1}
  openssl req -new -key "$key-key.pem" -subj "$2" -out "$tmp/csr"
  echo "$4" > "$tmp/ext"
  if [ "$3" = self ]; then signer=(-signkey "$key-key.pem"); else signer=(-CA "$3-cert.pem" -CAkey "$3-key.pem" -set_serial "0x$(openssl rand -hex 8)"); fi
  openssl x509 -req -in "$tmp/csr" "${signer[@]}" -extfile "$tmp/ext" -days 36500 -sha256 -out "$1-cert.pem" 2> /dev/null
}
key root
key root-excluded
key leaf
sign root /CN=ip-name-constraint-root self "$(ca 'permitted;IP:127.0.0.1/255.255.255.255,permitted;IP:::1/ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff,permitted;DNS:localhost')"
sign root-excluded /CN=ip-name-constraint-root-excluded self "$(ca 'excluded;IP:127.0.0.0/255.0.0.0')"
sign leaf /CN=localhost root "$(leaf 'DNS:localhost,IP:127.0.0.1,IP:::1')"
sign leaf-other-ip /CN=other root "$(leaf 'IP:127.0.0.1,IP:10.0.0.1')" leaf
sign leaf-excluded /CN=excluded root-excluded "$(leaf 'IP:127.0.0.1')" leaf
rm -r "$tmp"
