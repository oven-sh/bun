import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir, tls } from "harness";

// The module _ssl, which is written against Bun's BoringSSL. How it compares with CPython's on OpenSSL is tested elsewhere;
// here is that it works, with the rest of Bun too.

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(90_000);

async function run(main: string, env: Record<string, string> = {}) {
  using dir = tempDir("python-ssl", { "main.py": main, "common.py": common, "cert.pem": tls.cert, "key.pem": tls.key });
  for (const name in env) env[name] = env[name].replace("<dir>", String(dir));
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const lines = (...all: string[]) => all.map(line => line + "\n").join("");
const printed = (...all: string[]) => ({ stdout: lines(...all), stderr: "", exitCode: 0 });

const common = `
import socket, ssl, threading

def contexts():
    client = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    client.load_verify_locations("cert.pem")
    server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server.load_cert_chain("cert.pem", "key.pem")
    return client, server

class Echo(threading.Thread):
    "Answers each connection in upper case until its end."
    def __init__(self, context, connections=1):
        super().__init__(daemon=True)
        self.context, self.connections = context, connections
        self.listener = socket.create_server(("127.0.0.1", 0))
        self.port = self.listener.getsockname()[1]
        self.errors = []
        self.start()
    def run(self):
        for _ in range(self.connections):
            raw, _ = self.listener.accept()
            try:
                with self.context.wrap_socket(raw, server_side=True) as conn:
                    while data := conn.recv(65536):
                        conn.sendall(data.upper())
            except OSError as e:
                self.errors.append(type(e).__name__)
        self.listener.close()
`;

// Sockets are not written for Windows yet.
test.skipIf(isWindows).concurrent("ssl says which library it has", async () => {
  expect(
    await run(`
import ssl
print(ssl.OPENSSL_VERSION, ssl.OPENSSL_VERSION_INFO >= (1, 1, 1))
print(ssl.HAS_TLSv1_3, ssl.HAS_ALPN, ssl.HAS_SNI, ssl.HAS_PSK, ssl.HAS_PSK_TLS13, ssl.HAS_PHA, ssl.HAS_SSLv3)
context = ssl.create_default_context()
print(context.minimum_version.name, context.verify_mode.name, context.check_hostname, context.security_level, context.post_handshake_auth)
for refused in (lambda: context.set_ciphersuites("TLS_AES_128_GCM_SHA256"), lambda: context.set_ciphers("@SECLEVEL=1:ALL")):
    try:
        refused()
    except (NotImplementedError, ssl.SSLError) as e:
        print(type(e).__name__)
`),
  ).toEqual(
    printed(
      "OpenSSL 1.1.1 (compatible; BoringSSL) True",
      "True True True True False False False",
      "TLSv1_2 CERT_REQUIRED True 0 None",
      "NotImplementedError",
      "SSLError",
    ),
  );
});

test.skipIf(isWindows).concurrent("the flags for what the library always does can be set and seen", async () => {
  expect(
    await run(`
import ssl
context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
print(context.verify_flags.name, int(ssl.VERIFY_X509_STRICT), int(ssl.VERIFY_X509_TRUSTED_FIRST))
context.verify_flags |= ssl.VERIFY_X509_STRICT | ssl.VERIFY_X509_PARTIAL_CHAIN
print(sorted(flag.name for flag in context.verify_flags))
context.verify_flags &= ~ssl.VERIFY_X509_STRICT
print(sorted(flag.name for flag in context.verify_flags))
print(sorted(flag.name for flag in ssl.create_default_context().verify_flags))
`),
  ).toEqual(
    printed(
      "VERIFY_X509_TRUSTED_FIRST 32 32768",
      "['VERIFY_X509_PARTIAL_CHAIN', 'VERIFY_X509_STRICT', 'VERIFY_X509_TRUSTED_FIRST']",
      "['VERIFY_X509_PARTIAL_CHAIN', 'VERIFY_X509_TRUSTED_FIRST']",
      "['VERIFY_X509_PARTIAL_CHAIN', 'VERIFY_X509_STRICT', 'VERIFY_X509_TRUSTED_FIRST']",
    ),
  );
});

test.skipIf(isWindows).concurrent("a client and a server in two threads", async () => {
  expect(
    await run(`
from common import *
client, server = contexts()
echo = Echo(server, 3)
with socket.create_connection(("127.0.0.1", echo.port)) as raw, client.wrap_socket(raw, server_hostname="localhost") as conn:
    print(conn.version(), conn.cipher()[1], conn.getpeercert()["subjectAltName"])
    conn.sendall(b"hello")
    print(conn.recv(100))
    big = bytes(range(256)) * 2048
    conn.sendall(big)
    got = bytearray()
    while len(got) < len(big):
        got += conn.recv(1 << 20)
    print(len(got), bytes(got) == big.upper())
for context, name in ((client, "example.com"), (ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT), "localhost")):
    try:
        with socket.create_connection(("127.0.0.1", echo.port)) as raw:
            context.wrap_socket(raw, server_hostname=name)
    except ssl.SSLCertVerificationError as e:
        print(type(e).__name__, e.library, e.reason, e.verify_code, "certificate verify failed" in str(e))
echo.join()
print(len(echo.errors))
`),
  ).toEqual(
    printed(
      "TLSv1.3 TLSv1.3 (('DNS', 'localhost'), ('IP Address', '127.0.0.1'), ('IP Address', '0:0:0:0:0:0:0:1'))",
      "b'HELLO'",
      "524288 True",
      "SSLCertVerificationError SSL CERTIFICATE_VERIFY_FAILED 62 True",
      "SSLCertVerificationError SSL CERTIFICATE_VERIFY_FAILED 18 True",
      "2",
    ),
  );
});

test.skipIf(isWindows).concurrent("timeouts, sockets that do not block, and signals", async () => {
  expect(
    await run(`
from common import *
import select, signal, time
client, server = contexts()
listener = socket.create_server(("127.0.0.1", 0))
# Nobody answers.
raw = socket.create_connection(listener.getsockname()); raw.settimeout(0.1)
try:
    client.wrap_socket(raw, server_hostname="localhost")
except TimeoutError as e:
    print(type(e).__name__, "The handshake operation timed out" in str(e))
raw = socket.create_connection(listener.getsockname()); raw.setblocking(False)
conn = client.wrap_socket(raw, server_hostname="localhost", do_handshake_on_connect=False)
try:
    conn.do_handshake()
except ssl.SSLWantReadError as e:
    print(type(e).__name__, e.errno == ssl.SSL_ERROR_WANT_READ)
# A handler runs while a socket that blocks waits, and what it raises ends the wait.
class Enough(Exception): pass
def handler(*a): raise Enough
signal.signal(signal.SIGALRM, handler)
raw = socket.create_connection(listener.getsockname())
signal.setitimer(signal.ITIMER_REAL, 0.1)
try:
    client.wrap_socket(raw, server_hostname="localhost")
except Enough:
    print("interrupted")
`),
  ).toEqual(printed("TimeoutError True", "SSLWantReadError True", "interrupted"));
});

test.skipIf(isWindows).concurrent("https: http.client and urllib against http.server", async () => {
  expect(
    await run(`
from common import *
import http.client, http.server, urllib.request, urllib.error
client, server = contexts()
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def do_GET(self):
        body = (self.path + " " + self.connection.version()).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
httpd.socket = server.wrap_socket(httpd.socket, server_side=True)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
port = httpd.server_address[1]
conn = http.client.HTTPSConnection("localhost", port, context=client)
for path in ("/one", "/two"):
    conn.request("GET", path)
    print(conn.getresponse().read())
conn.close()
with urllib.request.urlopen(f"https://127.0.0.1:{port}/three", context=client) as response:
    print(response.status, response.read())
try:
    urllib.request.urlopen(f"https://localhost:{port}/", context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
except urllib.error.URLError as e:
    print(type(e.reason).__name__)
httpd.shutdown()
`),
  ).toEqual(printed("b'/one TLSv1.3'", "b'/two TLSv1.3'", "200 b'/three TLSv1.3'", "SSLCertVerificationError"));
});

test.skipIf(isWindows).concurrent("asyncio: streams over TLS, start_tls, ALPN and SNI", async () => {
  expect(
    await run(`
from common import *
import asyncio
client, server = contexts()
client.set_alpn_protocols(["h2", "http/1.1"]); server.set_alpn_protocols(["http/1.1"])
names = []
server.sni_callback = lambda sock, name, context: names.append((type(sock).__name__, name))

async def serve(reader, writer):
    writer.write((await reader.readline()).upper())
    await writer.drain()
    writer.close()
listening = await asyncio.start_server(serve, "127.0.0.1", 0, ssl=server)
port = listening.sockets[0].getsockname()[1]
async def one(i):
    reader, writer = await asyncio.open_connection("127.0.0.1", port, ssl=client, server_hostname="localhost")
    writer.write(b"n%d\\n" % i)
    line = await reader.readline()
    protocol = writer.get_extra_info("ssl_object").selected_alpn_protocol()
    writer.close(); await writer.wait_closed()
    return line, protocol
print(sorted(set(await asyncio.gather(*(one(i) for i in range(10)))))[:2], set(names))
listening.close(); await listening.wait_closed()

async def upgrade(reader, writer):
    await reader.readline()
    writer.write(b"go ahead\\n")
    await writer.start_tls(server)
    writer.write((await reader.readline()).upper())
    writer.close()
listening = await asyncio.start_server(upgrade, "127.0.0.1", 0)
reader, writer = await asyncio.open_connection(*listening.sockets[0].getsockname())
writer.write(b"STARTTLS\\n")
print(await reader.readline())
await writer.start_tls(client, server_hostname="localhost")
writer.write(b"secret\\n")
print(await reader.readline(), writer.get_extra_info("ssl_object").version())
writer.close(); listening.close()
`),
  ).toEqual(
    printed(
      "[(b'N0\\n', 'http/1.1'), (b'N1\\n', 'http/1.1')] {('SSLObject', 'localhost')}",
      "b'go ahead\\n'",
      "b'SECRET\\n' TLSv1.3",
    ),
  );
});

test.skipIf(isWindows).concurrent("what servers and what clients may sign with are two lists", async () => {
  expect(
    await run(`
from common import *
def attempt(client_accepts=None, server_signs=None, client_signs=None, server_accepts=None):
    client, server = contexts()
    client.load_cert_chain("cert.pem", "key.pem")
    server.verify_mode = ssl.CERT_REQUIRED
    server.load_verify_locations("cert.pem")
    if client_accepts: client.set_server_sigalgs(client_accepts)
    if server_signs: server.set_server_sigalgs(server_signs)
    if client_signs: client.set_client_sigalgs(client_signs)
    if server_accepts: server.set_client_sigalgs(server_accepts)
    echo = Echo(server)
    try:
        with socket.create_connection(("127.0.0.1", echo.port)) as raw, client.wrap_socket(raw, server_hostname="localhost") as conn:
            conn.sendall(b"x")
            return conn.recv(10)
    except (ssl.SSLError, ConnectionError):
        return "refused"
    finally:
        echo.join()
a, b = "rsa_pss_rsae_sha256", "rsa_pss_rsae_sha384"
print(attempt(), attempt(a, a), attempt(a, b), attempt(a + ":" + b, b))
print(attempt(None, None, a, a), attempt(None, None, a, b), attempt(None, None, a, b + ":" + a))
print(attempt(a, a, b, b), attempt("RSA-PSS+SHA256", a), attempt("ecdsa_secp256r1_sha256"))
try:
    ssl.create_default_context().set_client_sigalgs(a + ":nonsense")
except ssl.SSLError as e:
    print(e)
`),
  ).toEqual({
    stdout: expect.stringMatching(
      /^b'X' b'X' refused b'X'\nb'X' refused b'X'\nb'X' b'X' refused\nunrecognized signature algorithm \(_ssl\.c:\d+\)\n$/,
    ),
    stderr: "",
    exitCode: 0,
  });
});

test.skipIf(isWindows).concurrent("Python is a client of Bun.serve({ tls }) in the same process", async () => {
  expect(
    await run(`
from common import *
import js, urllib.request
from bun import serve
server = serve(port=0, tls={"cert": open("cert.pem").read(), "key": open("key.pem").read()},
               fetch=lambda request, server: js.Response.new("from Bun: " + js.URL.new(request.url).pathname))
client, _ = contexts()
# The call blocks, and the event loop that has to answer it turns meanwhile.
with urllib.request.urlopen(f"https://localhost:{server.port}/path", context=client) as response:
    print(response.status, response.read())
with socket.create_connection(("127.0.0.1", server.port)) as raw, client.wrap_socket(raw, server_hostname="localhost") as conn:
    conn.sendall(b"GET /raw HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n")
    data = b""
    while chunk := conn.recv(4096):
        data += chunk
    print(conn.version(), data.split(b"\\r\\n")[0], data.split(b"\\r\\n\\r\\n")[1])
server.stop(True)
`),
  ).toEqual(printed("200 b'from Bun: /path'", "TLSv1.3 b'HTTP/1.1 200 OK' b'from Bun: /raw'"));
});

test.skipIf(isWindows).concurrent("fetch() is a client of a server written in Python", async () => {
  expect(
    await run(`
from common import *
import js, http.server
_, server = contexts()
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Length", "11"); self.end_headers(); self.wfile.write(b"from Python")
httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
httpd.socket = server.wrap_socket(httpd.socket, server_side=True)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
response = await js.fetch(f"https://localhost:{httpd.server_address[1]}/", tls={"ca": open("cert.pem").read()})
print(response.status, await response.text())
httpd.shutdown()
`),
  ).toEqual(printed("200 from Python"));
});

test.skipIf(isWindows).concurrent("$SSL_CERT_FILE is what a default context trusts", async () => {
  expect(
    await run(
      `
from common import *
_, server = contexts()
echo = Echo(server)
context = ssl.create_default_context()
print(context.cert_store_stats())
with socket.create_connection(("127.0.0.1", echo.port)) as raw, context.wrap_socket(raw, server_hostname="localhost") as conn:
    conn.sendall(b"trusted")
    print(conn.recv(100))
`,
      { SSL_CERT_FILE: "<dir>/cert.pem", SSL_CERT_DIR: "<dir>" },
    ),
  ).toEqual(printed("{'x509': 1, 'crl': 0, 'x509_ca': 1}", "b'TRUSTED'"));
});

test
  .skipIf(isWindows)
  .concurrent("what a callback raises, and objects that are dropped in the middle of things", async () => {
    expect(
      await run(`
from common import *
import gc
client, server = contexts()
def pair(client, server):
    bios = [ssl.MemoryBIO() for _ in range(4)]
    return client.wrap_bio(bios[0], bios[1], server_hostname="localhost"), server.wrap_bio(bios[2], bios[3], server_side=True), bios
def handshake(c, s, bios):
    for _ in range(10):
        done = 0
        for side in (c, s):
            try:
                side.do_handshake(); done += 1
            except ssl.SSLWantReadError:
                pass
        bios[2].write(bios[1].read()); bios[0].write(bios[3].read())
        if done == 2:
            return c.version()
print(handshake(*pair(client, server)))

def boom(*a): raise RuntimeError("from the callback")
client._msg_callback = boom
try:
    pair(client, server)[0].do_handshake()
except ssl.SSLWantReadError as e:
    print(type(e.__context__).__name__, e.__context__)
client._msg_callback = None

# The context goes while its connections are still there, halfway through a handshake, and the other way round.
kept = []
for i in range(200):
    c, s = contexts()
    s.sni_callback = lambda sock, name, context: None
    a, b, bios = pair(c, s)
    try:
        a.do_handshake()
    except ssl.SSLWantReadError:
        pass
    kept.append((a, bios) if i % 2 else (c, s))
    if i % 50 == 0:
        gc.collect()
del a, b, c, s, bios
gc.collect()
print(len(kept), kept[1][0].context.protocol.name)
def in_thread():
    for _ in range(50):
        handshake(*pair(*contexts()))
    gc.collect()
threads = [threading.Thread(target=in_thread) for _ in range(4)]
[t.start() for t in threads]; [t.join() for t in threads]
kept.clear(); gc.collect()
print("done")
`),
    ).toEqual(printed("TLSv1.3", "RuntimeError from the callback", "200 PROTOCOL_TLS_CLIENT", "done"));
  });
