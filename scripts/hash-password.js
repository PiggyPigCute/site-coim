const bcrypt = require('bcryptjs');

const [username, password] = process.argv.slice(2);

if (!username || !password || username.includes(':')) {
  console.error('Usage : node scripts/hash-password.js <utilisateur> <mot-de-passe>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

console.log('\nAjoute cette ligne dans users.txt (à la racine de site-coim) :\n');
console.log(`${username}:${hash}\n`);
