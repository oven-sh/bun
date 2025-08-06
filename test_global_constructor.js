#!/usr/bin/env node

// Test if constructors are accessible globally
try {
  console.log('Testing global constructor access...');
  
  // Test if they're in global scope
  console.log('typeof globalThis.NodeSQLiteDatabaseSync:', typeof globalThis.NodeSQLiteDatabaseSync);
  console.log('typeof globalThis.NodeSQLiteStatementSync:', typeof globalThis.NodeSQLiteStatementSync);
  
  // Try accessing them directly
  if (typeof NodeSQLiteDatabaseSync !== 'undefined') {
    console.log('NodeSQLiteDatabaseSync found globally:', NodeSQLiteDatabaseSync.name);
  }
  
  if (typeof NodeSQLiteStatementSync !== 'undefined') {
    console.log('NodeSQLiteStatementSync found globally:', NodeSQLiteStatementSync.name);
  }
  
} catch (error) {
  console.error('Error:', error.message);
}