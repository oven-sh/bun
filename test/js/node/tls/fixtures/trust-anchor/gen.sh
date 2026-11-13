#!/bin/bash
# Regenerates the certificates of this directory, in the current directory. Needs OpenSSL 3.
set -e
tmp=$(mktemp -d)
key() { openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "$1"; }
# sign <name> <key> <subject> <"self" or the name of the issuer> <extensions>
sign() {
  openssl req -new -key "$2" -subj "$3" -out "$tmp/csr"
  printf "$5" > "$tmp/ext"
  if [ "$4" = self ]; then signer=(-signkey "$2"); else signer=(-CA "$4.pem" -CAkey "$tmp/$4.key" -set_serial "0x$(openssl rand -hex 8)"); fi
  openssl x509 -req -in "$tmp/csr" "${signer[@]}" -extfile "$tmp/ext" -days 36500 -sha256 -out "$1.pem" 2> /dev/null
}
key "$tmp/root.key"
key "$tmp/intermediate.key"
key leaf.key
ca='basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n'
# Every root has the same name and key, so each of them issued the intermediate.
sign root "$tmp/root.key" /CN=trust-anchor-root self "$ca"
sign root-pathlen-0 "$tmp/root.key" /CN=trust-anchor-root self 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign\n'
sign root-client-eku "$tmp/root.key" /CN=trust-anchor-root self "${ca}extendedKeyUsage=clientAuth\n"
sign root-not-a-ca "$tmp/root.key" /CN=trust-anchor-root self 'basicConstraints=critical,CA:FALSE\n'
sign root-unknown-critical "$tmp/root.key" /CN=trust-anchor-root self "${ca}1.2.3.4=critical,ASN1:NULL\n"
sign root-key-usage-only "$tmp/root.key" /CN=trust-anchor-root self 'keyUsage=critical,keyCertSign\n'
sign intermediate "$tmp/intermediate.key" /CN=trust-anchor-intermediate root "${ca}authorityKeyIdentifier=keyid\n"
sign leaf leaf.key /CN=localhost intermediate 'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n'
sign self-signed-client-eku leaf.key /CN=localhost self 'extendedKeyUsage=clientAuth\nsubjectAltName=DNS:localhost\n'
# crl <name> <issuer> <extensions> [revoked certificate]
crl() {
  : > "$tmp/index.txt"
  printf "[ca]\ndefault_ca=d\n[d]\ndatabase=$tmp/index.txt\ndefault_md=sha256\ndefault_crl_days=36500\ncrl_extensions=e\n[e]\nauthorityKeyIdentifier=keyid\n$3" > "$tmp/cnf"
  signer=(-config "$tmp/cnf" -keyfile "$tmp/$2.key" -cert "$2.pem")
  if [ -n "$4" ]; then openssl ca "${signer[@]}" -revoke "$4.pem" 2> /dev/null; fi
  openssl ca "${signer[@]}" -gencrl -out "$1.crl" 2> /dev/null
}
crl root-empty root
crl root-revokes-intermediate root '' intermediate
crl intermediate-empty intermediate
crl intermediate-revokes-leaf intermediate '' leaf
# Newer than the one above, so that it wins if it is taken for a CRL of the same scope.
sleep 2
crl intermediate-attribute-certificates intermediate 'issuingDistributionPoint=critical,@idp\n[idp]\nonlyAA=TRUE\n'
rm -r "$tmp"
