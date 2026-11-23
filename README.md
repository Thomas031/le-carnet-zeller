# Le Carnet Zeller partagé

Les comptes `thomas` et `ami` peuvent consulter et modifier les mêmes dossiers,
cours et pièces jointes. La bibliothèque démarre vide. La vue et le filtre
préférés restent propres à chaque compte sur son navigateur.

## Déposer le projet sur GitHub

Copie ces cinq fichiers à la racine du dépôt. Relie ensuite ce dépôt à un
hébergement Node.js 22 ou plus, avec un disque persistant et une seule instance
du service. GitHub Pages seul ne peut pas exécuter le serveur.

Configure le démarrage avec `npm start`, puis définis ces variables sur
l’hébergeur :

| Variable | Valeur |
| --- | --- |
| `ZELLER_THOMAS_PASSWORD` | Mot de passe du compte `thomas`, 12 caractères minimum |
| `ZELLER_AMI_PASSWORD` | Mot de passe du compte `ami`, 12 caractères minimum |
| `PUBLIC_ORIGIN` | Adresse HTTPS finale du site, sans chemin ni barre finale |
| `DATA_DIR` | Chemin absolu du dossier sur le disque persistant |
| `PORT` | Port fourni par l’hébergeur. À défaut, le serveur écoute sur 3000 |

Ne publie aucun mot de passe sur GitHub. Les deux personnes ouvrent la même
adresse HTTPS. Sauvegarde régulièrement le dossier `DATA_DIR`, qui contient
les cours, les dossiers et les pièces jointes.

## Vérifier en local sur Windows (PowerShell)

```powershell
$env:ZELLER_THOMAS_PASSWORD = "ton-mot-de-passe-thomas"
$env:ZELLER_AMI_PASSWORD = "ton-mot-de-passe-ami"
npm start
```

Ouvre ensuite http://localhost:3000 dans deux profils de navigateur différents
et connecte un compte dans chacun. Sur deux PC, utilise l'adresse HTTPS hébergée.

La bibliothèque s’actualise toutes les cinq secondes hors de l’éditeur. Si les
deux personnes modifient le même cours, le second enregistrement est refusé
et l’éditeur propose de conserver le brouillon comme copie. La frappe ne
s’affiche pas en direct à l’autre utilisateur.

Les anciens cours du site statique sont toujours dans leur navigateur d’origine.
Cette version ne les importe pas automatiquement.
