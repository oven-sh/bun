# Dockerfile for Valkey/Redis with TLS support
FROM redis:7-alpine

# Install bash for initialization scripts
RUN apk add --no-cache bash

# Create certificates directory
RUN mkdir -p /etc/redis/certs

# Copy certificates
COPY server.key /etc/redis/certs/
COPY server.crt /etc/redis/certs/

# Create initialization script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Wait for Redis to start\n\
until redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key  ping; do\n\
  echo "Waiting for Redis TLS to start..."\n\
  sleep 1\n\
done\n\
\n\
echo "Redis TLS is ready!"\n\
\n\
# Set up some test data for persistence tests\n\
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key  set bun_valkey_tls_test_init "initialization_successful"\n\
\n\
# Create test hash\n\
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key  hset bun_valkey_tls_test_hash name "test_user" age "25" active "true"\n\
\n\
# Create test set\n\
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key  sadd bun_valkey_tls_test_set "red" "green" "blue"\n\
\n\
# Create test list\n\
redis-cli --tls --cert /etc/redis/certs/server.crt --key /etc/redis/certs/server.key  lpush bun_valkey_tls_test_list "first" "second" "third"\n\
' > /docker-entrypoint-initdb.d/init-redis.sh

# Make the script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-redis.sh

# Configure Redis
RUN echo "bind 0.0.0.0" > /etc/redis/redis.conf && \
    echo "protected-mode no" >> /etc/redis/redis.conf && \
    echo "appendonly yes" >> /etc/redis/redis.conf && \
    echo "tls-port 6380" >> /etc/redis/redis.conf && \
    echo "port 0" >> /etc/redis/redis.conf && \
    echo "tls-cert-file /etc/redis/certs/server.crt" >> /etc/redis/redis.conf && \
    echo "tls-key-file /etc/redis/certs/server.key" >> /etc/redis/redis.conf && \
    echo "tls-ca-cert-file /etc/redis/certs/server.crt" >> /etc/redis/redis.conf && \
    echo "unixsocket /tmp/redis.sock" >> /etc/redis/redis.conf && \
    echo "unixsocketperm 777" >> /etc/redis/redis.conf

# Expose TLS port and create volume for Unix socket
EXPOSE 6380
VOLUME /tmp

# Use custom entrypoint to run initialization script
CMD ["redis-server", "/etc/redis/redis.conf"]