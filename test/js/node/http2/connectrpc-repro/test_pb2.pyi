from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class StreamRequest(_message.Message):
    __slots__ = ("num_messages",)
    NUM_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    num_messages: int
    def __init__(self, num_messages: _Optional[int] = ...) -> None: ...

class StreamResponse(_message.Message):
    __slots__ = ("message_num", "data")
    MESSAGE_NUM_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    message_num: int
    data: str
    def __init__(self, message_num: _Optional[int] = ..., data: _Optional[str] = ...) -> None: ...
