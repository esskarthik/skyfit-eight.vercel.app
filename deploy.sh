#!/bin/bash
# SKYFIT ZONE — Deploy Bash (Render / Railway / Vercel / Docker / VPS)
# Usage:
#   bash deploy.sh --check            # verify ready
#   bash deploy.sh --render           # guide for Render
#   bash deploy.sh --vercel           # deploy to Vercel
#   bash deploy.sh --docker           # build & run Docker locally
#   bash deploy.sh --vps user@IP      # deploy to your VPS via SSH + PM2
#   bash deploy.sh --github           # init git + push to GitHub
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORT="${PORT:-4000}"

check() {
  echo "🔍 Checking deploy readiness..."
  [ -f backend/server.js ] || { echo "❌ backend/server.js missing"; exit 1; }
  [ -f frontend/index.html ] || { echo "❌ frontend/index.html missing"; exit 1; }
  [ -f backend/package.json ] || { echo "❌ backend/package.json missing"; exit 1; }
  grep -q "OPENROUTER" backend/server.js && echo "✅ AI endpoint present"
  node -e "require('./backend/package.json')" && echo "✅ package.json OK"
  echo "✅ Frontend assets: $(ls frontend/assets 2>/dev/null | wc -l) files"
  echo "✅ All checks passed"
}

github_push() {
  check
  if [ ! -d .git ]; then
    git init
    git branch -M main
    cat > .gitignore <<'GI'
node_modules/
backend/node_modules/
backend/db.json
backend/.env
*.log
.DS_Store
GI
    git add .
    git commit -m "SKYFIT ZONE - deploy ready"
    echo "➡️  Create GitHub repo then:"
    echo "   gh repo create skyfit-zone --public --source=. --remote=origin --push"
    echo "   OR manually: git remote add origin https://github.com/<you>/skyfit-zone.git && git push -u origin main"
  else
    git add .
    git commit -m "deploy $(date +%Y-%m-%d_%H:%M)" || true
    git push || echo "Add remote first: git remote add origin <url>"
  fi
}

render() {
  echo "━━━ Render Deploy (recommended, free) ━━━"
  echo "1. Push to GitHub: bash deploy.sh --github"
  echo "2. Go to https://dashboard.render.com → New → Web Service → Connect repo skyfit-zone"
  echo "   Build:  npm install --prefix backend"
  echo "   Start:  node backend/server.js"
  echo "   Env:    NODE_ENV=production, OPENROUTER_API_KEY=sk-or-..."
  echo "3. Deploy — Render auto-detects render.yaml"
  echo "Docs: https://render.com/docs"
  check
}

vercel() {
  echo "━━━ Vercel Deploy ━━━"
  if ! command -v vercel >/dev/null 2>&1; then npm i -g vercel; fi
  # Vercel needs frontend + api; we deploy as single Express app via vercel.json
  cat > vercel.json <<'VJ'
{
  "version": 2,
  "builds": [{ "src": "backend/server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "backend/server.js" }]
}
VJ
  vercel --prod --cwd .
}

docker_run() {
  echo "━━━ Docker Build & Run (local or any VPS) ━━━"
  docker build -t skyfit-zone .
  docker rm -f skyfit-zone 2>/dev/null || true
  docker run -d --name skyfit-zone -p $PORT:4000 \
    -e NODE_ENV=production \
    -e OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    skyfit-zone
  echo "✅ Running at http://localhost:$PORT"
  docker logs -f skyfit-zone | head -n 50
}

vps_deploy() {
  HOST="$1"
  [ -z "$HOST" ] && { echo "Usage: bash deploy.sh --vps user@IP"; exit 1; }
  echo "━━━ VPS Deploy to $HOST via PM2 ━━━"
  # Send files
  rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'backend/db.json' ./ "$HOST:~/skyfit-zone/"
  ssh "$HOST" bash <<'EOSSH'
    set -e
    cd ~/skyfit-zone
    npm install --prefix backend --omit=dev
    npm i -g pm2 2>/dev/null || sudo npm i -g pm2 || true
    pm2 delete skyfit-zone 2>/dev/null || true
    # create .env if missing
    [ -f backend/.env ] || echo "PORT=4000" > backend/.env
    pm2 start backend/server.js --name skyfit-zone --env production
    pm2 save
    pm2 startup 2>/dev/null || true
    echo "✅ Deployed on VPS — pm2 ls"
    pm2 ls
EOSSH
}

case "$1" in
  --check) check ;;
  --github) github_push ;;
  --render) render ;;
  --vercel) vercel ;;
  --docker) docker_run ;;
  --vps) vps_deploy "$2" ;;
  *) echo "Usage: bash deploy.sh [--check|--github|--render|--vercel|--docker|--vps user@IP]"
     echo "  --check   Verify project is deploy-ready"
     echo "  --github  Init git & push to GitHub"
     echo "  --render  Guide for Render (free, easiest)"
     echo "  --vercel  Deploy to Vercel now"
     echo "  --docker  Build Docker & run locally"
     echo "  --vps     Deploy to VPS: bash deploy.sh --vps root@YOUR_IP"
     ;;
esac
