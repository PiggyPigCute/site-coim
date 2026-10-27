const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3009;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const FLAGS_DIR = path.join(DATA_DIR, 'drapeaux');
const MEMBRES_FILE = path.join(DATA_DIR, 'membres.csv');
const MEMBRES_SEED = path.join(__dirname, 'membres.csv');
const USERS_FILE = path.join(__dirname, 'users.txt');

// La liste "vivante" est dans data/ (gitignoré) pour que les modifs faites
// depuis /edit n'entrent pas en conflit avec un git pull. Au premier lancement
// elle est initialisée à partir du membres.csv versionné.
fs.mkdirSync(FLAGS_DIR, { recursive: true });
if (!fs.existsSync(MEMBRES_FILE)) fs.copyFileSync(MEMBRES_SEED, MEMBRES_FILE);

// --- Comptes : users.txt, une ligne "utilisateur:hash_bcrypt" par compte ---
// Relu à chaque requête : ajouter/retirer un compte ne demande pas de redémarrage.
function readUsers() {
  const users = new Map();
  let text;
  try { text = fs.readFileSync(USERS_FILE, 'utf-8'); } catch { return users; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    users.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
  }
  return users;
}

if (!fs.existsSync(USERS_FILE)) {
  console.warn('users.txt absent : personne ne peut se connecter à /edit (voir scripts/hash-password.js)');
}

// Hash factice pour que la durée d'un login ne révèle pas si l'utilisateur existe
const DUMMY_HASH = bcrypt.hashSync('dummy', 10);

// --- Membres (membres.csv : nom;score;drapeau) ---
function readMembres() {
  return fs.readFileSync(MEMBRES_FILE, 'utf-8')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(line => line.trim())
    .map(line => {
      const [nom, score, drapeau] = line.split(';');
      return { nom: nom.trim(), score: Number(score) || 0, drapeau: (drapeau || '').trim() };
    });
}
function writeMembres(membres) {
  const lines = ['nom;score;drapeau', ...membres.map(m => `${m.nom};${m.score};${m.drapeau}`)];
  const tmp = MEMBRES_FILE + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  fs.renameSync(tmp, MEMBRES_FILE);
}

function parseMembre(body, membres, ancienNom) {
  const nom = String(body.nom || '').trim();
  const score = Number(body.score);
  if (!nom || nom.length > 80 || /[;\r\n]/.test(nom)) {
    return { error: 'Nom invalide (obligatoire, 80 caractères max, sans « ; »)' };
  }
  if (String(body.score).trim() === '' || !Number.isInteger(score)) {
    return { error: 'Le score doit être un nombre entier' };
  }
  const doublon = membres.some(m => m.nom.toLowerCase() === nom.toLowerCase() && m.nom !== ancienNom);
  if (doublon) return { error: 'Un membre porte déjà ce nom' };
  return { nom, score };
}

// --- Drapeaux uploadés : data/drapeaux/<slug>-<timestamp>.<ext> ---
// Le type est déduit du contenu du fichier, pas du mimetype envoyé par le navigateur.
function detectImageExt(buf) {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return '.gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}
function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'drapeau';
}
function saveFlag(file, nom) {
  const ext = detectImageExt(file.buffer);
  if (!ext) return null;
  const name = `${slugify(nom)}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(FLAGS_DIR, name), file.buffer);
  return name;
}
// Supprime un drapeau uploadé s'il n'est plus utilisé par aucun membre.
// Les drapeaux versionnés (public/imgs/drapeaux) ne sont jamais touchés.
function cleanupFlag(drapeau, membres) {
  if (!drapeau || membres.some(m => m.drapeau === drapeau)) return;
  const p = path.join(FLAGS_DIR, path.basename(drapeau));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 Mo
});

app.set('trust proxy', 1); // le site tourne derrière nginx en HTTPS
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
    // maxAge défini dynamiquement à la connexion selon "rester connecté"
  }
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// --- Anti brute-force basique sur le login ---
const loginAttempts = new Map();
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAttempt > WINDOW_MS) { loginAttempts.delete(ip); return false; }
  return entry.count >= MAX_ATTEMPTS;
}
function recordFailedAttempt(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAttempt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  } else {
    entry.count++;
  }
}

// Un compte retiré de users.txt perd l'accès immédiatement, même avec une session ouverte
function currentUser(req) {
  const user = req.session && req.session.user;
  return user && readUsers().has(user) ? user : null;
}
function requireAuth(req, res, next) {
  if (currentUser(req)) return next();
  return res.status(401).json({ error: 'Non authentifié' });
}

// --- Authentification ---
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes' });
  }
  const { username, password, stayConnected } = req.body || {};
  const hash = readUsers().get(String(username || '').trim());
  const valid = bcrypt.compareSync(String(password || ''), hash || DUMMY_HASH);
  if (!hash || !valid) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  loginAttempts.delete(ip);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Erreur serveur' });
    req.session.user = String(username).trim();
    if (stayConnected) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours
    res.json({ ok: true, user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: currentUser(req) });
});

// --- Membres ---
app.get('/api/membres', requireAuth, (req, res) => {
  res.json(readMembres());
});

app.post('/api/membres', requireAuth, upload.single('drapeau'), (req, res) => {
  const membres = readMembres();
  const parsed = parseMembre(req.body, membres, null);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let drapeau = '';
  if (req.file) {
    drapeau = saveFlag(req.file, parsed.nom);
    if (!drapeau) return res.status(400).json({ error: 'Le drapeau doit être une image PNG, JPG, WEBP ou GIF' });
  }
  membres.push({ nom: parsed.nom, score: parsed.score, drapeau });
  writeMembres(membres);
  res.status(201).json({ ok: true });
});

app.put('/api/membres/:nom', requireAuth, upload.single('drapeau'), (req, res) => {
  const membres = readMembres();
  const membre = membres.find(m => m.nom === req.params.nom);
  if (!membre) return res.status(404).json({ error: 'Membre introuvable (supprimé ou renommé entre-temps ?)' });

  const parsed = parseMembre(req.body, membres, membre.nom);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const ancienDrapeau = membre.drapeau;
  if (req.file) {
    const drapeau = saveFlag(req.file, parsed.nom);
    if (!drapeau) return res.status(400).json({ error: 'Le drapeau doit être une image PNG, JPG, WEBP ou GIF' });
    membre.drapeau = drapeau;
  } else if (req.body.sansDrapeau === '1') {
    membre.drapeau = '';
  }
  membre.nom = parsed.nom;
  membre.score = parsed.score;
  writeMembres(membres);
  if (membre.drapeau !== ancienDrapeau) cleanupFlag(ancienDrapeau, membres);
  res.json({ ok: true });
});

app.delete('/api/membres/:nom', requireAuth, (req, res) => {
  const membres = readMembres();
  const idx = membres.findIndex(m => m.nom === req.params.nom);
  if (idx === -1) return res.status(404).json({ error: 'Membre introuvable' });
  const [membre] = membres.splice(idx, 1);
  writeMembres(membres);
  cleanupFlag(membre.drapeau, membres);
  res.json({ ok: true });
});

// --- Site ---
app.get('/membres.csv', (req, res) => {
  res.sendFile(MEMBRES_FILE, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-cache' } });
});
app.use('/imgs/drapeaux', express.static(FLAGS_DIR));
app.get('/edit', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'edit.html'));
});
app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (5 Mo max)' : 'Envoi du fichier invalide';
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, () => {
  console.log(`coim.chruk.fr server running on port ${PORT}`);
});
