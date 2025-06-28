// Original file: test/fixtures/test_service.proto

import type * as grpc from './../../src/index'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { Request as _Request, Request__Output as _Request__Output } from './Request';
import type { Response as _Response, Response__Output as _Response__Output } from './Response';

export interface TestServiceClient extends grpc.Client {
  BidiStream(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_Request, _Response__Output>;
  BidiStream(options?: grpc.CallOptions): grpc.ClientDuplexStream<_Request, _Response__Output>;
  bidiStream(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_Request, _Response__Output>;
  bidiStream(options?: grpc.CallOptions): grpc.ClientDuplexStream<_Request, _Response__Output>;
  
  ClientStream(metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  ClientStream(metadata: grpc.Metadata, callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  ClientStream(options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  ClientStream(callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  clientStream(metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  clientStream(metadata: grpc.Metadata, callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  clientStream(options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  clientStream(callback: grpc.requestCallback<_Response__Output>): grpc.ClientWritableStream<_Request>;
  
  ServerStream(argument: _Request, metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientReadableStream<_Response__Output>;
  ServerStream(argument: _Request, options?: grpc.CallOptions): grpc.ClientReadableStream<_Response__Output>;
  serverStream(argument: _Request, metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientReadableStream<_Response__Output>;
  serverStream(argument: _Request, options?: grpc.CallOptions): grpc.ClientReadableStream<_Response__Output>;
  
  Unary(argument: _Request, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  Unary(argument: _Request, metadata: grpc.Metadata, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  Unary(argument: _Request, options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  Unary(argument: _Request, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  unary(argument: _Request, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  unary(argument: _Request, metadata: grpc.Metadata, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  unary(argument: _Request, options: grpc.CallOptions, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  unary(argument: _Request, callback: grpc.requestCallback<_Response__Output>): grpc.ClientUnaryCall;
  
}

export interface TestServiceHandlers extends grpc.UntypedServiceImplementation {
  BidiStream: grpc.handleBidiStreamingCall<_Request__Output, _Response>;
  
  ClientStream: grpc.handleClientStreamingCall<_Request__Output, _Response>;
  
  ServerStream: grpc.handleServerStreamingCall<_Request__Output, _Response>;
  
  Unary: grpc.handleUnaryCall<_Request__Output, _Response>;
  
}

export interface TestServiceDefinition extends grpc.ServiceDefinition {
  BidiStream: MethodDefinition<_Request, _Response, _Request__Output, _Response__Output>
  ClientStream: MethodDefinition<_Request, _Response, _Request__Output, _Response__Output>
  ServerStream: MethodDefinition<_Request, _Response, _Request__Output, _Response__Output>
  Unary: MethodDefinition<_Request, _Response, _Request__Output, _Response__Output>
}
