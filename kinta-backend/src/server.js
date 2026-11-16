'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { getDB } = require('../database/schema');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ROOT = path.resolve(__dirname, '../..');
const isProduction = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: isProduction ? false : true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 30, message: { error: 'Too many attempts, try again in 15 min.' } });
const apiLimiter  = rateLimit({ windowMs: 60*1000, max: 500, message: { error: 'Too many requests.' } });

// Single frontend source: the files at the project root.
app.use('/assets', express.static(path.join(FRONTEND_ROOT, 'assets'), { maxAge: isProduction ? '1d' : 0 }));
app.get('/manifest.webmanifest', (req, res) => res.sendFile(path.join(FRONTEND_ROOT, 'manifest.webmanifest')));
app.get('/service-worker.js', (req, res) => res.sendFile(path.join(FRONTEND_ROOT, 'service-worker.js')));
app.get(['/kinta-admin','/kinta-admin/'],(req,res)=>res.sendFile(path.join(FRONTEND_ROOT,'kinta-admin','index.html')));
app.use('/kinta-admin/assets',express.static(path.join(FRONTEND_ROOT,'kinta-admin')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', name: 'Kinta ERP API' }));

app.get('/api', (req, res) => res.json({ message: 'Kinta ERP API', endpoints: ['/api/auth', '/api/clients', '/api/produits', '/api/ventes', '/api/dashboard'] }));

// Routes
const authRoutes = require('./routes/auth');
const apiRoutes  = require('./routes/api');
const kintaAdminRoutes=require('./routes/kinta-admin');
app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/kinta-admin',loginLimiter,kintaAdminRoutes);
app.use('/api', apiLimiter, apiRoutes);

// SPA fallback
app.get('*', (req, res) => {
  const p = path.join(FRONTEND_ROOT, 'index.html');
  require('fs').existsSync(p) ? res.sendFile(p) : res.json({ message: 'Kinta ERP API online', url: '/health' });
});

// Error handler
app.use((err, req, res, next) => { console.error(err.stack || err.message); res.status(500).json({ error: isProduction ? 'Server error' : err.message }); });

// Start — init DB first (async)
async function start() {
  await getDB(); // Initialises sql.js and the schema
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║        KINTA ERP — API Server        ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  Port  : ${PORT}                          ║`);
    console.log(`║  URL   : http://localhost:${PORT}          ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log('Available endpoints:');
    console.log('  POST /api/auth/register — Create a shop');
    console.log('  POST /api/auth/login — Sign in');
    console.log('  GET /api/dashboard — Stats (auth required)');
    console.log('  GET /api/produits — Products');
    console.log('  GET /api/ventes — Sales');
    console.log('  ... and all other endpoints');
  });
}

start().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
