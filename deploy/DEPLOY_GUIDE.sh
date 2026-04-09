# ============================================
#  Cash Pilot — Digital Ocean Droplet Deployment
# ============================================
#
#  Prerequisites:
#    1. A Digital Ocean Droplet (Ubuntu 22.04+, $6/mo is fine)
#    2. A MongoDB instance (MongoDB Atlas free tier recommended)
#    3. A domain name (optional, but recommended for SSL)
#    4. Your code pushed to GitHub (use "Save to Github" in Emergent)
#
#  This guide gets you from zero to production in ~15 minutes.
#
# ============================================

# ────────────────────────────────────────────
# STEP 1: SSH into your Droplet
# ────────────────────────────────────────────

ssh root@YOUR_DROPLET_IP


# ────────────────────────────────────────────
# STEP 2: Install system dependencies
# ────────────────────────────────────────────

apt update && apt upgrade -y
apt install -y nginx python3 python3-pip python3-venv nodejs npm certbot python3-certbot-nginx git supervisor

# Install yarn
npm install -g yarn


# ────────────────────────────────────────────
# STEP 3: Clone your repo
# ────────────────────────────────────────────

cd /opt
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git cashpilot
cd cashpilot


# ────────────────────────────────────────────
# STEP 4: Setup Backend
# ────────────────────────────────────────────

cd /opt/cashpilot/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install only what's needed (use the production requirements)
pip install -r requirements.prod.txt

# Create production .env
cat > .env << 'EOF'
MONGO_URL="mongodb+srv://USERNAME:PASSWORD@cluster.mongodb.net"
DB_NAME="cashpilot"
CORS_ORIGINS="https://yourdomain.com"
EOF

# Test it runs
python3 -c "from server import app; print('Backend OK')"

deactivate


# ────────────────────────────────────────────
# STEP 5: Setup Frontend
# ────────────────────────────────────────────

cd /opt/cashpilot/frontend

# Create production .env
cat > .env << 'EOF'
REACT_APP_BACKEND_URL=https://yourdomain.com
EOF

# Install dependencies and build
yarn install
yarn build

# The build output is in /opt/cashpilot/frontend/build/


# ────────────────────────────────────────────
# STEP 6: Configure Supervisor (process manager)
# ────────────────────────────────────────────

cat > /etc/supervisor/conf.d/cashpilot.conf << 'EOF'
[program:cashpilot-backend]
command=/opt/cashpilot/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
directory=/opt/cashpilot/backend
user=root
autostart=true
autorestart=true
stderr_logfile=/var/log/cashpilot/backend.err.log
stdout_logfile=/var/log/cashpilot/backend.out.log
environment=PATH="/opt/cashpilot/backend/venv/bin"
EOF

mkdir -p /var/log/cashpilot
supervisorctl reread
supervisorctl update
supervisorctl start cashpilot-backend

# Verify backend is running
curl -s http://127.0.0.1:8001/api/ | python3 -c "import sys,json; print(json.load(sys.stdin))"


# ────────────────────────────────────────────
# STEP 7: Configure Nginx
# ────────────────────────────────────────────

cat > /etc/nginx/sites-available/cashpilot << 'NGINX'
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend (static build)
    root /opt/cashpilot/frontend/build;
    index index.html;

    # API routes → backend
    location /api/ {
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend SPA — all other routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/cashpilot /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx


# ────────────────────────────────────────────
# STEP 8: SSL with Let's Encrypt (if you have a domain)
# ────────────────────────────────────────────

certbot --nginx -d yourdomain.com
# Follow the prompts. Auto-renew is set up automatically.


# ────────────────────────────────────────────
# STEP 9: Verify everything
# ────────────────────────────────────────────

# Check backend
curl -s http://127.0.0.1:8001/api/
# → {"message": "Cash Piloting Dashboard API"}

# Check frontend (via nginx)
curl -s http://yourdomain.com | head -5
# → Should show HTML

# Check API through nginx
curl -s https://yourdomain.com/api/projection?scenario=likely&horizon=12 | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Cash now: {d[\"cash_now\"]}')"


# ────────────────────────────────────────────
# USEFUL COMMANDS
# ────────────────────────────────────────────

# View backend logs
tail -f /var/log/cashpilot/backend.err.log

# Restart backend after code changes
cd /opt/cashpilot && git pull
supervisorctl restart cashpilot-backend

# Rebuild frontend after code changes
cd /opt/cashpilot/frontend && yarn build

# Restart nginx
systemctl restart nginx
