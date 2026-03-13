#!/bin/bash
set -e

# Wait for PostgreSQL to start
until pg_isready; do
  echo "Waiting for PostgreSQL to start..."
  sleep 1
done

# Drop database if exists
dropdb --if-exists bun_sql_test || true

# Create users with different auth methods
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create basic user
    DROP USER IF EXISTS bun_sql_test;
    CREATE USER bun_sql_test;

    -- Create MD5 user
    ALTER SYSTEM SET password_encryption = 'md5';
    SELECT pg_reload_conf();
    DROP USER IF EXISTS bun_sql_test_md5;
    CREATE USER bun_sql_test_md5 WITH PASSWORD 'bun_sql_test_md5';

    -- Create SCRAM user
    ALTER SYSTEM SET password_encryption = 'scram-sha-256';
    SELECT pg_reload_conf();
    DROP USER IF EXISTS bun_sql_test_scram;
    CREATE USER bun_sql_test_scram WITH PASSWORD 'bun_sql_test_scram';
EOSQL

# Create database and set permissions
createdb bun_sql_test

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test;
    GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test_md5;
    GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test_scram;
    ALTER DATABASE bun_sql_test OWNER TO bun_sql_test;
EOSQL