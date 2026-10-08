const CONNECTION_STATUS = exports.CONNECTION_STATUS = {
  CLOSED: Object.freeze({ kind: 'CLOSED' }),
  CONNECTED: Object.freeze({ kind: 'CONNECTED' }),
  CONNECTING: Object.freeze({ kind: 'CONNECTING' }),
  NOT_CONNECTED: Object.freeze({ kind: 'NOT_CONNECTED' }) };

/* A comment */ /**
* A type that can be written to a buffer.
*/ /**
* Describes the connection status of a ReactiveSocket/DuplexConnection.
* - NOT_CONNECTED: no connection established or pending.
* - CONNECTING: when `connect()` has been called but a connection is not yet
*   established.
* - CONNECTED: when a connection is established.
* - CLOSED: when the connection has been explicitly closed via `close()`.
* - ERROR: when the connection has been closed for any other reason.
*/ /**
* A contract providing different interaction models per the [ReactiveSocket protocol]
* (https://github.com/ReactiveSocket/reactivesocket/blob/master/Protocol.md).
*/ /**
* A single unit of data exchanged between the peers of a `ReactiveSocket`.
*/
