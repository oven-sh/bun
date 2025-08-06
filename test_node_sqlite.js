#!/usr/bin/env node

// Simple test to check that node:sqlite module loads and exports correct objects
try {
  const sqlite = require('node:sqlite');
  
  console.log('node:sqlite module loaded successfully!');
  console.log('Exports:', Object.keys(sqlite));
  
  // Check that expected exports exist
  const expectedExports = ['DatabaseSync', 'StatementSync', 'constants', 'backup'];
  let success = true;
  
  for (const expectedExport of expectedExports) {
    if (!(expectedExport in sqlite)) {
      console.error(`Missing export: ${expectedExport}`);
      success = false;
    } else {
      console.log(`✓ ${expectedExport} export found`);
    }
  }
  
  // Check constructors
  if (typeof sqlite.DatabaseSync === 'function') {
    console.log('✓ DatabaseSync is a function');
  } else {
    console.error('✗ DatabaseSync is not a function');
    success = false;
  }
  
  if (typeof sqlite.StatementSync === 'function') {
    console.log('✓ StatementSync is a function');
  } else {
    console.error('✗ StatementSync is not a function');
    success = false;
  }
  
  // Check constants
  if (typeof sqlite.constants === 'object' && sqlite.constants !== null) {
    console.log('✓ constants is an object');
    console.log('Constants:', Object.keys(sqlite.constants));
  } else {
    console.error('✗ constants is not an object');
    success = false;
  }
  
  // Check backup function
  if (typeof sqlite.backup === 'function') {
    console.log('✓ backup is a function');
  } else {
    console.error('✗ backup is not a function');
    success = false;
  }
  
  if (success) {
    console.log('\n✅ All exports are present and have correct types!');
    process.exit(0);
  } else {
    console.log('\n❌ Some exports are missing or have incorrect types');
    process.exit(1);
  }
  
} catch (error) {
  console.error('❌ Failed to load node:sqlite module:', error.message);
  process.exit(1);
}