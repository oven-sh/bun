#!/usr/bin/env node

// Test basic database operations
try {
  console.log('Testing database operations...');
  const sqlite = require('node:sqlite');
  
  // Create a database
  console.log('Creating DatabaseSync instance...');
  const db = new sqlite.DatabaseSync();
  console.log('Database created:', db);
  
  // Try to access methods that should exist
  console.log('Checking for expected methods...');
  console.log('db.open:', typeof db.open);
  console.log('db.close:', typeof db.close);
  console.log('db.prepare:', typeof db.prepare);
  console.log('db.exec:', typeof db.exec);
  
} catch (error) {
  console.error('Failed database operations test:', error);
  console.error('Stack:', error.stack);
}