#!/usr/bin/env node

// Test constructor instantiation
try {
  console.log('Testing node:sqlite constructors...');
  const sqlite = require('node:sqlite');
  console.log('Module loaded successfully!');
  
  // Test DatabaseSync constructor
  try {
    console.log('Testing DatabaseSync constructor...');
    const db = new sqlite.DatabaseSync();
    console.log('DatabaseSync constructor worked:', db);
  } catch (error) {
    console.error('DatabaseSync constructor failed:', error.message);
  }
  
  // Test StatementSync constructor
  try {
    console.log('Testing StatementSync constructor...');
    const stmt = new sqlite.StatementSync();
    console.log('StatementSync constructor worked:', stmt);
  } catch (error) {
    console.error('StatementSync constructor failed:', error.message);
  }
  
} catch (error) {
  console.error('Failed to load node:sqlite:', error);
}