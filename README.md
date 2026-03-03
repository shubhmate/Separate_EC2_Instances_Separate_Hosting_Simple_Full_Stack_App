# Separate EC2 Instances — Simple Full-Stack App

A beginner → mid-level friendly guide to deploying a simple full‑stack app where the frontend (Express or static build) and the backend (Flask) run on separate Amazon EC2 instances. This README explains what to do, why each step matters, and gives copy-paste-friendly Nginx configurations for both servers.

---

## Project overview

- Frontend: Express (Node) or static build files (React/Vue/other). Served by Nginx or proxied by Nginx to an Express process.
- Backend: Flask (Python) exposing a JSON API. Served by gunicorn (or uWSGI) behind Nginx as a reverse proxy.
- Why separate instances? Independent scaling, independent deploys, and a realistic production-like setup.

---

## Prerequisites

- AWS account and basic familiarity with EC2 and SSH.
- Two EC2 instances (Ubuntu 20.04/22.04 recommended): one for frontend, one for backend.
- Node.js & npm (frontend), Python 3.8+ and pip (backend).
- SSH access to EC2 instances and the ability to modify security groups (open ports 22, 80, 443).
- (Recommended) A domain or subdomain pointing to each instance's public IP for TLS.

---

## Example project structure

- frontend/        — Express app or built static files (build/ or dist/)
- backend/         — Flask app (app.py, requirements.txt)
- README.md

Adjust paths in the commands below to match your repo.

---

## Quick local test (before deploying)

Frontend (example):
```
cd frontend
npm install
npm run build    # if it builds to build/ or dist/
npm start        # runs Express dev server (if present)
```

Backend (example):
```
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export FLASK_APP=app.py
flask run --host=0.0.0.0 --port=8000
```

Check:
- Frontend: http://localhost:3000 (or configured port)
- Backend: http://localhost:8000/api/

---

## Deploy to EC2 — high level steps

1. Launch two EC2 instances (Ubuntu). SSH into them.
2. Install system updates and dependencies:
   - Frontend instance: Node.js, npm (and build tools).
   - Backend instance: Python, pip, virtualenv; install gunicorn.
3. Clone your repo or copy only relevant code to each instance.
4. Build frontend (if applicable) and place static files into a directory like `/var/www/frontend`.
5. Start backend with gunicorn, bind to localhost (127.0.0.1:8000).
6. Configure Nginx on each instance (detailed below).
7. (Optional) Configure systemd service files to keep processes running and enable HTTPS with Certbot.

---

## Install Nginx (Ubuntu)

In both instances:
```
sudo apt update
sudo apt install -y nginx
sudo systemctl enable --now nginx
sudo ufw allow 'Nginx Full'   # opens 80 and 443
```

Check:
```
sudo nginx -t
sudo systemctl status nginx
```

---

## Frontend: Nginx configuration (serve static SPA or proxy to Express)

Option A — Static files (recommended for SPAs):
- Assume build output at `/var/www/frontend`

Create `/etc/nginx/sites-available/frontend.conf`:
```nginx
server {
    listen 80;
    server_name example.com;  # replace with your domain or instance IP

    root /var/www/frontend;   # path to your built static files
    index index.html;

    # Single Page App: serve index.html for unknown routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.{css|js|jpg|jpeg|gif|png|svg|ico|woff2?|ttf}$ {
        expires 30d;
        add_header Cache-Control "public";
    }

    # Basic gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text_xml application_xml;
}
```

Enable & reload:
```
sudo ln -s /etc/nginx/sites-available/frontend.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Option B — Frontend is an Express server (proxy to Node):
```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;  # Express port
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Notes:
- `try_files $uri $uri/ /index.html` preserves client-side routing.
- Replace `example.com` and ports with your values.

---

## Backend: Nginx reverse proxy to Flask (gunicorn)

Run gunicorn on the backend instance bound to localhost (example):
```
cd ~/backend
source venv/bin/activate
gunicorn -w 3 -b 127.0.0.1:8000 app:app
```

Create `/etc/nginx/sites-available/backend.conf`:
```nginx
upstream backend_app {
    server 127.0.0.1:8000;
    # Add more backend servers here if scaling horizontally
}

server {
    listen 80;
    server_name api.example.com;  # replace with your API domain or IP

    location / {
        proxy_pass http://backend_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Optional: tune timeouts for long requests
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Basic security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
}
```

Enable & reload:
```
sudo ln -s /etc/nginx/sites-available/backend.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Why bind gunicorn to 127.0.0.1? So Nginx proxies from the public port (80/443) to a private port bound to localhost — improves security.

---

## When frontend and backend are on different origins (CORS)

If frontend (example.com) and backend (api.example.com) are different, enable CORS in Flask:

Example using flask-cors:
```python
from flask import Flask
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "https://example.com"}})
```
- Replace `https://example.com` with your frontend origin.
- For local testing, include `http://localhost:3000`.

---

## Proxy /api through the frontend (optional)

If you want the browser to only talk to the frontend origin (same-origin requests), add on frontend Nginx:
```nginx
location /api/ {
    proxy_pass http://BACKEND_PUBLIC_IP/;   # or http://api.example.com/
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```
This forwards `/api` calls from the frontend domain to the backend, making deployment simpler for clients.

---

## HTTPS with Certbot (Let’s Encrypt) — recommended

On each instance (requires a real domain):
```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com   # follow prompts
```
Certbot will update your Nginx config and install certificates. Use domains for TLS; IP addresses can't get Let's Encrypt certs.

---

## Process management (keep services alive)

Create systemd service for gunicorn (backend):
`/etc/systemd/system/gunicorn.service`:
```ini
[Unit]
Description=gunicorn daemon
After=network.target

[Service]
User=ubuntu
Group=www-data
WorkingDirectory=/home/ubuntu/backend
Environment="PATH=/home/ubuntu/backend/venv/bin"
ExecStart=/home/ubuntu/backend/venv/bin/gunicorn -w 3 -b 127.0.0.1:8000 app:app

[Install]
WantedBy=multi-user.target
```
Enable & start:
```
sudo systemctl daemon-reload
sudo systemctl enable --now gunicorn
sudo journalctl -u gunicorn -f
```

For Node/Express frontend you can use PM2:
```
sudo npm install -g pm2
pm2 start npm --name frontend -- start
pm2 startup
pm2 save
```

---

## Troubleshooting checklist

- Nginx config test: `sudo nginx -t`
- Nginx logs: `/var/log/nginx/error.log` and `/var/log/nginx/access.log`
- Systemd logs: `sudo journalctl -u gunicorn -f` (or `pm2 logs`)
- Quick server curl checks:
  - From backend instance: `curl -I http://127.0.0.1:8000/`
  - From frontend instance (if proxying): `curl -I http://127.0.0.1/` or to backend IP
- 502 Bad Gateway? Usually gunicorn not running, or bound to different address/port.
- CORS errors in browser console? Add origin to Flask CORS or proxy `/api` through frontend.

---

## Security notes (short)

- Keep systems and packages updated.
- Use least privilege users (do not run apps as root).
- Only open needed ports in EC2 security groups (22 for SSH, 80/443 for web).
- Use HTTPS in production.
