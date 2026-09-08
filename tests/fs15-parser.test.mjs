import assert from 'node:assert/strict';
import { parseFs15Listing, parseFs15Meta, languageFromText } from '../src/fs15-parser.mjs';

const listingHtml = `
<html><body>
  <article class="short-in">
    <a href="/index.php?newsid=1" title="Mutiny - 2026">
      <img src="/uploads/mutiny.jpg" alt="Mutiny">
    </a>
    <div class="short-title">Mutiny - 2026</div>
    <div>Action, Thriller - 1h35 HD VF+VOSTFR</div>
  </article>
  <article class="short-in">
    <a href="/index.php?newsid=2" title="Coyote vs. Acme - 2026">
      <img src="/uploads/coyote.jpg" alt="Coyote vs. Acme">
    </a>
    <div class="short-title">Coyote vs. Acme - 2026</div>
    <div>Comédie, Aventure, Familial - 1h43 HD VOSTFR</div>
  </article>
</body></html>`;

const metaHtml = `
<html><head>
  <meta property="og:image" content="https://image.tmdb.org/t/p/w500/mutiny.jpg">
</head><body>
  <h1>Mutiny - 2026</h1>
  <div class="fdesc">Après que son patron industriel milliardaire a été assassiné sous ses yeux, Cole Reed est désigné pour endosser le crime.</div>
  <div>Titre Original: Mutiny</div>
  <div>Genre: Action, Thriller</div>
  <div>Réalisateur: Jean-François Richet</div>
  <div>Acteurs: Jason Statham, Annabelle Wallis, Roland Møller</div>
  <div>Version: VF+VOSTFR</div>
  <div>Qualité: HD</div>
  <div>Date de sortie: 2026</div>
  <div>Langue d'origine: Anglais</div>
</body></html>`;

const listing = parseFs15Listing(listingHtml, 'movie');
assert.equal(listing.length, 2);
assert.equal(listing[0].name, 'Mutiny');
assert.equal(listing[0].languageTag, 'DUB_SUB');
assert.equal(listing[0].quality, 'HD');
assert.equal(listing[1].languageTag, 'SUB');

assert.equal(languageFromText('HDTrueFrench'), 'DUB');
assert.equal(languageFromText('HDFrench'), 'DUB');
assert.equal(languageFromText('HDVOSTFR'), 'SUB');
assert.equal(languageFromText('HDVF+VOSTFR'), 'DUB_SUB');

const meta = parseFs15Meta(metaHtml, 'movie');
assert.ok(meta);
assert.equal(meta.name, 'Mutiny');
assert.equal(meta.originalTitle, 'Mutiny');
assert.deepEqual(meta.genres, ['Action', 'Thriller']);
assert.equal(meta.director, 'Jean-François Richet');
assert.equal(meta.languageTag, 'DUB_SUB');
assert.equal(meta.quality, 'HD');
assert.equal(meta.originalLanguage, 'Anglais');
assert.equal(meta.year, '2026');
assert.equal(meta.poster, 'https://image.tmdb.org/t/p/w500/mutiny.jpg');

console.log('FS15 parser tests passed');
