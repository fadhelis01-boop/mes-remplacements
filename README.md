# Mes remplacements (appli web)

Appli pour téléphone (iPhone et Android) et ordinateur : noter ses heures et jours de remplacement, y compris le week-end et les jours fériés, avec les totaux par mois et par année.

- Aucun compte, aucun serveur : les données restent sur l'appareil (stockage du navigateur). Sauvegarde et restauration par fichier dans Réglages.
- Fonctionne hors connexion une fois ouverte (service worker), installable sur l'écran d'accueil.
- Export CSV lisible par Excel (mêmes colonnes que l'onglet Saisie du classeur `Suivi_remplacements.xlsm`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `style.css` | page et mise en page |
| `core.js` | calculs (heures, nuits, fériés, jours, montants, alertes), sans dépendance |
| `app.js` | interface |
| `sw.js`, `manifest.webmanifest`, `icons/` | installation et hors ligne |
| `tests/core.test.js` | tests du moteur : `node tests/core.test.js` |
| `tools/make-icons.mjs` | régénère les icônes : `node tools/make-icons.mjs` |

## Essayer en local

```
python -m http.server 8790
```
puis ouvrir http://localhost:8790.

## Publier une nouvelle version

Changer `CACHE` dans `sw.js` et `VERSION` dans `app.js`, sinon les téléphones garderont l'ancienne version en cache.
