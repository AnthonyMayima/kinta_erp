'use strict';

const jwt = require('jsonwebtoken');
const { get } = require('../../database/schema');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production'
  ? 'kinta-local-development-secret-change-me'
  : '');

if (!JWT_SECRET) throw new Error('JWT_SECRET is required in production');

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch(e) { return null; }
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated — please sign in' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again' });
  const user = get('SELECT u.*, b.nom as boutique_nom FROM utilisateurs u JOIN boutiques b ON u.boutique_id = b.id WHERE u.id = ? AND u.actif = 1', [payload.userId]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = { id: user.id, login: user.login, role: user.role, nom: user.nom, boutiqueId: user.boutique_id, boutiqueNom: user.boutique_nom };
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrators only' });
  next();
}

function notSalesperson(req, res, next) {
  if (req.user.role === 'salesperson') return res.status(403).json({ error: 'Access not allowed' });
  next();
}

function accountingOnly(req, res, next) {
  if (!['admin','accountant'].includes(req.user.role)) return res.status(403).json({ error: 'Accounting staff only' });
  next();
}

module.exports = { generateToken, verifyToken, authMiddleware, adminOnly, notSalesperson, accountingOnly };
