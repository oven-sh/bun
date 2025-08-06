#!/usr/bin/env node

// Test accessing constructors without calling them
try {
  console.log('Testing constructor access...');
  const sqlite = require('node:sqlite');
  console.log('sqlite module loaded');
  
  console.log('typeof DatabaseSync:', typeof sqlite.DatabaseSync);
  console.log('typeof StatementSync:', typeof sqlite.StatementSync);
  
  console.log('DatabaseSync.name:', sqlite.DatabaseSync.name);
  console.log('StatementSync.name:', sqlite.StatementSync.name);
  
  console.log('Success - constructors are accessible!');
  
} catch (error) {
  console.error('Failed:', error.message);
  console.error('Stack:', error.stack);
}