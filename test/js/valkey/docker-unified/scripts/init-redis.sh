#!/bin/bash
set -e

echo "Starting Redis initialization script"

# Function to wait for Redis with timeout
wait_for_redis() {
  local type=$1
  local max_attempts=20
  local attempt=1
  local command=$2
  
  echo "Waiting for Redis $type to start..."
  until eval "$command" || [ $attempt -gt $max_attempts ]; do
    echo "Waiting for Redis $type to start... (Attempt $attempt/$max_attempts)"
    sleep 1
    ((attempt++))
  done
  
  if [ $attempt -gt $max_attempts ]; then
    echo "ERROR: Redis $type failed to start after $max_attempts attempts"
    return 1
  else
    echo "Redis $type is ready!"
    return 0
  fi
}

# Wait for Redis TCP to start
wait_for_redis "TCP" "redis-cli -p 6379 ping > /dev/null 2>&1"

# Wait for Redis TLS to start
wait_for_redis "TLS" "redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key --cacert /etc/redis/certs/server.crt -p 6380 ping > /dev/null 2>&1"

# Wait for Redis Unix socket to start
wait_for_redis "UNIX" "redis-cli -s /tmp/redis.sock ping > /dev/null 2>&1"

echo "Setting up test data..."

# Set up some test data for TCP connection in DB 0
redis-cli -p 6379 select 0
redis-cli -p 6379 set bun_valkey_test_init "initialization_successful"
redis-cli -p 6379 hset bun_valkey_test_hash name "test_user" age "25" active "true"
redis-cli -p 6379 sadd bun_valkey_test_set "red" "green" "blue"
redis-cli -p 6379 lpush bun_valkey_test_list "first" "second" "third"

# Set up some test data for TLS connection in DB 1
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key --cacert /etc/redis/certs/server.crt -p 6380 select 1
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key --cacert /etc/redis/certs/server.crt -p 6380 set bun_valkey_tls_test_init "initialization_successful"
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key --cacert /etc/redis/certs/server.crt -p 6380 hset bun_valkey_tls_test_hash name "test_user" age "25" active "true"
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key --cacert /etc/redis/certs/server.crt -p 6380 sadd bun_valkey_tls_test_set "red" "green" "blue"
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key --cacert /etc/redis/certs/server.crt -p 6380 lpush bun_valkey_tls_test_list "first" "second" "third"

# Set up some test data for Unix socket connection in DB 2
redis-cli -s /tmp/redis.sock select 2
redis-cli -s /tmp/redis.sock set bun_valkey_unix_test_init "initialization_successful"
redis-cli -s /tmp/redis.sock hset bun_valkey_unix_test_hash name "test_user" age "25" active "true"
redis-cli -s /tmp/redis.sock sadd bun_valkey_unix_test_set "red" "green" "blue"
redis-cli -s /tmp/redis.sock lpush bun_valkey_unix_test_list "first" "second" "third"

# Set up test data for authenticated connection with testuser
redis-cli -p 6379 -a test123 --user testuser select 3
redis-cli -p 6379 -a test123 --user testuser set bun_valkey_auth_test_init "auth_initialization_successful"
redis-cli -p 6379 -a test123 --user testuser hset bun_valkey_auth_test_hash name "auth_user" age "30" active "true"

# Set up test data for read-only user
redis-cli -p 6379 select 4
redis-cli -p 6379 set bun_valkey_readonly_test "readonly_test"

# Set up test data for write-only user
redis-cli -p 6379 select 5
redis-cli -p 6379 set bun_valkey_writeonly_test "writeonly_test"

echo "Redis initialization complete!"