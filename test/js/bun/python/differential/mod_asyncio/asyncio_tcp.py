import asyncio, socket
async def handle(reader, writer):
    while True:
        line = await reader.readline()
        if not line: break
        writer.write(line.upper()); await writer.drain()
    writer.close(); await writer.wait_closed()
async def client(port, n):
    reader, writer = await asyncio.open_connection('127.0.0.1', port)
    out = []
    for i in range(3):
        writer.write(b'client %d line %d\n' % (n, i)); await writer.drain(); out.append(await reader.readline())
    print(n, writer.get_extra_info('peername')[0], writer.get_extra_info('socket').family == socket.AF_INET)
    writer.write_eof(); rest = await reader.read(); writer.close(); await writer.wait_closed()
    return out, rest
async def main():
    server = await asyncio.start_server(handle, '127.0.0.1', 0)
    port = server.sockets[0].getsockname()[1]; print(server.is_serving(), len(server.sockets))
    async with server:
        print(await client(port, 0))
        for r in await asyncio.gather(*(client(port, n) for n in range(1, 6))): print(r)
        # much data
        reader, writer = await asyncio.open_connection('127.0.0.1', port)
        big = (b'x' * 99 + b'\n') * 3000
        async def send(): writer.write(big); await writer.drain(); writer.write_eof()
        async def recv(): return await reader.read()
        _, got = await asyncio.gather(send(), recv()); print(len(got), got == big.upper()); writer.close(); await writer.wait_closed()
    print(server.is_serving())
    try: await asyncio.open_connection('127.0.0.1', port)
    except ConnectionRefusedError as e: print('refused', e.errno)
    # low level
    loop = asyncio.get_running_loop()
    a, b = socket.socketpair(); a.setblocking(False); b.setblocking(False)
    await loop.sock_sendall(a, b'low level'); print(await loop.sock_recv(b, 100))
    buf = bytearray(4); await loop.sock_sendall(b, b'into'); print(await loop.sock_recv_into(a, buf), buf)
    fut = loop.create_future(); loop.add_reader(b, lambda: fut.set_result(b.recv(10))); a.send(b'reader'); print(await fut); print(loop.remove_reader(b), loop.remove_reader(b))
    fut = loop.create_future(); loop.add_writer(a, lambda: fut.done() or fut.set_result('writable')); print(await fut); print(loop.remove_writer(a))
    a.close(); b.close()
    srv = socket.create_server(('127.0.0.1', 0)); srv.setblocking(False); c = socket.socket(); c.setblocking(False)
    acc = asyncio.create_task(loop.sock_accept(srv)); await loop.sock_connect(c, srv.getsockname()); conn, addr = await acc; print(addr == c.getsockname(), conn.getblocking()); conn.close(); c.close(); srv.close()
    # protocols, datagrams
    class Echo(asyncio.DatagramProtocol):
        def connection_made(self, tr): self.tr = tr
        def datagram_received(self, data, addr): self.tr.sendto(data[::-1], addr)
    class Cl(asyncio.DatagramProtocol):
        def __init__(self): self.got = loop.create_future()
        def datagram_received(self, data, addr): self.got.set_result(data)
    tr, _ = await loop.create_datagram_endpoint(Echo, local_addr=('127.0.0.1', 0))
    tc, pc = await loop.create_datagram_endpoint(Cl, remote_addr=tr.get_extra_info('sockname')); tc.sendto(b'datagram'); print(await pc.got); tc.close(); tr.close()
    # unix
    import tempfile, os
    d = tempfile.mkdtemp(); p = os.path.join(d, 's')
    us = await asyncio.start_unix_server(handle, p); r, w = await asyncio.open_unix_connection(p); w.write(b'unix\n'); print(await r.readline()); w.close(); await w.wait_closed(); us.close(); await us.wait_closed()
    if os.path.exists(p): os.unlink(p)
    os.rmdir(d)
    print(await loop.getaddrinfo('127.0.0.1', 80, type=socket.SOCK_STREAM) if False else 'skip getaddrinfo (executor)')
asyncio.run(main())
