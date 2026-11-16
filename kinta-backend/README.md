# 🚀 Kinta ERP — Complete deployment guide

## Architecture

```
Browser (Chrome/Firefox)
        ↕ HTTPS
Render.com (free server)
  ├── Node.js + Express (API)
  ├── SQLite (database)
  └── Kinta HTML (frontend)
```

---

## ✅ Step 1 — Prepare the files (5 min)

You need this `kinta-backend/` folder with:
```
kinta-backend/
├── src/
│   ├── server.js
│   ├── middleware/auth.js
│   └── routes/auth.js, api.js
├── database/schema.js
├── package.json
└── render.yaml
```

The server serves the frontend (`index.html`, `assets/`, `kinta-admin/`) from the repository root,
so deploy the whole repository, not only this folder. `render.yaml` already sets `rootDir: kinta-backend`.

---

## ✅ Step 2 — GitHub (10 min)

1. Create a free account on **github.com**
2. Create a new public or private repository named `kinta-erp`
3. Push the whole Kinta folder (the repository root, not only `kinta-backend/`)

---

## ✅ Step 3 — Deploy on Render.com (10 min)

1. Create an account on **render.com** (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account
4. Select the `kinta-erp` repository
5. Fill in:
   - **Name**: `kinta-erp`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node src/server.js`
6. Click **"Create Web Service"**

Render deploys automatically. After about 3 minutes:
- Your URL will be: `https://kinta-erp.onrender.com`
- Test: `https://kinta-erp.onrender.com/health`

---

## ✅ Step 4 — Frontend

Nothing to configure: the frontend is served by the same server and already calls the API
on the same address (`/api/...`).

---

## ✅ Step 5 — Create the team accounts

Once deployed, go to:
```
https://kinta-erp.onrender.com/api/auth/boutiques
```
You will see your shop's ID.

Then create the accounts through the Kinta interface → Settings → Users.

Or through the API (with a tool such as Postman):
```bash
# Create a cashier
curl -X POST https://kinta-erp.onrender.com/api/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"login":"cashier1","password":"cashier-1234","role":"cashier","nom":"Marie Ngoma"}'
```

---

## 📋 Default accounts

When you create your shop with `/api/auth/register`, you choose:
- **Admin username**: whatever you set
- **Admin password**: whatever you set

You then create the other accounts from the interface.

---

## 🔐 Roles and permissions

| Role | Access |
|------|-------|
| **admin** | Everything (settings, users, deletion) |
| **cashier** | Till, sales, messaging |
| **salesperson** | Read only (dashboard, products, customers) |
| **accountant** | Accounting, messaging |

---

## 📱 Mobile access

Once deployed, your team can connect from:
- **PC**: Chrome/Firefox browser → Render URL
- **Phone**: mobile browser → same URL
- **Tablet**: same

---

## ⚠️ Important notes

1. **Render free plan**: the server "falls asleep" after 15 min of inactivity. The first connection afterwards can take 30-60 seconds. To avoid this, use a paid plan (~$7/month).

2. **Backups**: SQLite data is stored on the Render disk (1 GB). Export JSON backups regularly from Settings.

3. **Security**: change `JWT_SECRET` in the Render environment variables (Settings → Environment).

---

## 🔧 Environment variables on Render

In Render → your service → Environment:

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `a_long_random_secret_here` |
| `DB_PATH` | `/data/kinta.db` |
| `PORT` | `3000` (automatic on Render) |

---

## 📞 Available API endpoints

| Method | URL | Description |
|---------|-----|-------------|
| POST | `/api/auth/register` | Create a new shop |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/dashboard` | Real-time stats |
| GET/POST | `/api/produits` | Products |
| GET/POST | `/api/ventes` | Sales |
| GET/POST | `/api/clients` | Customers |
| GET/POST | `/api/fournisseurs` | Suppliers |
| GET/POST | `/api/mouvements` | Treasury |
| GET/POST | `/api/depenses` | Expenses |
| GET/POST | `/api/employes` | Employees |
| GET/POST | `/api/retours` | Returns |
| GET/POST | `/api/commandes` | Supplier orders |
| GET/POST | `/api/journal` | Accounting journal |
| GET | `/health` | Server status |

---

## 🆘 Troubleshooting

- Check the logs in Render → Logs
- Open `/health` to see whether the server is online
- Check that the JWT token has not expired (8 hours by default)

**Kinta support contact**: contact@kinta-erp.com
