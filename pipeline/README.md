# Pipeline de contenu — Locate Play

Trouve des vidéos « pick up » sur xvideos, coupe **uniquement la partie non sexuelle** (scène de rue),
demande à Gemini d'identifier le lieu et le nom de l'actrice, remplit le Google Sheet, et produit un
`entries.json` prêt pour `scripts/add-video.mjs` (Cloudflare R2 + Supabase). Un dashboard local sert à
valider ou corriger le travail de Gemini avant envoi. Aucune IA « chat » dans la boucle : ce sont des
scripts Python + l'API Gemini, relançables par cron.

```
run.py discover ──► base locale (SQLite)      ──► run.py process ──► Google Sheet (onglet "Pipeline")
 xvideos "pick up"    data/pipeline.sqlite          │                       ▲
                                                   │ 1. page + commentaires │
                                                   │ 2. téléchargement 360p │
                                                   │ 3. nudenet (local) : première fenêtre sans contenu explicite
                                                   │ 4. ffmpeg : clip sûr [fenêtre]  ◄── seule chose envoyée à Gemini
                                                   │ 5. Gemini passe 1 (rés. basse) : fin intro studio, segments extérieurs, moment intime
                                                   │ 6. Gemini passe 2 (partie extérieure seulement) : lieu (lat/lng, confiance, indices),
                                                   │             actrice (titre/description/tags/commentaires)
                                                   │ 7. décision : à valider / rejet auto (lieu pas identifiable, trop court…)
                                                   ▼
                                     dashboard.py (valider / corriger)  ──► run.py export ──► entries.json
                                                                                              └► node scripts/add-video.mjs → R2 + Supabase
```

## En un clic

1. Double-clique `pipeline/start.command` (ou `.venv/bin/python dashboard.py`) : la page
   <http://127.0.0.1:8765> s'ouvre.
2. Clique **▶ Démarrer** (nombre de vidéos à traiter ; coche « chercher aussi de nouvelles vidéos » pour
   lancer d'abord une recherche xvideos, sinon seules les vidéos déjà en attente sont traitées).
3. Regarde le journal défiler ; chaque vidéo traitée apparaît en dessous avec le passage retenu (frise :
   fenêtre sûre nudenet, segments extérieurs, clip retenu, moment intime), l'actrice, le lieu, la confiance,
   les indices, ou la raison du rejet automatique.
4. Clique une vidéo « à valider » : **👁 Aperçu joueur** rejoue la manche comme dans le jeu (intro « Find X »
   avec le portrait, clip, révélation avec les indices zoomés) ; corrige si besoin, puis `V` (valider) ou
   `R` (rejeter). **↻ Retraiter** refait l'analyse d'une vidéo de zéro.
5. **⇪ Exporter les validées** produit `data/export/entries-<date>.json` ; la dernière commande à lancer
   (dans le journal) est `node --env-file=.env.local scripts/add-video.mjs <ce fichier>` → Cloudflare R2 +
   Supabase.

Pourquoi sur le Mac et pas « sur le site » : le site est une page statique (GitHub Pages) et Cloudflare /
Supabase n'exécutent ni ffmpeg ni nudenet ni des téléchargements de 80 Mo. La page tourne donc là où la machine
tourne (ce Mac, ou un petit VPS Linux avec exactement les mêmes commandes).

## Où vont les données

| Étape | Où | Quoi |
|---|---|---|
| Découverte / analyse | `pipeline/data/pipeline.sqlite` (source de vérité) + `data/videos/<id>/` | métadonnées, fenêtre sûre, clip sûr, réponses Gemini, vignette |
| Miroir lisible | Google Sheet <https://docs.google.com/spreadsheets/d/1VwF5sQOScyDzVDCkkPUUDvsZaQiDH4Fr55UDJbve2lw>, onglet **Pipeline** (créé automatiquement, réécrit à chaque synchro, une fois le Sheet connecté) | une ligne par vidéo traitée : statut, lien, actrice, lat/lng, fichier, début, fin, ville, pays, confiance, indices, raison de rejet |
| Validation | le dashboard (écrit dans SQLite, puis Sheet) | statut validé / rejeté, corrections |
| Export | `pipeline/data/export/entries-<date>.json` | format de `scripts/add-video.mjs` |
| Production | Cloudflare R2 (`<fichier>.mp4`) + Supabase table `videos` (via `add-video.mjs`) | ce que le jeu lit |

Le Sheet n'est pas la base : c'est une vue pour toi (et pour partager). Si tu y modifies une cellule, la
prochaine synchro l'écrase. Corrige dans le dashboard.

## Installation (déjà faite sur ce Mac)

```bash
cd pipeline
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # puis remplir GEMINI_API_KEY (voir ci-dessous)
```

Prérequis système : `ffmpeg`/`ffprobe` (installés via Homebrew). `yt-dlp` n'est qu'un secours : l'extracteur
xvideos de yt-dlp est cassé en ce moment, le téléchargement passe par le mp4 direct de la page (360p, comme
`add-video.mjs`).

## Configuration

### 1. Clé Gemini (obligatoire)
Crée une clé sur <https://aistudio.google.com/apikey> et mets-la dans `pipeline/.env` : `GEMINI_API_KEY=...`.

**Coût.** Gemini ne reçoit jamais la vidéo, seulement des images fixes : la passe 1 (découpage) envoie des
planches-contact 768×768 de 24 images horodatées (≈ 1 000 tokens la planche, 4 à 5 planches pour 6 min de
fenêtre sûre) au modèle `GEMINI_MODEL_SEGMENT` (3.8 Flash : Flash-Lite rate les cartes pub) ; la passe 2 (lieu) envoie 6 images
pleine largeur + 45 s d'audio (≈ 5 000 tokens) au modèle `GEMINI_MODEL` (3.8 Flash, 0,75 $/M en entrée,
3,75 $/M en sortie jusqu'au 31/12/2026, le double ensuite). Réflexion réglée sur `LOW`.
→ **mesuré en réel : ≈ 0,5 centime par vidéo analysée en entier** (passe 1 ≈ 1 800 tokens, passe 2 ≈ 4 700,
actrice ≈ 400), ≈ 0,05 centime pour une vidéo rejetée à la passe 1, 0 pour une vidéo rejetée par nudenet.
100 vidéos ≈ 0,50 €, 1 000 vidéos ≈ 5 €.
Le dashboard affiche le coût réel (tokens facturés × prix de `.env`) par vidéo et en total.

Pour descendre encore : (1) **palier gratuit** = 0 € (voir ci-dessous) ; (2) `GEMINI_MEDIA_RESOLUTION=MEDIA_RESOLUTION_MEDIUM`
divise par deux les tokens des images de la passe 2 (lit moins bien les petits panneaux) ; (3) `LOCATE_FRAMES=4`
et `LOCATE_AUDIO_SECONDS=20` ; (4) le mode Batch de l'API Gemini est facturé moitié prix mais rend les
résultats en différé (jusqu'à 24 h), pas encore branché.

**Palier gratuit.** L'API Gemini a un palier gratuit (limites par jour visibles sur
<https://aistudio.google.com/rate-limit>) : sans carte bancaire c'est 0 €, avec un débit limité et la mention
que Google peut utiliser le contenu envoyé pour améliorer ses produits (pas le cas en palier payant). Pour
quelques dizaines de vidéos par jour ça suffit ; en cas de quota dépassé (429) le pipeline attend et réessaie.

### 2. Google Sheet — méthode simple (4 étapes, depuis le Sheet)
Le Sheet est privé : il faut lui donner un moyen de recevoir les lignes. Dans le dashboard, clique
**Connecter le Sheet** et suis le guide :
1. Ouvre le Sheet → **Extensions** → **Apps Script**.
2. Colle le script affiché par le dashboard (il contient un jeton secret), enregistre.
3. **Déployer** → **Nouveau déploiement** → **Application web** → Exécuter en tant que : *Moi* → Accès :
   *Tout le monde* → **Déployer** → autoriser (« Paramètres avancés » → « Accéder » si Google avertit) →
   copier l'**URL de l'application web** (`…/exec`).
4. Colle l'URL dans le dashboard → **Enregistrer et tester** : l'onglet `Pipeline` se remplit aussitôt.

Le script ne fait qu'écrire dans l'onglet et refuse toute requête sans le jeton. Les valeurs sont stockées
dans `.env` (`SHEET_WEBAPP_URL`, `SHEET_WEBAPP_TOKEN`).

### 2 bis. Google Sheet — méthode compte de service (alternative)
1. <https://console.cloud.google.com> → crée (ou choisis) un projet.
2. « API et services » → « Activer des API » → active **Google Sheets API** et **Google Drive API**.
3. « IAM et administration » → « Comptes de service » → « Créer un compte de service » → onglet « Clés » →
   « Ajouter une clé » → JSON. Enregistre le fichier sous `pipeline/service-account.json`.
4. Ouvre le Sheet → « Partager » → colle l'email `client_email` du JSON en **Éditeur**.

Dans les deux cas le pipeline crée lui-même l'onglet `Pipeline` (vierge) et le réécrit entièrement à chaque
synchronisation : la base locale est la source de vérité, ne modifie pas cet onglet à la main.

Colonnes : `Statut | Lien video | Nom actrice | Localisation L/L | Nom fichier .mp4 | début | fin | Ville | Pays |
Confiance lieu | Indices | Titre | Uploader | Durée source | Fenêtre sûre | Raison rejet / notes | Mis à jour | ID`.

### 3. Optionnel : ignorer ce qui est déjà en base
Renseigne `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` dans `.env` (mêmes valeurs que `.env.local` de
l'app) : `discover` saute les `source_url` déjà présents dans la table `videos`.

## Utilisation

Toujours depuis `pipeline/`, avec le Python du venv (`.venv/bin/python`).

```bash
.venv/bin/python run.py discover                 # cherche "pick up" sur fr.xvideos.com (SEARCH_QUERIES, SEARCH_PAGES)
.venv/bin/python run.py discover --query "public agent" --pages 5
.venv/bin/python run.py add https://www.xvideos.com/video.xxxx/...   # ajout manuel (xvideos ou xnxx)
.venv/bin/python run.py process --limit 5        # traite 5 vidéos "new" (≈ 1-2 min chacune)
.venv/bin/python run.py status                   # compteurs par statut
.venv/bin/python dashboard.py                    # http://127.0.0.1:8765 : valider / corriger
.venv/bin/python run.py export                   # validées -> data/export/entries-<date>.json
.venv/bin/python run.py sheet                    # force la réécriture du Sheet
.venv/bin/python run.py auto --limit 10          # discover + process + sheet, pour le cron
.venv/bin/python run.py process --retry-errors   # relance les vidéos en erreur (étapes déjà faites = cache)
.venv/bin/python run.py reset ID --force         # retraiter une vidéo de zéro (refait l'appel Gemini)
```

Puis, pour envoyer les validées sur Cloudflare R2 + Supabase (depuis le dossier de l'app, qui contient
`.env.local`) :

```bash
node --env-file=.env.local scripts/add-video.mjs "pipeline/data/export/entries-XXXX.json"
```

`add-video.mjs` retélécharge la section `début → fin`, la compresse, l'envoie sur R2 sous
`<Nom fichier>.mp4` et insère la ligne dans `videos` (il saute les `source_url` déjà présents).

### Dashboard (détail)
- **▶ Démarrer** traite N vidéos déjà trouvées et en attente (`run.py process`) ; coche « chercher aussi de
  nouvelles vidéos » pour lancer d'abord une recherche xvideos (`run.py auto`) ; **■ Stop** l'interrompt (la vidéo en cours reprendra au prochain
  départ, les étapes faites sont en cache).
- Liste à gauche (filtre par statut), clip sûr au milieu, carte à droite.
- `[` / `]` : début / fin = position courante de la vidéo ; « ▶ début→fin » rejoue la sélection.
- Corrige l'actrice, la ville/pays, glisse le marqueur (ou clique sur la carte) pour la position.
- `V` valide (le nom de fichier est recalculé : actrice + latitude entière, ex. `carolina47`), `R` rejette,
  `N` passe. Les « rejetées auto » restent consultables et peuvent être remises « à valider ».
- Chaque action réécrit le Sheet si le compte de service est configuré.

## Volume : la machine optimisée (coût ≈ 0,1 centime par vidéo scrapée, ~15 s de Mac par vidéo)

1. **Recherche** sur xvideos, filtre 10 min et plus, 2 pages par requête, avec deux familles : « pick up » (drague
   de rue des studios, surtout Europe) et « vlog / voyage » en 4 langues (vlog, travel vlog, trip, vacances,
   holiday, tourist, airbnb, hotel balcony, city tour, viaje, viagem, reise…). Mesuré sur 49 vidéos : les requêtes
   « pickup + nationalité » ou en langue locale (calle, rua, sokak…) donnent 1 gardée sur 26 (German Scout ou
   amateur en intérieur), la famille voyage 1 sur 3 avec des villes du monde entier. Jamais deux fois
   le même lien ; les vidéos déjà dans le jeu (Supabase) ou dans les autres onglets du Sheet sont ignorées, y
   compris sous un autre lien (xnxx / xvideos partagent le même numéro de vidéo, résolu une fois par lien).
2. **Téléchargement du début seulement** (`DOWNLOAD_SECONDS`, 9 min) : 5 fois moins de données.
3. **Sur le Mac, gratuit** : images 1/s partagées entre nudenet (explicite, 1 image sur 2 puis affinage) et CLIP
   (découpage : intro et cartes pub, dehors / voiture / intérieur / intime). Pas de scène de rue → rejet, coût 0.
4. **Gemini léger** (Flash-Lite) : la frontière intime précise sur la dernière minute du clip, et « lieu
   reconnaissable ou pas » sur 3 images basse résolution (`PREFILTER_MIN`). Lieu anonyme → rejet, ≈ 0,1 centime.
5. **Gemini complet** (3.8 Flash) seulement pour les vidéos prometteuses : lieu, indices, portrait ; nom de
   l'actrice en parallèle.
5b. **Texte à l'écran qui donne la réponse** (sous-titre « Hello, new day in Athens », bandeau « Bangkok »…) :
   sur les vidéos gardées, une lecture OCR locale (RapidOCR, gratuite, ~40 s) cherche les noms révélateurs
   fournis par Gemini (ville, pays, quartier, monuments, en anglais et en langue locale). Trouvé au début → le clip
   démarre 2 s après ; au milieu → coupé au montage ; trop présent → rejet. `OCR_SPOILERS=0` pour désactiver.
6. **3 vidéos en parallèle** (`WORKERS`), clip d'aperçu copié sans ré-encodage, source et images supprimées
   aussitôt ; une vidéo rejetée ne laisse qu'une vignette, une vidéo exportée ne garde que ses images d'indices.
7. **Diversité** : les uploaders dont ≥ `STUDIO_SATURATION` vidéos donnent le même pays passent en fin de file ;
   `MAX_PER_COUNTRY` (0 = off) met en rejet « quota » les pays déjà bien couverts. Badge 🌍 = pays couverts.

Réglages : `LOCAL_SEGMENT=0` remet le découpage sur Gemini (planches horodatées), `PREFILTER=0` saute le pré-filtre.

## Ce qui est garanti / comment ça décide

- **Rien de sexuel ne part vers Gemini.** nudenet (modèle local, hors ligne) note 1 image/s sur les
  `SCAN_SECONDS` premières secondes ; un passage est « explicite » quand une classe explicite dépasse
  `NSFW_THRESHOLD` pendant `NSFW_CONSECUTIVE` s. On retient la **première fenêtre sans passage explicite**
  d'au moins `MIN_CLIP_SECONDS`, rognée de `SAFETY_MARGIN` s : beaucoup de vidéos ouvrent sur un montage
  d'intro explicite (logo studio + extraits), il est sauté et jamais envoyé. Seule cette fenêtre est
  ré-encodée et envoyée. Les images extraites sont supprimées après le scan, la source aussi
  (`KEEP_SOURCE=1` pour la garder).
- **Indices explicatifs** : chaque indice nomme l'élément et ce qu'il révèle (« Enseigne “Terminál 1” : le á
  accentué n'existe qu'en tchèque → Tchéquie »), avec priorité aux indices qui désignent le pays ou la ville ;
  un indice audio (langue, accent, lieu cité) est ajouté sans image.
- **Deux appels Gemini, images fixes seulement** : le 1er reçoit des planches-contact horodatées de la
  fenêtre sûre (une image toutes les `FRAME_STEP_SECONDS` s) et ne fait que découper (intro studio, segments
  extérieurs, moment intime, est-ce une drague de rue) ; le 2e ne reçoit **que la partie extérieure**
  (`LOCATE_FRAMES` images pleine largeur + `LOCATE_AUDIO_SECONDS` s d'audio pour la langue) pour le lieu et
  Une vidéo sans scène de rue s'arrête après le 1er appel. Le nom de l'actrice vient d'abord de la page
  (interprètes listés `/pornstars/…` `/models/…`, tags `prenom-nom`, motifs du titre « avec X », « (X Y) »),
  sans IA ; sinon d'un 3e appel, texte
  seulement (titre, description, commentaires avec les mots sensibles masqués, modèle léger) : envoyer les
  métadonnées brutes avec les images déclenchait le blocage « PROHIBITED_CONTENT » de Gemini.
- **Début du clip** = max(fin de l'intro studio, début du 1er segment extérieur) d'après Gemini. Les 48 premières
  secondes sont échantillonnées toutes les 2 s pour situer la fin de l'intro à 2 s près.
- **Cartes pub insérées dans le tournage** (logo studio + slogan au milieu de la scène) : Gemini les signale
  (`ad_segments`) ; une carte au début décale le début, une carte au milieu est **coupée au montage** par
  `add-video.mjs` (champ `skip` de l'export) et sautée dans les aperçus du dashboard, une carte à la fin
  raccourcit le clip. Les bandeaux incrustés en permanence ne peuvent pas être retirés.
- **Fin du clip** = fin du bloc extérieur (les segments séparés de moins de 20 s sont enchaînés ; on s'arrête au
  premier vrai passage en intérieur), bornée par « devient intime » selon Gemini, la fin de la fenêtre sûre
  nudenet, la première image signalée par nudenet après le début (même isolée, moins `SAFETY_MARGIN`), et
  début + `MAX_CLIP_SECONDS` (4 min : au-delà, `add-video.mjs` compresse trop fort pour tenir dans 8 Mo).
- **Rejet automatique** (ligne « rejeté auto » dans le Sheet, avec la raison) si : sexuel avant
  `MIN_CLIP_SECONDS` ; pas une drague de rue ; aucune scène extérieure ou partie extérieure < 20 s ; clip <
  `MIN_CLIP_SECONDS` ; `identifiable=false` ou confiance
  lieu < `MIN_LOCATION_CONFIDENCE` ; Gemini bloque le contenu ; pas de coordonnées.
- Les vidéos de moins de `MIN_SOURCE_DURATION` (10 min) trouvées par la recherche sont ignorées : ce sont
  presque toujours des extraits « sexe seulement » sans scène de rue (vérifié : rejetées dès la 2e seconde).
- Tout est **idempotent** : une vidéo déjà connue n'est pas réinsérée, un scan/clip/appel Gemini déjà fait
  est réutilisé (`data/videos/<id>/nsfw.json`, `safe.mp4`, `gemini_segment.json`, `gemini_locate.json`, planches dans `grids/` et `locate/`).

## Indices en image (écran de fin de manche)

Gemini localise chaque indice dans une des images envoyées (zone `box_2d`). Le pipeline découpe la zone
(`data/videos/<id>/clues/clue_N.jpg`, zoom) et garde l'image entière (`frame_N.jpg`) ; le dashboard les
montre sous la carte. À l'export, `add-video.mjs` envoie ces images sur R2 (`<fichier>-clue-N.jpg`,
`<fichier>-clue-N-frame.jpg`) et remplit la colonne `videos.clues`. Dans le jeu, la fonction `submit-round`
renvoie ces indices **après** la réponse du joueur, et le composant `ClueReveal` les affiche sous le score
avec un zoom animé sur la zone (solo et multijoueur). Coût : quelques dizaines de tokens de sortie par vidéo.

À faire une fois côté Supabase / Cloudflare :
```bash
# 1. colonne (SQL Editor de Supabase) : supabase/migration-video-clues.sql
# 2. fonctions Edge (les indices ne sont plus renvoyés au démarrage de partie, seulement après la réponse)
supabase functions deploy submit-round
supabase functions deploy game-start
# 3. worker multijoueur (renvoie les indices au moment de la révélation)
cd workers/multiplayer && npx wrangler deploy
```

## Portrait de l'actrice (écran « Find X »)

Gemini indique aussi l'image et la zone où la femme est le mieux visible ; le pipeline en tire un portrait
carré (`data/videos/<id>/clues/actress.jpg`, visible dans le dashboard à côté du nom). À l'export,
`add-video.mjs` l'envoie sur R2 (`<fichier>-actor.jpg`) et remplit `actor_photo_url`, que l'écran d'intro
du jeu (`RoundIntro`) affiche en grand avant la vidéo.

## Usage Supabase

Tout le lourd est sur Cloudflare (clips, images d'indices et portraits sur R2 ; multijoueur sur un worker).
Supabase ne sert que pour les comptes, les scores et le catalogue : `game-start` ne transfère plus que les
colonnes utiles (ni coordonnées, ni indices, ni dates), les indices sont lus par `submit-round` pour la
seule vidéo jouée, et le worker multijoueur les lit au moment de la révélation, une vidéo à la fois.

## Automatisation (cron)

```cron
# toutes les 6 h : nouvelles vidéos + analyse de 10 max + Sheet
0 */6 * * * cd "/Users/loris/Desktop/projet loris/geogusrr/locate-play/locate-play/pipeline" && .venv/bin/python run.py auto --limit 10 >> data/cron.log 2>&1
```

Sur un serveur (Cloudflare/Supabase n'exécutent pas ffmpeg/nudenet) : n'importe quelle VM Linux avec
`ffmpeg` fait l'affaire, mêmes commandes. Ce qui va sur Cloudflare/Supabase reste l'étape `add-video.mjs`.

## Réglages utiles (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `SEARCH_QUERIES` | liste mondiale (53 requêtes par pays/langue) | vide = défaut ; sinon tes requêtes séparées par des virgules |
| `MAX_NEW_PER_QUERY` | 12 | plafond de nouvelles vidéos par requête (évite qu'un studio inonde la file) |
| `TRIAGE_BATCH` | 80 | titres par appel de pré-tri Gemini |
| `MIN_SOURCE_DURATION` | 600 | ignore les vidéos plus courtes (s) |
| `SCAN_SECONDS` | 480 | fenêtre analysée au début de la vidéo |
| `NSFW_THRESHOLD` | 0.45 | sensibilité nudenet (plus bas = coupe plus tôt) |
| `MIN_LOCATION_CONFIDENCE` | 0.6 | sous ce score Gemini → rejet auto |
| `MIN_CLIP_SECONDS` / `MAX_CLIP_SECONDS` | 30 / 240 | bornes du clip |
| `GEMINI_MODEL_SEGMENT` / `GEMINI_MODEL` | flash-lite / 3.8-flash | modèle de la passe 1 / de la passe 2 |
| `GEMINI_THINKING_LEVEL` | LOW | MINIMAL coûte moins, HIGH réfléchit plus (facturé en sortie) |
| `FRAME_STEP_SECONDS` | 4 | passe 1 : une image toutes les N s (2 = plus précis, 2x plus de planches) |
| `LOCATE_FRAMES` / `LOCATE_AUDIO_SECONDS` | 6 / 45 | passe 2 : images et audio envoyés |
| `GEMINI_MEDIA_RESOLUTION` | HIGH | résolution des images de la passe 2 |

## Dépannage
- `GEMINI_API_KEY manquant` : remplis `.env`, puis `run.py process --retry-errors`.
- `Google Sheet non connecté` : bouton « Connecter le Sheet » dans le dashboard (le pipeline continue sans Sheet).
- Page vidéo sans `id_video` : xvideos a changé son HTML ou bloque l'IP ; regarde `scrape.fetch_video_page`.
- Trop de rejets « lieu pas assez identifiable » : baisse `MIN_LOCATION_CONFIDENCE`, ou passe
  `GEMINI_MEDIA_RESOLUTION=MEDIA_RESOLUTION_HIGH`. Ils restent visibles dans le dashboard (filtre « Rejetées
  auto ») et peuvent être validés à la main.
