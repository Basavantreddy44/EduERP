# Deploying EduERP (API + database on one server in India, web on Vercel)

Owner decision 2026-11-20: the API, background worker, Postgres and uploaded files run on **one Linux server in
India**; the web screens stay on **Vercel**. Everything on the server is started by `deploy/docker-compose.yml`
(rehearsed end-to-end on a fresh database on 2026-11-20: migrations, seed, API healthy, worker running, HTTPS login).

```
Browser ──HTTPS──► Vercel (web screens) ──/api/v1/* (proxy, same site)──► https://api.<your-domain>
                                                                            │  Caddy (HTTPS, auto certificate)
                                                                            ├─ API (NestJS)
                                                                            ├─ Worker (emails, hourly jobs)
                                                                            └─ Postgres 16 + uploaded files (volumes)
```

## What you need

| Item | Notes |
|---|---|
| A server | Ubuntu 24.04, **2 vCPU / 4 GB RAM**, 50 GB disk, region **Bengaluru** (DigitalOcean BLR1) or **Mumbai** (AWS Lightsail ap-south-1). About ₹1,800–2,000 a month. 2 GB works only with swap added. |
| A domain | e.g. `api.yourschool.in` for the API. You add one DNS record. |
| An email service | Any SMTP service (Amazon SES Mumbai, Zoho ZeptoMail, Brevo, or a Google Workspace mailbox). Without it, invites and password resets are not sent. |
| Access to the GitHub repo | The server pulls the code. Use a read-only deploy key (step 4). |

## Steps

### 1. Create the server
DigitalOcean → Create → Droplet → **Bangalore** → Ubuntu 24.04 LTS → Basic, Regular, 4 GB / 2 CPUs → add your SSH key → create. Note the **IP address**.

### 2. Point the API domain at it
At your domain registrar, add an **A record**: name `api` → value the server IP. (Check later with `nslookup api.yourschool.in`.)

### 3. Prepare the server (once)
```bash
ssh root@<server-ip>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh                    # Docker + Compose
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
timedatectl set-timezone Asia/Kolkata
```

### 4. Get the code
```bash
ssh-keygen -t ed25519 -f ~/.ssh/eduerp_deploy -N ""      # then add ~/.ssh/eduerp_deploy.pub on GitHub:
cat ~/.ssh/eduerp_deploy.pub                              #   repo → Settings → Deploy keys → Add (read-only)
printf 'Host github.com\n  IdentityFile ~/.ssh/eduerp_deploy\n' >> ~/.ssh/config
git clone git@github.com:Basavantreddy44/EduERP.git /opt/eduerp
```

### 5. Fill in the settings
```bash
cd /opt/eduerp/deploy
cp env.production.example .env
openssl rand -hex 24      # run four times: two database passwords, JWT secret (use 48+ chars), seed admin password
openssl rand -base64 32   # FIELD_ENCRYPTION_KEY
nano .env
```
Set `API_DOMAIN`, `WEB_ORIGIN` (your Vercel address), both database passwords, `JWT_ACCESS_SECRET`,
`FIELD_ENCRYPTION_KEY`, `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` and the `SMTP_*` lines.
**Keep a copy of `FIELD_ENCRYPTION_KEY` and the database passwords in a password manager** — PAN, bank numbers and
counselling notes cannot be read without the key.

### 6. Start it
```bash
cd /opt/eduerp/deploy
docker compose --env-file .env build                     # ~5–10 minutes the first time
docker compose --env-file .env up -d postgres
docker compose --env-file .env run --rm migrate          # tables, permissions, roles, job queue
docker compose --env-file .env up -d                     # API, worker, HTTPS
docker compose --env-file .env ps                        # all "Up"; api becomes "healthy"
```
Check from your laptop: `https://api.yourschool.in/api/v1/auth/me` should answer (a 404/401 message in JSON is
fine — it means the API is reachable over HTTPS).

### 7. Connect Vercel
Vercel → your project → Settings → Environment Variables → add **`API_ORIGIN` = `https://api.yourschool.in`**
(Production). Then **Redeploy** (the address is read during the build). Open the Vercel site and log in with the
seed admin; create the first institution from the platform screens.

### 8. Backups (do not skip)
```bash
crontab -e
30 1 * * * /opt/eduerp/deploy/backup.sh >> /opt/eduerp/deploy/backups/backup.log 2>&1
```
This keeps 14 nights of database and file backups on the server. **Also copy them off the server** weekly (e.g.
DigitalOcean Spaces in Bangalore, or download `/opt/eduerp/deploy/backups`). Restore test:
`docker compose exec -T postgres pg_restore -U eduerp_owner -d <empty-db> < backups/eduerp-<date>.dump`.

## Updating to a new version
```bash
cd /opt/eduerp && git pull
cd deploy
docker compose --env-file .env build
docker compose --env-file .env run --rm migrate         # safe to run every time
docker compose --env-file .env up -d
```
Vercel rebuilds the web screens by itself when `main` changes on GitHub.

## Good to know
- The database is not open to the internet; only the API, worker and backups reach it.
- The API runs as the limited database login (`eduerp_app`): row-level security keeps each institution's data apart.
- API documentation (`/api/docs`) is off on the server (`API_DOCS=off`).
- Online fee payment stays off (`PAYMENT_GATEWAY=off`) until the Razorpay keys are added to `.env`.
- Logs: `docker compose --env-file .env logs -f api` (or `worker`).
- The server starts empty. The demo school is not loaded there.
