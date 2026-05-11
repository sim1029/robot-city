#!/usr/bin/env bash
# Push runtime secrets from a .env file to Fly.io.
#
# Usage:
#   scripts/fly-set-secrets.sh [--dry-run] [--env-file PATH] [--app NAME] [--app-url URL]
#
# Defaults: --env-file .env  --app robot-city  --app-url https://<app>.fly.dev
# Localhost redirect URIs in the env file are rewritten to APP_URL before upload.

set -euo pipefail

ENV_FILE=".env"
APP="robot-city"
APP_URL=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=1; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --app)      APP="$2"; shift 2 ;;
    --app-url)  APP_URL="$2"; shift 2 ;;
    -h|--help)  sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$APP_URL" ]] && APP_URL="https://${APP}.fly.dev"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "env file not found: $ENV_FILE" >&2
  exit 1
fi

# Whitelist of secrets the runtime actually needs (PORT/DB_PATH/NODE_ENV are in fly.toml).
REQUIRED=(
  DISCORD_CLIENT_ID
  DISCORD_CLIENT_SECRET
  DISCORD_BOT_TOKEN
  DISCORD_REDIRECT_URI
  DISCORD_LOGIN_REDIRECT_URI
  OWNER_DISCORD_ID
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REDIRECT_URI
  VAULT_PASSPHRASE
)

# Provider keys — pushed only if present in $ENV_FILE. Vault-stored keys take
# precedence at runtime; these act as a fallback (see src/vault/index.ts).
OPTIONAL=(
  ANTHROPIC_API_KEY
  OPENAI_API_KEY
  GOOGLE_API_KEY
)

# Read KEY=VALUE from $ENV_FILE. Strips surrounding quotes. Returns "" if not set.
read_env_var() {
  local needle="$1"
  awk -v key="$needle" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      eq = index($0, "=")
      if (eq == 0) next
      k = substr($0, 1, eq - 1)
      gsub(/[[:space:]]/, "", k)
      if (k != key) next
      v = substr($0, eq + 1)
      sub(/^"/, "", v); sub(/"$/, "", v)
      sub(/^'\''/, "", v); sub(/'\''$/, "", v)
      print v
      exit
    }
  ' "$ENV_FILE"
}

MISSING=()
ARGS=()
SKIPPED_OPTIONAL=()
for k in "${REQUIRED[@]}"; do
  v="$(read_env_var "$k")"
  if [[ -z "$v" ]]; then
    MISSING+=("$k")
    continue
  fi
  if [[ "$k" == *REDIRECT_URI* ]]; then
    v="${v//http:\/\/localhost:3000/$APP_URL}"
  fi
  ARGS+=("$k=$v")
done

for k in "${OPTIONAL[@]}"; do
  v="$(read_env_var "$k")"
  if [[ -z "$v" ]]; then
    SKIPPED_OPTIONAL+=("$k")
    continue
  fi
  ARGS+=("$k=$v")
done

if (( ${#MISSING[@]} > 0 )); then
  echo "Missing required vars in $ENV_FILE:" >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  echo >&2
  echo "Add them to $ENV_FILE and re-run. For VAULT_PASSPHRASE, a strong default is:" >&2
  echo "  VAULT_PASSPHRASE=\$(openssl rand -base64 32)" >&2
  exit 1
fi

echo "App:      $APP"
echo "App URL:  $APP_URL"
echo "Env file: $ENV_FILE"
echo "Vars:     ${#ARGS[@]} (${#REQUIRED[@]} required + $((${#OPTIONAL[@]} - ${#SKIPPED_OPTIONAL[@]})) optional)"
if (( ${#SKIPPED_OPTIONAL[@]} > 0 )); then
  echo "Skipped:  ${SKIPPED_OPTIONAL[*]} (not set in $ENV_FILE — vault-stored keys required at runtime)"
fi
echo

if (( DRY_RUN )); then
  echo "[dry-run] would run: flyctl secrets set ... --app $APP"
  for a in "${ARGS[@]}"; do
    name="${a%%=*}"
    val="${a#*=}"
    case "$name" in
      *REDIRECT_URI*) printf '  %s=%s\n' "$name" "$val" ;;
      *)              printf '  %s=<redacted, %d chars>\n' "$name" "${#val}" ;;
    esac
  done
  exit 0
fi

flyctl secrets set "${ARGS[@]}" --app "$APP"
