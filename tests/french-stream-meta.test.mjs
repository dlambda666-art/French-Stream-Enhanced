import assert from 'node:assert/strict';
import { extractFrenchStreamDescription, normalizeFrenchStreamUrl } from '../src/french-stream-meta.mjs';

const html = `
<html>
<head>
  <meta name="description" content="Résumé meta tronqué">
</head>
<body>
  <div class="fdesc clearfix slice-this" id="s-desc">
    <p class="desc-text">Résumé du film Chantage en streaming complet vf et vostfr hd vod gratuit sans limite et sans inscription</p>
    Reef Hawk, star hollywoodienne depuis l'âge de six ans, ne va pas bien.
    Quand il apprend qu'on tente de l'extorquer avec une mystérieuse vidéo.
  </div>
</body>
</html>`;

assert.equal(
    extractFrenchStreamDescription(html),
    "Reef Hawk, star hollywoodienne depuis l'âge de six ans, ne va pas bien. Quand il apprend qu'on tente de l'extorquer avec une mystérieuse vidéo."
);

assert.equal(
    normalizeFrenchStreamUrl('/15126409-chantage.html'),
    'https://french-stream.pink/15126409-chantage.html'
);

assert.equal(extractFrenchStreamDescription('<meta name="description" content="Résumé français">'), 'Résumé français');
