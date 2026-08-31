# French Stream Enhanced

Copie indépendante de French Stream Public, conservant ses catalogues et sa configuration, avec une couche expérimentale :

- détection catalogue `VF/FRENCH/TRUEFRENCH` → `DUB`
- `VOSTFR` seul → `SUB`
- `VF + VOSTFR` → `DUB + SUB`
- BetterPosters direct via `btttr.cc`
- badge DUB/SUB ajouté au poster via un endpoint SVG mis en cache 24 h
- Nuvio n'a pas besoin d'être modifié

## Déploiement Cloudflare Worker

Le Worker utilise `src/worker.mjs` et dérive automatiquement son origine publique pour construire les URLs des posters.

```bash
npx wrangler login
npx wrangler deploy
```

Le nom du Worker est `french-stream-enhanced` dans `wrangler.toml`.

Après le déploiement, ouvre :

`https://<ton-worker>.workers.dev/configure`

Configure ta clé TMDB et les mêmes catalogues que ton FS actuel. L'addon Enhanced est indépendant du FS officiel.

## Test ciblé

Le premier test recommandé est Speed Demon : si FS le détecte comme TrueFrench, le catalogue doit fournir un poster BetterPoster avec un badge bleu `DUB` directement sur l'affiche.

Black Box est le second test : si la page FS expose `VF + VOSTFR`, le poster doit afficher les deux badges.
