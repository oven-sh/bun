#!/bin/bash
# Regenerates the certificates of this directory, in the current directory. Needs OpenSSL 3.
set -e
tmp=$(mktemp -d)
key() { openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "$1-key.pem"; }
leaf() { printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=%s\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n' "$1"; }
ca() { printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n'; }
# sign <name> <subject> <"self" or the name of the issuer> <extensions>
sign() {
  openssl req -new -key "$1-key.pem" -subj "$2" -out "$tmp/csr"
  echo "$4" > "$tmp/ext"
  if [ "$3" = self ]; then signer=(-signkey "$1-key.pem"); else signer=(-CA "$3-cert.pem" -CAkey "$3-key.pem" -set_serial "0x$(openssl rand -hex 8)"); fi
  openssl x509 -req -in "$tmp/csr" "${signer[@]}" -extfile "$tmp/ext" -days 36500 -sha256 -out "$1-cert.pem" 2> /dev/null
}
for name in dev other-key client-eku expired root intermediate issued-by-intermediate issued-by-dev; do key $name; done
sign dev /CN=localhost self "$(leaf serverAuth,clientAuth)"
sign other-key /CN=localhost self "$(leaf serverAuth,clientAuth)"
sign client-eku /CN=localhost self "$(leaf clientAuth)"
sign root /CN=pinned-leaf-root self "$(ca)"
sign intermediate /CN=localhost root "$(ca)"
sign issued-by-intermediate /CN=localhost intermediate "$(leaf serverAuth)"
sign issued-by-dev /CN=localhost dev "$(leaf serverAuth)"
# `openssl x509 -req` cannot backdate before OpenSSL 3.4. `openssl ca` can.
: > "$tmp/index.txt"
echo 01 > "$tmp/serial"
leaf serverAuth,clientAuth > "$tmp/ext"
printf '[ca]\ndefault_ca=d\n[d]\ndatabase=%s/index.txt\nserial=%s/serial\nnew_certs_dir=%s\ndefault_md=sha256\npolicy=p\n[p]\ncommonName=supplied\n' "$tmp" "$tmp" "$tmp" > "$tmp/cnf"
openssl req -new -key expired-key.pem -subj /CN=localhost -out "$tmp/csr"
openssl ca -batch -config "$tmp/cnf" -selfsign -keyfile expired-key.pem -in "$tmp/csr" -extfile "$tmp/ext" \
  -startdate 20200101000000Z -enddate 20200102000000Z -notext -out expired-cert.pem 2> /dev/null
