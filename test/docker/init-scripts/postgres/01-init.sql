-- PostgreSQL initialization script for plain setup
ALTER SYSTEM SET max_prepared_transactions = '1000';
ALTER SYSTEM SET max_connections = '2000';

-- Create test user
CREATE USER bun_sql_test;

-- Create test database
CREATE DATABASE bun_sql_test;
GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test;
ALTER DATABASE bun_sql_test OWNER TO bun_sql_test;