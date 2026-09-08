---
title: FS15 Catalog
emoji: 🎬
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7000
---

# French Stream Enhanced Stremio Addon

Addon Stremio public pour afficher des catalogues films et series francais.

## Installation recommandee

Ouvrir la page de configuration:

```text
https://addon-stremio-fs-public.stremio-fs-public.workers.dev/
```

Puis renseigner la cle API TMDB, choisir les catalogues et cliquer sur **Installer sur Stremio**.

## Manifest direct

Pour une installation sans configuration personnalisee, copier ce lien dans Stremio:

```text
https://addon-stremio-fs-public.stremio-fs-public.workers.dev/manifest.json
```

Ce manifest direct fonctionne sans cle TMDB, mais la configuration reste recommandee pour obtenir de meilleures affiches, descriptions et options de catalogue.

## Pourquoi le manifest n'est pas heberge en statique sur GitHub

Stremio utilise l'URL du manifest comme base pour appeler ensuite les routes `catalog` et `meta`.

Un fichier `manifest.json` statique sur GitHub ferait donc appeler les catalogues sur GitHub Pages, qui ne peut pas executer le scraping ni les appels TMDB. Le manifest installable doit rester servi par le Worker Cloudflare.

## French Stream Enhanced

See `README-ENHANCED.md` for the independent DUB/SUB + BetterPoster fork.

## Hugging Face Space

This repository can be deployed as a Docker Space. The container listens on port 7000.
