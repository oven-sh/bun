#!/usr/bin/env node

// Test constructor instantiation
try {
  console.log('Testing constructor instantiation...');
  const sqlite = require('node:sqlite');
  console.log('sqlite:', sqlite);
  
  console.log('Trying to create new DatabaseSync()...');
  const db = new sqlite.DatabaseSync();
  console.log('DatabaseSync created successfully:', db);
  
} catch (error) {
  console.error('Failed to create DatabaseSync:', error);
  console.error('Stack:', error.stack);
}