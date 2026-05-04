'use strict'

const { createSecureServer } = require('node:http2')
const { createServer } = require('node:http')
const { createReadStream, readFileSync } = require('node:fs')
const { once } = require('node:events')
const { Readable } = require('node:stream')

// Vendored: undici-shim provides node:test wrapper (t.plan enforced), pem
// (harness TLS certs), Client/fetch/Headers stubs, and the
// closeClientAndServerAsPromise helper. Test bodies below are unmodified
// from undici test/fetch/http2.js.
const { test, pem, Client, fetch, Headers, closeClientAndServerAsPromise } = require('./undici-shim.mjs')

test('[Fetch] Issue#2311', async (t) => {
  const expectedBody = 'hello from client!'

  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }), async (req, res) => {
    let body = ''

    req.setEncoding('utf8')

    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'x-custom-h2': req.headers['x-my-header']
    })

    for await (const chunk of req) {
      body += chunk
    }

    res.end(body)
  })

  t.plan(2)

  server.listen()
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  const response = await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      method: 'POST',
      dispatcher: client,
      headers: {
        'x-my-header': 'foo',
        'content-type': 'text-plain'
      },
      body: expectedBody
    }
  )

  const responseBody = await response.text()

  t.after(closeClientAndServerAsPromise(client, server))

  t.assert.strictEqual(responseBody, expectedBody)
  t.assert.strictEqual(response.headers.get('x-custom-h2'), 'foo')
})

test('[Fetch] Simple GET with h2', async (t) => {
  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))
  const expectedRequestBody = 'hello h2!'

  server.on('stream', async (stream, headers) => {
    stream.respond({
      'content-type': 'text/plain; charset=utf-8',
      'x-custom-h2': headers['x-my-header'],
      'x-method': headers[':method'],
      ':status': 200
    })

    stream.end(expectedRequestBody)
  })

  t.plan(5)

  server.listen()
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  const response = await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      method: 'GET',
      dispatcher: client,
      headers: {
        'x-my-header': 'foo',
        'content-type': 'text-plain'
      }
    }
  )

  const responseBody = await response.text()

  t.after(closeClientAndServerAsPromise(client, server))

  t.assert.strictEqual(responseBody, expectedRequestBody)
  t.assert.strictEqual(response.headers.get('x-method'), 'GET')
  t.assert.strictEqual(response.headers.get('x-custom-h2'), 'foo')
  // https://github.com/nodejs/undici/issues/2415
  t.assert.throws(() => {
    response.headers.get(':status')
  }, TypeError)

  // See https://fetch.spec.whatwg.org/#concept-response-status-message
  t.assert.strictEqual(response.statusText, '')
})

test('[Fetch] Should handle h2 request with body (string or buffer)', async (t) => {
  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))
  const expectedBody = 'hello from client!'
  const expectedRequestBody = 'hello h2!'
  const requestBody = []

  server.on('stream', async (stream, headers) => {
    stream.on('data', chunk => requestBody.push(chunk))

    stream.respond({
      'content-type': 'text/plain; charset=utf-8',
      'x-custom-h2': headers['x-my-header'],
      ':status': 200
    })

    stream.end(expectedRequestBody)
  })

  t.plan(2)

  server.listen()
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  const response = await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      method: 'POST',
      dispatcher: client,
      headers: {
        'x-my-header': 'foo',
        'content-type': 'text-plain'
      },
      body: expectedBody
    }
  )

  const responseBody = await response.text()

  t.after(closeClientAndServerAsPromise(client, server))

  t.assert.strictEqual(Buffer.concat(requestBody).toString('utf-8'), expectedBody)
  t.assert.strictEqual(responseBody, expectedRequestBody)
})

// Skipping for now, there is something odd in the way the body is handled
test(
  '[Fetch] Should handle h2 request with body (stream)',
  async (t) => {
    const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))
    const expectedBody = readFileSync(__filename, 'utf-8')
    const stream = createReadStream(__filename)
    const requestChunks = []

    t.plan(8)

    server.on('stream', async (stream, headers) => {
      t.assert.strictEqual(headers[':method'], 'PUT')
      t.assert.strictEqual(headers[':path'], '/')
      t.assert.strictEqual(headers[':scheme'], 'https')

      stream.respond({
        'content-type': 'text/plain; charset=utf-8',
        'x-custom-h2': headers['x-my-header'],
        ':status': 200
      })

      for await (const chunk of stream) {
        requestChunks.push(chunk)
      }

      stream.end('hello h2!')
    })

    server.listen(0)
    await once(server, 'listening')

    const client = new Client(`https://localhost:${server.address().port}`, {
      connect: {
        rejectUnauthorized: false
      },
      allowH2: true
    })

    t.after(closeClientAndServerAsPromise(client, server))

    const response = await fetch(
      `https://localhost:${server.address().port}/`,
      // Needs to be passed to disable the reject unauthorized
      {
        method: 'PUT',
        dispatcher: client,
        headers: {
          'x-my-header': 'foo',
          'content-type': 'text-plain'
        },
        body: Readable.toWeb(stream),
        duplex: 'half'
      }
    )

    const responseBody = await response.text()

    t.assert.strictEqual(response.status, 200)
    t.assert.strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8')
    t.assert.strictEqual(response.headers.get('x-custom-h2'), 'foo')
    t.assert.strictEqual(responseBody, 'hello h2!')
    t.assert.strictEqual(Buffer.concat(requestChunks).toString('utf-8'), expectedBody)
  }
)
test('Should handle h2 request with body (Blob)', async (t) => {
  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))
  const expectedBody = 'asd'
  const requestChunks = []
  const body = new Blob(['asd'], {
    type: 'text/plain'
  })

  t.plan(8)

  server.on('stream', async (stream, headers) => {
    t.assert.strictEqual(headers[':method'], 'POST')
    t.assert.strictEqual(headers[':path'], '/')
    t.assert.strictEqual(headers[':scheme'], 'https')

    stream.on('data', chunk => requestChunks.push(chunk))

    stream.respond({
      'content-type': 'text/plain; charset=utf-8',
      'x-custom-h2': headers['x-my-header'],
      ':status': 200
    })

    stream.end('hello h2!')
  })

  server.listen(0)
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  t.after(closeClientAndServerAsPromise(client, server))

  const response = await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      body,
      method: 'POST',
      dispatcher: client,
      headers: {
        'x-my-header': 'foo',
        'content-type': 'text-plain'
      }
    }
  )

  const responseBody = await response.arrayBuffer()

  t.assert.strictEqual(response.status, 200)
  t.assert.strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8')
  t.assert.strictEqual(response.headers.get('x-custom-h2'), 'foo')
  t.assert.strictEqual(new TextDecoder().decode(responseBody).toString(), 'hello h2!')
  t.assert.strictEqual(Buffer.concat(requestChunks).toString('utf-8'), expectedBody)
})

test(
  'Should handle h2 request with body (Blob:ArrayBuffer)',
  async (t) => {
    const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))
    const expectedBody = 'hello'
    const requestChunks = []
    const expectedResponseBody = { hello: 'h2' }
    const buf = Buffer.from(expectedBody)
    const body = new ArrayBuffer(buf.byteLength)

    buf.copy(new Uint8Array(body))

    t.plan(8)

    server.on('stream', async (stream, headers) => {
      t.assert.strictEqual(headers[':method'], 'PUT')
      t.assert.strictEqual(headers[':path'], '/')
      t.assert.strictEqual(headers[':scheme'], 'https')

      stream.on('data', chunk => requestChunks.push(chunk))

      stream.respond({
        'content-type': 'application/json',
        'x-custom-h2': headers['x-my-header'],
        ':status': 200
      })

      stream.end(JSON.stringify(expectedResponseBody))
    })

    server.listen(0)
    await once(server, 'listening')

    const client = new Client(`https://localhost:${server.address().port}`, {
      connect: {
        rejectUnauthorized: false
      },
      allowH2: true
    })

    t.after(closeClientAndServerAsPromise(client, server))

    const response = await fetch(
      `https://localhost:${server.address().port}/`,
      // Needs to be passed to disable the reject unauthorized
      {
        body,
        method: 'PUT',
        dispatcher: client,
        headers: {
          'x-my-header': 'foo',
          'content-type': 'text-plain'
        }
      }
    )

    const responseBody = await response.json()

    t.assert.strictEqual(response.status, 200)
    t.assert.strictEqual(response.headers.get('content-type'), 'application/json')
    t.assert.strictEqual(response.headers.get('x-custom-h2'), 'foo')
    t.assert.deepStrictEqual(responseBody, expectedResponseBody)
    t.assert.strictEqual(Buffer.concat(requestChunks).toString('utf-8'), expectedBody)
  }
)

test('Issue#2415', async (t) => {
  t.plan(1)
  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))

  server.on('stream', async (stream, headers) => {
    stream.respond({
      ':status': 200
    })
    stream.end('test')
  })

  server.listen()
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  const response = await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      method: 'GET',
      dispatcher: client
    }
  )

  await response.text()

  t.after(closeClientAndServerAsPromise(client, server))

  t.assert.doesNotThrow(() => new Headers(response.headers))
})

test('Issue #2386', async (t) => {
  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))
  const body = Buffer.from('hello')
  const requestChunks = []
  const expectedResponseBody = { hello: 'h2' }
  const controller = new AbortController()
  const signal = controller.signal

  t.plan(4)

  server.on('stream', async (stream, headers) => {
    t.assert.strictEqual(headers[':method'], 'PUT')
    t.assert.strictEqual(headers[':path'], '/')
    t.assert.strictEqual(headers[':scheme'], 'https')

    stream.on('data', chunk => requestChunks.push(chunk))

    stream.respond({
      'content-type': 'application/json',
      'x-custom-h2': headers['x-my-header'],
      ':status': 200
    })

    stream.end(JSON.stringify(expectedResponseBody))
  })

  server.listen(0)
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  t.after(closeClientAndServerAsPromise(client, server))

  await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      body,
      signal,
      method: 'PUT',
      dispatcher: client,
      headers: {
        'x-my-header': 'foo',
        'content-type': 'text-plain'
      }
    }
  )

  controller.abort()
  t.assert.ok(true)
})

test('Issue #3046', async (t) => {
  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))

  t.plan(6)

  server.on('stream', async (stream, headers) => {
    t.assert.strictEqual(headers[':method'], 'GET')
    t.assert.strictEqual(headers[':path'], '/')
    t.assert.strictEqual(headers[':scheme'], 'https')

    stream.respond({
      'set-cookie': ['hello=world', 'foo=bar'],
      'content-type': 'text/html; charset=utf-8',
      ':status': 200
    })

    stream.end('<h1>Hello World</h1>')
  })

  server.listen(0)
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  t.after(closeClientAndServerAsPromise(client, server))

  const response = await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      method: 'GET',
      dispatcher: client
    }
  )

  t.assert.strictEqual(response.status, 200)
  t.assert.strictEqual(response.headers.get('content-type'), 'text/html; charset=utf-8')
  t.assert.deepStrictEqual(response.headers.getSetCookie(), ['hello=world', 'foo=bar'])
})

// The two following tests ensure that empty POST requests have a Content-Length of 0
// specified, both with and without HTTP/2 enabled.
// The RFC 9110 (see https://httpwg.org/specs/rfc9110.html#field.content-length)
// states it SHOULD have one for methods like POST that define a meaning for enclosed content.
test('[Fetch] Empty POST without h2 has Content-Length', async (t) => {
  const server = createServer({ joinDuplicateHeaders: true }, (req, res) => {
    res.statusCode = 200
    res.end(`content-length:${req.headers['content-length']}`)
  }).listen(0)

  const client = new Client(`http://localhost:${server.address().port}`)

  t.after(async () => {
    server.close()
    await client.close()
  })

  t.plan(1)

  await once(server, 'listening')

  const response = await fetch(
    `http://localhost:${server.address().port}/`, {
      method: 'POST',
      dispatcher: client
    }
  )

  const responseBody = await response.text()
  t.assert.strictEqual(responseBody, `content-length:${0}`)
})

test('[Fetch] Empty POST with h2 has Content-Length', async (t) => {
  const server = createSecureServer(await pem.generate({ opts: { keySize: 2048 } }))

  server.on('stream', async (stream, headers) => {
    stream.respond({
      'content-type': 'text/plain; charset=utf-8',
      ':status': 200
    })

    stream.end(`content-length:${headers['content-length']}`)
  })

  t.plan(1)

  server.listen()
  await once(server, 'listening')

  const client = new Client(`https://localhost:${server.address().port}`, {
    connect: {
      rejectUnauthorized: false
    },
    allowH2: true
  })

  t.after(closeClientAndServerAsPromise(client, server))

  const response = await fetch(
    `https://localhost:${server.address().port}/`,
    // Needs to be passed to disable the reject unauthorized
    {
      method: 'POST',
      dispatcher: client
    }
  )

  const responseBody = await response.text()

  t.assert.strictEqual(responseBody, `content-length:${0}`)
})
