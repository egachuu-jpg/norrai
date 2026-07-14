#!/usr/bin/env bash
#
# Secrets audit for the Hermes VPS (Decisions Pending, Phase C).
# Run after initial setup and after every Hermes upgrade.
#
# The VPS is permitted to hold exactly three secrets:
#   ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, COS_API_TOKEN
# Anything else that looks like a credential is a finding.
# Exit 0 = clean, exit 1 = findings (fail closed: any scan error is a failure).

set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SEARCH_PATHS=("/home" "/root" "/etc" "/opt")
FINDINGS="$(mktemp)"
trap 'rm -f "$FINDINGS"' EXIT

# name|regex — patterns for credentials that must NOT exist on this box
PATTERNS=(
  'Google OAuth token|ya29\.[0-9A-Za-z_-]+'
  'Google API key|AIza[0-9A-Za-z_-]{35}'
  'AWS access key|AKIA[0-9A-Z]{16}'
  'Private key block|BEGIN [A-Z ]*PRIVATE KEY'
  'Slack token|xox[baprs]-[0-9A-Za-z-]+'
  'SendGrid key|SG\.[0-9A-Za-z_-]{22}\.'
  'Twilio account SID|AC[0-9a-f]{32}'
  'Plaid token|access-(sandbox|production)-'
)

is_whitelisted_path() {
  case "$1" in
    "$HERMES_HOME"*) return 0 ;;
    *) return 1 ;;
  esac
}

scan_files() {
  local name="$1" regex="$2" file
  # -I skips binaries; -size cap keeps it fast; prune pseudo-fs + node_modules
  while IFS= read -r file; do
    is_whitelisted_path "$file" && continue
    printf '%s: [%s]\n' "$file" "$name" >> "$FINDINGS"
  done < <(
    find "${SEARCH_PATHS[@]}" \
      \( -path '*/proc/*' -o -path '*/sys/*' -o -path '*/node_modules/*' \) -prune \
      -o -type f -size -10M -print 2>/dev/null \
      | xargs -r grep -IlE "$regex" 2>/dev/null || true
  )
}

# 1) Filesystem: hard credential patterns
for entry in "${PATTERNS[@]}"; do
  scan_files "${entry%%|*}" "${entry#*|}"
done

# 2) Filesystem: .env-style files with secret-shaped vars beyond the three permitted
while IFS= read -r file; do
  is_whitelisted_path "$file" && continue
  while IFS= read -r line; do
    printf '%s: [.env secret var] %s\n' "$file" "${line%%=*}=<redacted>" >> "$FINDINGS"
  done < <(grep -hE '^[A-Za-z_]*_(SECRET|KEY|TOKEN|PASSWORD)=..*' "$file" 2>/dev/null \
             | grep -vE '^(ANTHROPIC_API_KEY|TELEGRAM_BOT_TOKEN|COS_API_TOKEN)=' || true)
done < <(
  find "${SEARCH_PATHS[@]}" \
    \( -path '*/proc/*' -o -path '*/sys/*' -o -path '*/node_modules/*' \) -prune \
    -o -type f -name '.env*' -print 2>/dev/null
)

# 3) Process environment: secret-shaped vars beyond the three permitted
while IFS= read -r line; do
  printf 'env: [environment secret var] %s\n' "${line%%=*}=<redacted>" >> "$FINDINGS"
done < <(env | grep -E '^[A-Za-z_]*_(SECRET|KEY|TOKEN|PASSWORD)=..*' \
           | grep -vE '^(ANTHROPIC_API_KEY|TELEGRAM_BOT_TOKEN|COS_API_TOKEN)=' || true)

if [ -s "$FINDINGS" ]; then
  echo "AUDIT FAILED — $(wc -l < "$FINDINGS") finding(s) beyond the permitted secrets:"
  echo "---"
  sort -u "$FINDINGS"
  echo "---"
  exit 1
fi

echo "AUDIT CLEAN — only permitted secrets found"
exit 0
