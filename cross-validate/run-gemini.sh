#!/bin/bash
# Run all 6 batches through Gemini CLI sequentially
# Using gemini 2.5 pro for best reasoning
cd /mnt/c/projects/e-naradomum-rpa/cross-validate

for i in 1 2 3 4 5 6; do
  echo "=== Gemini Batch $i starting ==="
  cat "batch-${i}-prompt.txt" | gemini -p "" -m gemini-2.5-pro > "gemini-batch-${i}-raw.txt" 2>&1
  echo "=== Gemini Batch $i done (exit: $?) ==="
done

echo "=== All Gemini batches complete ==="
