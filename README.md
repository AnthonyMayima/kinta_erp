# Kinta — web version

This version splits the original HTML file into a clear web structure, without changing the visual identity or the existing business rules.

## Getting started

You need [Node.js](https://nodejs.org) 18 or later (the LTS version is fine) and Git.

```powershell
git clone <repository URL>
cd <repository folder>\kinta-backend
npm install
npm start
```

Then open `http://localhost:3000` and sign in with `admin` / `kinta2026`.
That is server 1, the shop with generated data. See [The two servers](#the-two-servers)
for the second server, used to test a new shop.

On Windows PowerShell, if `npm` is blocked by the script execution policy, use
`npm.cmd install` and `npm.cmd start` instead.

## Structure

- `index.html`: application structure
- `assets/css/styles.css`: Kinta styles
- `assets/js/app.js`: JavaScript logic and interactions
- `assets/js/currency.js`: South African rand formatting and amount conversion
- `assets/vendor/chart.umd.min.js`: charts, available offline
- `assets/icons/favicon.svg`: site icon

## The two servers

Kinta can run as two completely separate servers on the same computer. Each one has its own database, so nothing done on one ever shows up on the other.

| | Server 1 — main shop | Server 2 — new shop for testing |
|---|---|---|
| Address | `http://localhost:3000` | `http://localhost:3001` |
| How to start | `npm.cmd start` in `kinta-backend` | double-click `start-new-shop.bat` |
| Database | `kinta-backend/database/kinta.db` | `kinta-backend/database/kinta-new.db` |
| Content | The **Soweto Shop**, already filled with generated data: products, customers, sales, expenses, employees, returns, supplier orders… | Starts **empty**. Use it to test creating and running a brand-new shop from scratch. |

### Server 1 — the shop with generated data

Use this server to explore Kinta with realistic data already in place: every page
(dashboard, till, reports, accounting…) has something to show.

```powershell
cd kinta-backend
npm.cmd install
npm.cmd start
```

Then open `http://localhost:3000` and sign in with `admin` / `kinta2026`.
Opening `index.html` directly does not allow connecting to the API.

### Server 2 — test a new shop

Use this server to try the full journey of a new customer: creating the shop, adding
products and users, opening the till and making the first sale.

1. Double-click `start-new-shop.bat`, then open `http://localhost:3001`.
2. On first launch, click **Create a new shop** and fill in the business and its administrator.

This instance uses `kinta-backend/database/kinta-new.db` and never touches the Soweto Shop
database `kinta.db`. It also enables a test clock, so you can simulate another date
to test reports and closing days.

To start again from an empty shop, stop server 2 and run (from the `kinta` folder):

```powershell
Remove-Item -LiteralPath '.\kinta-backend\database\kinta-new.db' -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath '.\kinta-backend\database\backups' -File |
  Where-Object Name -Like 'kinta-new-*.db' |
  Remove-Item -Force
.\start-new-shop.bat
```

### Start both servers at once

From the repository folder, in PowerShell:

```powershell
Start-Process cmd.exe -ArgumentList '/k','cd /d kinta-backend && npm.cmd start'; Start-Process '.\start-new-shop.bat'
```

## Automatic checks

The critical flows can be checked without touching the real databases:

```powershell
cd kinta-backend
npm.cmd test
```

The test uses a temporary database and checks shop creation, passwords, sync
conflicts and till closing, as well as credit sales, closing by the manager,
the expenses display, account histories and the Excel colours.

## Till and treasury

- At the till, select a customer then **On credit** to record a sale without
  payment. The balance due increases and the customer's credit limit, if positive,
  is enforced. Payments are recorded in **Customers**.
- Sales show the cashier recorded on the sale. An old sale without this
  information shows "Not specified".
- In **Treasury**, clicking **Main till**, **E-wallet** or **Bank** opens its
  history, transfers included. The customer receivables balance is shown with a
  link to payments.
- **Export treasury (Excel)** downloads a SpreadsheetML `.xml` file that opens in
  Excel: income in green, outgoings in red, transfers in blue.
- The manager can close an open till from **Control**, button **Close**, after
  entering the cash counted. The Z report is kept.

After an update, restart the backend and refresh the browser page.

## Demo credentials

- Manager: `admin` / `kinta2026`
- Cashier: `caissier1` / `caisse123`
- Salesperson: `vendeur1` / `vente123`

## Data

Data is saved in the backend database, and a local cache helps ride out a brief
connection loss. In production, `JWT_SECRET` and `INITIAL_ADMIN_PASSWORD` must be
set, then change the initial password after the first sign-in.

New shops and new users require a password of at least 8 characters. Existing
accounts keep working. If two devices change the same data at the same time, Kinta
blocks the older save and asks you to refresh instead of silently overwriting the
recent changes.

Older databases stored statuses, payment methods and categories in French. The
backend converts them to English automatically when it starts
(`kinta-backend/database/english-migration.js`), so an older database can be reused as is.
