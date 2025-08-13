'use strict';
const { OutgoingMessage } = require('http');

{
  // Tests for _headerNames set method
  const outgoingMessage = new OutgoingMessage();
  outgoingMessage._headerNames = {
    'x-flow-id': '61bba6c5-28a3-4eab-9241-2ecaa6b6a1fd'
  };
}
