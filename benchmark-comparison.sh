#!/bin/bash

# Benchmark comparison script for Cockatiel
# This script runs benchmarks on the current branch and a base branch to compare performance

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_BRANCH="${1:-master}"
CURRENT_BRANCH=$(git branch --show-current)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="benchmark-results"

echo -e "${BLUE}=== Cockatiel Benchmark Comparison ===${NC}"
echo "Base branch: $BASE_BRANCH"
echo "Current branch: $CURRENT_BRANCH"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Stash any uncommitted changes
echo -e "${BLUE}Stashing uncommitted changes...${NC}"
git stash push -m "benchmark-comparison-stash-$TIMESTAMP"

# Function to run benchmarks
run_benchmarks() {
    local branch=$1
    local output_file=$2
    
    echo -e "${BLUE}Running benchmarks on branch: $branch${NC}"
    
    # For base branch, we need to ensure mocha is still there since we're replacing it with vitest
    if [ "$branch" = "$BASE_BRANCH" ]; then
        # Check if package.json has vitest or mocha
        if grep -q "vitest" package.json; then
            npm run bench > "$output_file" 2>&1 || true
        else
            # Create a simple benchmark using existing test infrastructure
            echo "No benchmark script found. Creating baseline measurements..." > "$output_file"
            
            # Run a simple Node.js script to measure baseline performance
            node -e "
const { performance } = require('perf_hooks');

// Test direct function call
const iterations = 1000000;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
    const fn = () => 42;
    fn();
}
const end = performance.now();
console.log('Direct function call:', ((end - start) / iterations * 1000000).toFixed(2), 'ns per call');

// Test with promise
async function testAsync() {
    const start = performance.now();
    for (let i = 0; i < 100000; i++) {
        await Promise.resolve(42);
    }
    const end = performance.now();
    console.log('Promise resolution:', ((end - start) / 100000 * 1000000).toFixed(2), 'ns per call');
}

testAsync();
" >> "$output_file" 2>&1
        fi
    else
        npm run bench > "$output_file" 2>&1 || true
    fi
}

# Checkout base branch and run benchmarks
echo -e "${BLUE}Checking out base branch: $BASE_BRANCH${NC}"
git checkout "$BASE_BRANCH"

# Install dependencies for base branch
echo -e "${BLUE}Installing dependencies for base branch...${NC}"
npm ci

# Build the project
echo -e "${BLUE}Building base branch...${NC}"
npm run compile || true

# Run benchmarks on base branch
BASE_RESULTS="$RESULTS_DIR/bench-$BASE_BRANCH-$TIMESTAMP.txt"
run_benchmarks "$BASE_BRANCH" "$BASE_RESULTS"

# Checkout current branch and run benchmarks
echo -e "${BLUE}Checking out current branch: $CURRENT_BRANCH${NC}"
git checkout "$CURRENT_BRANCH"

# Install dependencies for current branch
echo -e "${BLUE}Installing dependencies for current branch...${NC}"
npm ci

# Build the project
echo -e "${BLUE}Building current branch...${NC}"
npm run compile || true

# Run benchmarks on current branch
CURRENT_RESULTS="$RESULTS_DIR/bench-$CURRENT_BRANCH-$TIMESTAMP.txt"
run_benchmarks "$CURRENT_BRANCH" "$CURRENT_RESULTS"

# Compare results
echo ""
echo -e "${BLUE}=== Benchmark Results ===${NC}"
echo -e "${GREEN}Base branch ($BASE_BRANCH):${NC}"
cat "$BASE_RESULTS" | grep -E "(ops/sec|ns per|ms)" | head -20 || echo "No benchmark data available"

echo ""
echo -e "${GREEN}Current branch ($CURRENT_BRANCH):${NC}"
cat "$CURRENT_RESULTS" | grep -E "(ops/sec|ns per|ms)" | head -20 || echo "No benchmark data available"

# Create a simple comparison report
COMPARISON_REPORT="$RESULTS_DIR/comparison-$TIMESTAMP.md"
cat > "$COMPARISON_REPORT" << EOF
# Benchmark Comparison Report

Date: $(date)
Base Branch: $BASE_BRANCH
Current Branch: $CURRENT_BRANCH

## Summary

This report compares the performance between the base branch and current branch.

## Raw Results

### Base Branch ($BASE_BRANCH)

\`\`\`
$(cat "$BASE_RESULTS")
\`\`\`

### Current Branch ($CURRENT_BRANCH)

\`\`\`
$(cat "$CURRENT_RESULTS")
\`\`\`

## Notes

- Results may vary based on system load and hardware
- Run multiple times for more accurate comparisons
- Focus on relative performance differences rather than absolute numbers
EOF

echo ""
echo -e "${BLUE}=== Comparison Complete ===${NC}"
echo "Results saved to:"
echo "  - Base: $BASE_RESULTS"
echo "  - Current: $CURRENT_RESULTS"
echo "  - Report: $COMPARISON_REPORT"

# Restore stashed changes
echo ""
echo -e "${BLUE}Restoring stashed changes...${NC}"
git stash pop "stash@{0}" 2>/dev/null || echo "No stashed changes to restore"

echo ""
echo -e "${GREEN}Done!${NC}"