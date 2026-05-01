-- PostgreSQL initialization script for plain setup
ALTER SYSTEM SET max_prepared_transactions = '1000';
ALTER SYSTEM SET max_connections = '2000';

-- Create test users with different auth methods
CREATE USER bun_sql_test;
CREATE USER bun_sql_test_md5 WITH PASSWORD 'bun_sql_test_md5';
CREATE USER bun_sql_test_scram WITH PASSWORD 'bun_sql_test_scram';

-- Create test database
CREATE DATABASE bun_sql_test;

-- Grant permissions to all test users
GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test;
GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test_md5;
GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test_scram;

ALTER DATABASE bun_sql_test OWNER TO bun_sql_test;