# SKYFIT ZONE — Frontend + Backend

Gym membership platform with 4 pricing tiers, functional checkout (5-step flow) and live progress dashboard.

## Live
- Frontend: http://localhost:4000  (served by backend static)
- Backend API: http://localhost:4000/api

Direct frontend folder: `skyfit-zone/frontend/index.html` (works standalone with localStorage fallback if backend is offline)

## Navigation
Home | Workouts | Trainers | Transformation | Memberships | Progress | Contact

## Pricing (as specified)
| Category | Plan | Price | Duration |
|---|---|---|---|
| **Normal Gym** | Monthly | ₹1,500 | 30 days |
| | Quarterly | ₹4,000 | 90 days — Save ₹500 |
| | Half-Yearly | ₹7,000 | 180 days |
| | Yearly | ₹12,000 | 365 days |
| **Personal Training** | Starter 8 Sessions | ₹4,000 | 60 days |
| | Pro 16 Sessions | ₹7,000 | 90 days |
| | Elite 30 Sessions | ₹12,000 | 180 days |
| **Transformation** | 12-WEEK PREMIUM | **₹15,999** | 84 days |
| **SKYFIT ELITE** | Yearly Premium | ₹24,999 | 365 days |

All plans auto-compute `expires = startDate + durationDays` and `daysRemaining`.

## Functional Flow
`Select plan → Enter details → Choose start date → Payment → Membership activated`
After activation, **Progress dashboard** shows:

```
ACTIVE MEMBERSHIP
Transformation Program — 12-WEEK TRANSFORMATION
Started: 21 Aug 2026
Expires: 13 Nov 2026
84 days remaining (54 days after 30 days elapsed)
Progress bar + receipt + cancel
```

## Tech
- **Frontend:** Vanilla HTML/CSS/JS (no build), responsive, `frontend/app.js` handles tabs, modal, fetch
- **Backend:** Node + Express + CORS + JSON file DB (`backend/db.json`)
- Offline fallback: if API unreachable, membership is saved to localStorage and still shows on dashboard

## API
```
GET  /api/health
GET  /api/plans
GET  /api/memberships
GET  /api/memberships/by-email/:email
GET  /api/memberships/:id
POST /api/payment/mock   {method:'card'|'upi'|'cash', cardNumber, expiry, cvv, upi}
POST /api/checkout       {planId, member:{name,email,phone}, startDate, payment:{method,transactionId}}
DELETE /api/memberships/:id
```

Example checkout:
```bash
curl -X POST http://localhost:4000/api/checkout -H "Content-Type: application/json" -d "{\"planId\":\"transform-12w\",\"member\":{\"name\":\"Karthik\",\"email\":\"k@demo.in\",\"phone\":\"9000012345\"},\"startDate\":\"2026-08-21\",\"payment\":{\"method\":\"card\",\"transactionId\":\"TXN123\"}}"
```

## Run
```bash
cd skyfit-zone/backend
npm install
npm start   # http://localhost:4000
# open http://localhost:4000 in browser
```

To stop: `Get-Process node | Stop-Process` or Ctrl+C in terminal.

## Project Structure
```
skyfit-zone/
  frontend/  # source frontend (also copied to public/)
    index.html
    style.css
    app.js
  public/    # served by Express
  backend/
    server.js
    package.json
    db.json
```

## Demo Account
Pre-seeded test membership: `test@skyfit.test` — 12-Week Transformation, 21 Aug 2026 → 13 Nov 2026.

Use **Lookup by email** on Progress section to load it.
