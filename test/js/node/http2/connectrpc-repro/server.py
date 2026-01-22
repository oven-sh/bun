#!/usr/bin/env python3
"""
Minimal Connect RPC server that reproduces premature close bug.

This server streams responses quickly (like fast LLM responses) and then
completes immediately without artificial delays - which triggers the bug
where the client gets "premature close" errors.
"""

import asyncio
from collections.abc import AsyncIterator

from connectrpc.request import RequestContext
from test_connect import TestService, TestServiceASGIApplication
from test_pb2 import StreamRequest, StreamResponse


class TestServiceImpl:
    """Implementation of the TestService."""

    async def stream_data(
        self, request: StreamRequest, ctx: RequestContext
    ) -> AsyncIterator[StreamResponse]:
        """Stream large responses quickly then complete immediately."""
        # Large payload to fill HTTP/2 buffers (similar to embedding data)
        # 10KB per message to stress the stream buffering
        large_data = "x" * 10000

        # Send multiple messages rapidly (like fast LLM cached responses)
        for i in range(request.num_messages):
            yield StreamResponse(
                message_num=i + 1,
                data=f"Message {i + 1}: {large_data}"
            )

        # Complete immediately - NO artificial delay
        # This is where the bug manifests:
        # - Python async generator completes
        # - Server begins HTTP/2 stream cleanup (sends END_STREAM)
        # - BUT data is still in HTTP/2 buffers waiting to be sent/received
        # - Client receives END_STREAM before receiving all DATA frames
        # - Client reports "premature close" error


async def main():
    from hypercorn.asyncio import serve
    from hypercorn.config import Config

    # Create Connect ASGI application
    service = TestServiceImpl()
    app = TestServiceASGIApplication(service)

    config = Config()
    config.bind = ["localhost:50051"]
    config.keep_alive_timeout = 30

    print("Server listening on localhost:50051")
    print("Press Ctrl+C to stop")

    await serve(app, config)


if __name__ == "__main__":
    asyncio.run(main())
