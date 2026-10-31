#!/bin/bash
# POSTGRES_HOST_AUTH_METHOD=trust adds `host all all all trust`, which no replication connection matches.
echo "host replication all all trust" >> "$PGDATA/pg_hba.conf"
