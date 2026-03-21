#!/usr/bin/env bash
# One-time registry htpasswd initialisation
# Run on the server before starting the registry:
#   bash registry/setup.sh
set -e

mkdir -p registry/auth

REGISTRY_USER="${REGISTRY_USER:-leadman}"

read -rsp "Registry password for user '$REGISTRY_USER': " REGISTRY_PASS
echo

if [[ -z "$REGISTRY_PASS" ]]; then
  echo "Password cannot be empty." >&2
  exit 1
fi

docker run --rm httpd:2.4-alpine \
  htpasswd -Bbn "$REGISTRY_USER" "$REGISTRY_PASS" \
  > registry/auth/htpasswd

chmod 600 registry/auth/htpasswd

echo "htpasswd written to registry/auth/htpasswd"
echo ""
echo "Next steps:"
echo "  1. Add GitHub Secrets: REGISTRY_USER=$REGISTRY_USER  REGISTRY_PASSWORD=***"
echo "  2. docker compose -f docker-compose.registry.yml up -d"
echo "  3. curl -sk https://192.168.10.100:5000/v2/"
