# Local pre-commit security checks (run before committing)
# Usage: bash scripts/security-local.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ [1/3] TypeScript typecheck"
npm run typecheck

echo "▸ [2/3] Secret scan (gitleaks)"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-banner --exit-code 1
else
  echo "  (gitleaks not installed — skipping; install with: brew install gitleaks)"
fi

echo "▸ [3/3] npm audit (high severity fails)"
npm audit --audit-level=high

echo "✓ All local security checks passed."