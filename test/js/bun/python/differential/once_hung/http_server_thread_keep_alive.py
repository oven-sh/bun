# test_httpservers.RequestHandlerLoggingTestCase.test_get (and the Colorized one)
import http.client, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
server = HTTPServer(("localhost", 0), Handler)
thread = threading.Thread(target=server.serve_forever)
thread.start()
con = http.client.HTTPConnection("localhost", server.server_address[1])
con.connect()
con.request("GET", "/")
print(con.getresponse().status, flush=True)
con.close()
print("closed", flush=True)
server.shutdown()
thread.join()
server.server_close()
print("done")
