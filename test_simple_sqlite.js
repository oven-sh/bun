#!/usr/bin/env node

// Very simple test 
try {
  console.log('About to require node:sqlite...');
  const sqlite = require('node:sqlite');
  console.log('node:sqlite required successfully!');
  console.log('sqlite:', sqlite);
} catch (error) {
  console.error('Failed to require node:sqlite:', error);
}