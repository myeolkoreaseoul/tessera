#!/bin/bash
# Run all 6 batches through Codex CLI sequentially
cd /mnt/c/projects/e-naradomum-rpa/cross-validate

for i in 1 2 3 4 5 6; do
  echo "=== Codex Batch $i starting ==="
  cat "batch-${i}-prompt.txt" | codex exec - --skip-git-repo-check 2>&1 | tee "codex-batch-${i}-raw.txt"
  echo "=== Codex Batch $i done (exit: $?) ==="
done

echo "=== All Codex batches complete ==="
