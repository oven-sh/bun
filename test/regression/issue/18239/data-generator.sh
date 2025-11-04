#!/bin/bash

# Test data generator script
# Sends data with delays to simulate real-time input

echo "Generating test data with 200ms delay..."

for i in {1..3}; do
    echo "Line $i - $(date)"
    sleep 0.2
done

echo "All data sent!"