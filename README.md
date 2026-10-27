# site-coim

Site du COIM (coim.chruk.fr). Le site public est dans `public/`, servi par
`server.js` (Express, port 3009), qui fournit aussi la page `/edit` pour
modifier la liste des membres (nom, score, drapeau).

## Données

- `membres.csv` (versionné) ne sert que de **valeur initiale** : au premier
  lancement il est copié dans `data/membres.csv`, qui devient la liste réelle.
- Les drapeaux uploadés depuis `/edit` vont dans `data/drapeaux/` et sont
  servis sous `/imgs/drapeaux/`, comme ceux de `public/imgs/drapeaux/`.
- `data/` est gitignoré : les modifications faites en ligne n'entrent pas en
  conflit avec un `git pull`. À sauvegarder si besoin.

## Comptes pour /edit

Fichier `users.txt` à la racine (gitignoré, à créer à la main sur le serveur),
une ligne par compte :

```
# commentaire
piggy:$2a$10$...
```

Générer une ligne :

```
node scripts/hash-password.js <utilisateur> <mot-de-passe>
```

Le fichier est relu à chaque requête : ajouter ou retirer un compte prend effet
immédiatement, sans redémarrage (un compte retiré perd aussi sa session).

## Déploiement

`reload.sh` : `git pull`, `npm install`, puis `pm2 reload coim`.
Mettre `NODE_ENV=production` pour que le cookie de session soit `Secure`.

nginx doit faire un `proxy_pass http://127.0.0.1:3009;` pour coim.chruk.fr
(avec `client_max_body_size 6m;` pour l'upload des drapeaux).
