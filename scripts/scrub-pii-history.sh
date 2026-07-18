#!/usr/bin/env bash
#
# Purge customer PII and business documents from ALL git history.
#
# The files below were removed from the working tree, but every clone still
# carries them in history until this rewrite runs. Run this ONCE, locally,
# after the removal branch has merged to main.
#
# BEFORE RUNNING:
#   1. Save copies of the files somewhere outside git (Google Drive) — after
#      the rewrite they are unrecoverable from the repo:
#        git show 'main~1:Norr AI - Evan Knutson Contract.pdf' > ...   (etc.)
#   2. Install git-filter-repo:  brew install git-filter-repo  (or pipx)
#   3. Close any open PRs — a history rewrite orphans them.
#
# AFTER RUNNING:
#   - Every other clone of the repo must be re-cloned (not pulled).
#   - GitHub may retain cached views briefly; contact support to purge if
#     it matters, or just let them expire.

set -euo pipefail

REPO_URL="git@github.com:egachuu-jpg/norrai.git"
WORKDIR="$(mktemp -d)"

PATHS_FILE="$WORKDIR/paths.txt"
cat > "$PATHS_FILE" <<'EOF'
docs/clients/michelle_contacts_combined.csv
docs/clients/evan_contacts_combined.csv
docs/New Lead Email - Tina Jore.eml
Norr AI - Evan Knutson Contract.pdf
Norr AI - Michelle Jasinski Contract.pdf
Contract Generator — Norr AI.pdf
norrai_master_context.docx
EOF

echo "This will REWRITE ALL HISTORY of $REPO_URL and force-push main."
echo "Files to be purged from every commit:"
sed 's/^/  - /' "$PATHS_FILE"
read -rp "Have you saved copies of these files outside git? (yes/no) " answer
[ "$answer" = "yes" ] || { echo "Aborting."; exit 1; }

# filter-repo requires a fresh clone
git clone --no-local "$REPO_URL" "$WORKDIR/repo"
cd "$WORKDIR/repo"

git filter-repo --invert-paths --paths-from-file "$PATHS_FILE"

# filter-repo strips the origin remote as a safety measure; re-add and push
git remote add origin "$REPO_URL"
git push origin --force --all
git push origin --force --tags

echo
echo "Done. Now re-clone your local copy — do NOT pull into an old clone."
