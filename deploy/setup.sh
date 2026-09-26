#!/usr/bin/env bash
# Owner: D. One-time server setup. Run ON the new Vultr server, as root (Ubuntu 22.04 or 24.04).
#
#   From your laptop, in the repo folder:
#     scp -r deploy root@<server-ip>:/root/
#     ssh root@<server-ip> 'bash /root/deploy/setup.sh'
#
# No domain? It uses <ip>.sslip.io (free wildcard DNS) and still gets a real HTTPS certificate.
# Own domain?  DOMAIN=play.example.com bash /root/deploy/setup.sh   (its A record must already point at this server)
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

IP="${SERVER_IP:-$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')}"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"
echo "==> server ip: $IP"
echo "==> site address: https://$DOMAIN"

echo "==> installing packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw rsync debian-keyring debian-archive-keyring apt-transport-https

# Node 22 (skipped if a recent Node is already there)
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy: web server that fetches and renews the HTTPS certificate on its own
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> creating the app user and folders"
id composure >/dev/null 2>&1 || useradd --system --home /opt/composure --shell /usr/sbin/nologin composure
mkdir -p /opt/composure /var/lib/composure/spool
if [ ! -f /opt/composure/.env ] && [ -f "$HERE/env.production.example" ]; then
  cp "$HERE/env.production.example" /opt/composure/.env
  echo "==> created /opt/composure/.env (empty). Fill it by running  ./deploy/deploy.sh --env  from your laptop."
fi
echo "$DOMAIN" > /opt/composure/.domain
chown -R composure:composure /opt/composure /var/lib/composure
[ -f /opt/composure/.env ] && chmod 600 /opt/composure/.env

echo "==> installing the services"
cp "$HERE/composure.service" /etc/systemd/system/composure.service
cp "$HERE/composure-netplay.service" /etc/systemd/system/composure-netplay.service
systemctl daemon-reload
systemctl enable composure composure-netplay     # they start when deploy.sh uploads the code

echo "==> configuring HTTPS"
sed "s/{{DOMAIN}}/$DOMAIN/g" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "==> firewall: SSH + web only (the app itself is only reachable through Caddy)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat <<DONE

Setup finished.
Next, from your laptop, in the repo folder:
  DEPLOY_HOST=root@$IP ./deploy/deploy.sh --env --init-db
Then open https://$DOMAIN
DONE
