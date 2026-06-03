// Jay's Valet — Netlify-native data layer (NO Google/AWS account required).
//
// Storage is Netlify Blobs (built into the platform). Two logical stores:
//   • valet-users     — key "user:<uid>" -> profile, key "email:<email>" -> uid
//   • valet-requests  — key "req:<id>"   -> request doc
//
// Auth is a signed, HttpOnly session cookie (HMAC over uid+role+name). No
// third-party identity provider. Passwords are scrypt-hashed with a per-user
// salt. Everything here runs inside Netlify Functions.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const SECRET = process.env.VALET_SESSION_SECRET || 'jays-valet-mvp-dev-secret-change-me';
const COOKIE = 'valet_session';
const SESSION_DAYS = 30;

export const usersStore = () => getStore('valet-users');
export const reqStore = () => getStore('valet-requests');

export const newId = (p = '') => p + crypto.randomBytes(9).toString('base64url');

/* ----------------------------- passwords ------------------------------ */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------ session ------------------------------- */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function signSession(user) {
  const body = b64({ uid: user.uid, role: user.role, name: user.name, email: user.email });
  return `${body}.${sign(body)}`;
}
export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = sign(body);
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => {
    const i = c.indexOf('='); if (i < 0) return [c.trim(), ''];
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }).filter(([k]) => k));
}
// Works with a Web Request (Functions v2): reads the Cookie header.
export function sessionFromRequest(req) {
  const raw = req.headers.get('cookie') || '';
  return verifySession(parseCookies(raw)[COOKIE]);
}
export function setCookie(user) {
  const maxAge = SESSION_DAYS * 86400;
  return `${COOKIE}=${signSession(user)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/* ------------------------------- users -------------------------------- */
export async function getUserByEmail(email) {
  const us = usersStore();
  const uid = await us.get(`email:${String(email).toLowerCase()}`);
  if (!uid) return null;
  return us.get(`user:${uid}`, { type: 'json' });
}
export async function getUser(uid) {
  return usersStore().get(`user:${uid}`, { type: 'json' });
}
export async function createUser({ name, email, password, role, ...extra }) {
  const us = usersStore();
  const key = `email:${String(email).toLowerCase()}`;
  if (await us.get(key)) { const e = new Error('email-already-in-use'); e.code = 'email-already-in-use'; throw e; }
  const uid = newId('u_');
  const user = { uid, role, name, email: String(email).toLowerCase(), pass: hashPassword(password), ...extra };
  await us.setJSON(`user:${uid}`, user);
  await us.set(key, uid);
  return user;
}

// Strip secrets before sending a user to the client.
export const publicUser = (u) => u && {
  uid: u.uid, role: u.role, name: u.name, email: u.email,
  avatar: initials(u.name), tail: u.tail || null, aircraftType: u.aircraftType || null, home: u.home || null,
};
export function initials(name = '') {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

/* ------------------------------- seed --------------------------------- */
// First-run accounts so the app is instantly playable. Credentials are
// documented in valet/app/SETUP.md. Safe to call on every request — it no-ops
// once the accounts exist.
const SEED = [
  { email: 'owner@jaysair.test', password: 'valet123', role: 'owner', name: 'George Marsh',
    tail: 'N559JC', aircraftType: 'Cirrus SR22T G6', home: 'Row B · 14' },
  { email: 'operator@jaysair.test', password: 'valet123', role: 'operator', name: 'Marcus Reyes' },
  { email: 'tenant@jaysair.test', password: 'valet123', role: 'tenant', name: 'Alex Rivera',
    tail: 'N218AT', aircraftType: 'Cessna 182T', home: 'Row C · TD 4' },
];
let seeded = false;
export async function ensureSeed() {
  if (seeded) return;
  const us = usersStore();
  for (const s of SEED) {
    if (!(await us.get(`email:${s.email}`))) {
      await createUser(s).catch(() => {}); // ignore races
    }
  }
  seeded = true;
}

/* ----------------------------- requests ------------------------------- */
export async function listRequests() {
  const rs = reqStore();
  const { blobs } = await rs.list({ prefix: 'req:' });
  const docs = await Promise.all(blobs.map((b) => rs.get(b.key, { type: 'json' })));
  return docs.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export async function createRequest(data) {
  const id = newId('r_');
  const now = Date.now();
  const doc = { id, ...data, createdAt: now, updatedAt: now };
  await reqStore().setJSON(`req:${id}`, doc);
  return doc;
}
export async function updateRequest(id, patch) {
  const rs = reqStore();
  const cur = await rs.get(`req:${id}`, { type: 'json' });
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await rs.setJSON(`req:${id}`, next);
  return next;
}
