# Dockerfile for Valkey/Redis testing
FROM redis:7-alpine

# Install bash for initialization scripts
RUN apk add --no-cache bash

# Create initialization script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Wait for Redis to start\n\
until redis-cli ping; do\n\
  echo "Waiting for Redis to start..."\n\
  sleep 1\n\
done\n\
\n\
echo "Redis is ready!"\n\
\n\
# Set up some test data for persistence tests\n\
redis-cli set bun_valkey_test_init "initialization_successful"\n\
\n\
# Create test hash\n\
redis-cli hset bun_valkey_test_hash name "test_user" age "25" active "true"\n\
\n\
# Create test set\n\
redis-cli sadd bun_valkey_test_set "red" "green" "blue"\n\
\n\
# Create test list\n\
redis-cli lpush bun_valkey_test_list "first" "second" "third"\n\
' > /docker-entrypoint-initdb.d/init-redis.sh

# Make the script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-redis.sh

# Configure Redis
RUN echo "bind 0.0.0.0" > /etc/redis/redis.conf && \
    echo "protected-mode no" >> /etc/redis/redis.conf && \
    echo "appendonly yes" >> /etc/redis/redis.conf

# Expose Redis port
EXPOSE 6379

# Use custom entrypoint to run initialization script
CMD ["redis-server", "/etc/redis/redis.conf"]