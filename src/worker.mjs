import * as cheerio from 'cheerio';
import configureHtml from '../public/configure.html';
import { resolveCinemetaMeta } from './cinemeta.mjs';
import { fetchFrenchStreamDescription } from './french-stream-meta.mjs';
import { buildFrenchPulseMeta } from './frenchpulse-meta.mjs';
import { createBasicMetaFromFsId, decodeBase64Url, decodeStremioPathId, encodeBase64Url } from './stremio-id.mjs';

const CATALOG_CACHE_TTL = 6 * 60 * 60;
const META_CACHE_TTL = 24 * 60 * 60;
const MANIFEST_CACHE_TTL = 24 * 60 * 60;
const CACHE_VERSION = 'v13';
const SEARCH_ENRICH_LIMIT = 12;
const FRENCH_STREAM_ORIGIN = 'https://french-stream.pink';
const BETTERPOSTER_BASE = 'https://btttr.cc/poster/imdb/poster-default/';
const ENHANCED_ID = 'community.french-stream-enhanced';
const ENHANCED_NAME = 'French Stream Enhanced';
const POSTER_CACHE_TTL = 24 * 60 * 60;

const ALL_CATALOGS = {
    'derniers-films': { name: 'FS - Derniers Films', type: 'movie', baseUrl: 'https://french-stream.pink/films/', pageUrl: 'https://french-stream.pink/films/page/{page}/' },
    'films-action': { name: 'FS - Films Action', type: 'movie', baseUrl: 'https://french-stream.pink/films/actions/', pageUrl: 'https://french-stream.pink/films/actions/page/{page}/' },
    'dernieres-series': { name: 'FS - Dernières Séries', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/', pageUrl: 'https://french-stream.pink/s-tv/page/{page}/' },
    'series-netflix': { name: 'FS - Séries Netflix', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/netflix-series-/', pageUrl: 'https://french-stream.pink/s-tv/netflix-series-/page/{page}/' },
    'series-appletv': { name: 'FS - Séries Apple TV+', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/series-apple-tv/', pageUrl: 'https://french-stream.pink/s-tv/series-apple-tv/page/{page}/' },
    'series-prime': { name: 'FS - Séries Prime Video', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/serie-amazon-prime-videos/', pageUrl: 'https://french-stream.pink/s-tv/serie-amazon-prime-videos/page/{page}/' },
    'series-disneyplus': { name: 'FS - Séries Disney+', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/series-disney-plus/', pageUrl: 'https://french-stream.pink/s-tv/series-disney-plus/page/{page}/' },
    'series-action': { name: 'FS - Séries Action', type: 'series', baseUrl: 'https://french-stream.pink/action-serie-/', pageUrl: 'https://french-stream.pink/action-serie-/page/{page}/' },
    'series-aventure': { name: 'FS - Séries Aventure', type: 'series', baseUrl: 'https://french-stream.pink/aventure-series-/', pageUrl: 'https://french-stream.pink/aventure-series-/page/{page}/' },
    'series-animation': { name: 'FS - Séries Animation', type: 'series', baseUrl: 'https://french-stream.pink/animation-serie-/', pageUrl: 'https://french-stream.pink/animation-serie-/page/{page}/' },
    'series-biopic': { name: 'FS - Séries Biopic', type: 'series', baseUrl: 'https://french-stream.pink/serie-biopic-/', pageUrl: 'https://french-stream.pink/serie-biopic-/page/{page}/' },
    'series-comedie': { name: 'FS - Séries Comédie', type: 'series', baseUrl: 'https://french-stream.pink/comedie-serie-/', pageUrl: 'https://french-stream.pink/comedie-serie-/page/{page}/' },
    'series-drame': { name: 'FS - Séries Drame', type: 'series', baseUrl: 'https://french-stream.pink/drame-serie-/', pageUrl: 'https://french-stream.pink/drame-serie-/page/{page}/' },
    'series-documentaire': { name: 'FS - Séries Documentaire', type: 'series', baseUrl: 'https://french-stream.pink/documentaire-serie-/', pageUrl: 'https://french-stream.pink/documentaire-serie-/page/{page}/' },
    'series-familles': { name: 'FS - Séries Famille', type: 'series', baseUrl: 'https://french-stream.pink/familles-series-/', pageUrl: 'https://french-stream.pink/familles-series-/page/{page}/' },
    'series-fantastique': { name: 'FS - Séries Fantastique', type: 'series', baseUrl: 'https://french-stream.pink/fantastique-series-/', pageUrl: 'https://french-stream.pink/fantastique-series-/page/{page}/' },
    'series-thriller': { name: 'FS - Séries Thriller', type: 'series', baseUrl: 'https://french-stream.pink/thriller-series-/', pageUrl: 'https://french-stream.pink/thriller-series-/page/{page}/' },
    'series-romance': { name: 'FS - Séries Romance', type: 'series', baseUrl: 'https://french-stream.pink/romance-series-/', pageUrl: 'https://french-stream.pink/romance-series-/page/{page}/' },
    'series-judiciaire': { name: 'FS - Séries Judiciaire', type: 'series', baseUrl: 'https://french-stream.pink/judiciare-series-/', pageUrl: 'https://french-stream.pink/judiciare-series-/page/{page}/' },
    'series-science-fiction': { name: 'FS - Séries Science-Fiction', type: 'series', baseUrl: 'https://french-stream.pink/science-fiction-series-/', pageUrl: 'https://french-stream.pink/science-fiction-series-/page/{page}/' },
    'series-historiques': { name: 'FS - Séries Historiques', type: 'series', baseUrl: 'https://french-stream.pink/serie-historiques-/', pageUrl: 'https://french-stream.pink/serie-historiques-/page/{page}/' },
    'series-medical': { name: 'FS - Séries Médical', type: 'series', baseUrl: 'https://french-stream.pink/medical-series-/', pageUrl: 'https://french-stream.pink/medical-series-/page/{page}/' },
    'series-policier': { name: 'FS - Séries Policier', type: 'series', baseUrl: 'https://french-stream.pink/policier-series-/', pageUrl: 'https://french-stream.pink/policier-series-/page/{page}/' },
    'series-horreur': { name: 'FS - Séries Horreur', type: 'series', baseUrl: 'https://french-stream.pink/horreur-serie-/', pageUrl: 'https://french-stream.pink/horreur-serie-/page/{page}/' },
    'series-western': { name: 'FS - Séries Western', type: 'series', baseUrl: 'https://french-stream.pink/western-series-/', pageUrl: 'https://french-stream.pink/western-series-/page/{page}/' },
    'series-k-drama': { name: 'FS - K-Drama', type: 'series', baseUrl: 'https://french-stream.pink/k-drama-/', pageUrl: 'https://french-stream.pink/k-drama-/page/{page}/' },
    'series-tv-realite': { name: 'FS - Télé-Réalité', type: 'series', baseUrl: 'https://french-stream.pink/streaming-tv-realits/', pageUrl: 'https://french-stream.pink/streaming-tv-realits/page/{page}/' },
    'series-tag-adult-animation': { name: 'FS - Animation pour adultes', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/adult+animation/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/adult+animation/page/{page}/' },
    'series-tag-anthology': { name: 'FS - Anthologie', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/anthology/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/anthology/page/{page}/' },
    'series-tag-based-on-comic': { name: 'FS - Adapté d’une BD', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+comic/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+comic/page/{page}/' },
    'series-tag-based-on-novel': { name: 'FS - Adapté d’un roman', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+novel+or+book/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+novel+or+book/page/{page}/' },
    'series-tag-california': { name: 'FS - Californie', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/california/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/california/page/{page}/' },
    'series-tag-crime': { name: 'FS - Crime', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/crime/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/crime/page/{page}/' },
    'series-tag-detective': { name: 'FS - Enquêtes', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/detective/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/detective/page/{page}/' },
    'series-tag-espionage': { name: 'FS - Espionnage', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/espionage/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/espionage/page/{page}/' },
    'series-tag-friendship': { name: 'FS - Amitié', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/friendship/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/friendship/page/{page}/' },
    'series-tag-high-school': { name: 'FS - Lycée', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/high+school/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/high+school/page/{page}/' },
    'series-tag-hospital': { name: 'FS - Hôpital', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/hospital/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/hospital/page/{page}/' },
    'series-tag-journalism': { name: 'FS - Journalisme', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/journalism/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/journalism/page/{page}/' },
    'series-tag-lawyer': { name: 'FS - Avocats', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/lawyer/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/lawyer/page/{page}/' },
    'series-tag-military': { name: 'FS - Militaire', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/military/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/military/page/{page}/' },
    'series-tag-miniseries': { name: 'FS - Mini-série', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/miniseries/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/miniseries/page/{page}/' },
    'series-tag-murder': { name: 'FS - Meurtre', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/murder/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/murder/page/{page}/' },
    'series-tag-new-york-city': { name: 'FS - New York', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/new+york+city/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/new+york+city/page/{page}/' },
    'series-tag-political': { name: 'FS - Politique', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/political/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/political/page/{page}/' },
    'series-tag-religion': { name: 'FS - Religion', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/religion/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/religion/page/{page}/' },
    'series-tag-revenge': { name: 'FS - Vengeance', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/revenge/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/revenge/page/{page}/' },
    'series-tag-romance': { name: 'FS - Romance', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/romance/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/romance/page/{page}/' },
    'series-tag-sitcom': { name: 'FS - Sitcom', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/sitcom/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/sitcom/page/{page}/' },
    'series-tag-supernatural': { name: 'FS - Surnaturel', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/supernatural/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/supernatural/page/{page}/' },
    'series-tag-survival': { name: 'FS - Survie', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/survival/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/survival/page/{page}/' },
    'series-tag-time-travel': { name: 'FS - Voyage dans le temps', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/time+travel/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/time+travel/page/{page}/' },
    'series-tag-vampire': { name: 'FS - Vampire', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/vampire/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/vampire/page/{page}/' },
    'documentaires': { name: 'FS - Documentaires', type: 'movie', baseUrl: 'https://french-stream.pink/films/documentaires/', pageUrl: 'https://french-stream.pink/films/documentaires/page/{page}/' },
    'horreur': { name: 'FS - Horreur', type: 'movie', baseUrl: 'https://french-stream.pink/films/epouvante-horreurs/', pageUrl: 'https://french-stream.pink/films/epouvante-horreurs/page/{page}/' },
    'animations': { name: 'FS - Animations', type: 'movie', baseUrl: 'https://french-stream.pink/films/animations/', pageUrl: 'https://french-stream.pink/films/animations/page/{page}/' },
    'aventures': { name: 'FS - Aventures', type: 'movie', baseUrl: 'https://french-stream.pink/films/aventures/', pageUrl: 'https://french-stream.pink/films/aventures/page/{page}/' },
    'art-martiaux': { name: 'FS - Arts Martiaux', type: 'movie', baseUrl: 'https://french-stream.pink/art-martiaux/', pageUrl: 'https://french-stream.pink/art-martiaux/page/{page}/' },
    'biopics': { name: 'FS - Biopics', type: 'movie', baseUrl: 'https://french-stream.pink/films/biopics/', pageUrl: 'https://french-stream.pink/films/biopics/page/{page}/' },
    'comedies': { name: 'FS - Comédies', type: 'movie', baseUrl: 'https://french-stream.pink/films/comedies/', pageUrl: 'https://french-stream.pink/films/comedies/page/{page}/' },
    'espionnages': { name: 'FS - Espionnages', type: 'movie', baseUrl: 'https://french-stream.pink/films/espionnages/', pageUrl: 'https://french-stream.pink/films/espionnages/page/{page}/' },
    'familles': { name: 'FS - Familles', type: 'movie', baseUrl: 'https://french-stream.pink/films/familles/', pageUrl: 'https://french-stream.pink/films/familles/page/{page}/' },
    'fantastiques': { name: 'FS - Fantastiques', type: 'movie', baseUrl: 'https://french-stream.pink/films/fantastiques/', pageUrl: 'https://french-stream.pink/films/fantastiques/page/{page}/' },
    'policiers': { name: 'FS - Policiers', type: 'movie', baseUrl: 'https://french-stream.pink/films/policiers/', pageUrl: 'https://french-stream.pink/films/policiers/page/{page}/' },
    'thrillers': { name: 'FS - Thrillers', type: 'movie', baseUrl: 'https://french-stream.pink/films/thrillers/', pageUrl: 'https://french-stream.pink/films/thrillers/page/{page}/' },
    'westerns': { name: 'FS - Westerns', type: 'movie', baseUrl: 'https://french-stream.pink/films/westerns/', pageUrl: 'https://french-stream.pink/films/westerns/page/{page}/' },
    'drames': { name: 'FS - Drames', type: 'movie', baseUrl: 'https://french-stream.pink/films/drames/', pageUrl: 'https://french-stream.pink/films/drames/page/{page}/' },
    'historiques': { name: 'FS - Historiques', type: 'movie', baseUrl: 'https://french-stream.pink/films/historiques/', pageUrl: 'https://french-stream.pink/films/historiques/page/{page}/' },
    'guerres': { name: 'FS - Guerres', type: 'movie', baseUrl: 'https://french-stream.pink/films/guerres/', pageUrl: 'https://french-stream.pink/films/guerres/page/{page}/' },
    'romances': { name: 'FS - Romances', type: 'movie', baseUrl: 'https://french-stream.pink/films/romances/', pageUrl: 'https://french-stream.pink/films/romances/page/{page}/' },
    'science-fictions': { name: 'FS - Science Fictions', type: 'movie', baseUrl: 'https://french-stream.pink/films/science-fictions/', pageUrl: 'https://french-stream.pink/films/science-fictions/page/{page}/' },
    'spectacle': { name: 'FS - Spectacle', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/genre-1/spectacle/', pageUrl: 'https://french-stream.pink/xfsearch/genre-1/spectacle/page/{page}/' },
    'lang-arabe': { name: 'FS - Pays Arabe', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Arabe/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Arabe/page/{page}/' },
    'lang-turc': { name: 'FS - Pays Turc', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Turc/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Turc/page/{page}/' },
    'lang-thai': { name: 'FS - Pays Thaï', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Tha%C3%AF/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Tha%C3%AF/page/{page}/' },
    'lang-suedois': { name: 'FS - Pays Suédois', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Su%C3%A9dois/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Su%C3%A9dois/page/{page}/' },
    'lang-hindi': { name: 'FS - Pays Hindi', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Hindi/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Hindi/page/{page}/' },
    'lang-polonais': { name: 'FS - Pays Polonais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Polonais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Polonais/page/{page}/' },
    'lang-danois': { name: 'FS - Pays Danois', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Danois/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Danois/page/{page}/' },
    'lang-portugais': { name: 'FS - Pays Portugais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Portugais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Portugais/page/{page}/' },
    'lang-norvegien': { name: 'FS - Pays Norvégien', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Norv%C3%A9gien/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Norv%C3%A9gien/page/{page}/' },
    'lang-neerlandais': { name: 'FS - Pays Néerlandais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/N%C3%A9erlandais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/N%C3%A9erlandais/page/{page}/' },
    'lang-russe': { name: 'FS - Pays Russe', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Russe/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Russe/page/{page}/' },
    'lang-chinois': { name: 'FS - Pays Chinois', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Chinois/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Chinois/page/{page}/' },
    'lang-coreen': { name: 'FS - Pays Coréen', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Cor%C3%A9en/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Cor%C3%A9en/page/{page}/' },
    'lang-italien': { name: 'FS - Pays Italien', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Italien/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Italien/page/{page}/' },
    'lang-allemand': { name: 'FS - Pays Allemand', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Allemand/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Allemand/page/{page}/' },
    'lang-japonais': { name: 'FS - Pays Japonais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Japonais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Japonais/page/{page}/' },
    'lang-espagnol': { name: 'FS - Pays Espagnol', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Espagnol/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Espagnol/page/{page}/' },
    'lang-francais': { name: 'FS - Pays Français', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Fran%C3%A7ais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Fran%C3%A7ais/page/{page}/' },
    'lang-anglais': { name: 'FS - Pays Anglais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Anglais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Anglais/page/{page}/' },
    'tag-alien': { name: 'FS - Aliens', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/alien/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/alien/page/{page}/' },
    'tag-ai': { name: 'FS - Intelligence Artificielle', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/artificial+intelligence+%28a.i.%29/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/artificial+intelligence+%28a.i.%29/page/{page}/' },
    'tag-autism': { name: 'FS - Autisme', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/autism/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/autism/page/{page}/' },
    'tag-true-story': { name: 'FS - Inspiré d’une histoire vraie', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/based+on+true+story/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/based+on+true+story/page/{page}/' },
    'tag-coming-of-age': { name: 'FS - Passage à l’âge adulte', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/coming+of+age/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/coming+of+age/page/{page}/' },
    'tag-drug-trafficking': { name: 'FS - Trafic de drogue', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/drug+trafficking/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/drug+trafficking/page/{page}/' },
    'tag-disaster': { name: 'FS - Catastrophe', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/disaster/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/disaster/page/{page}/' },
    'tag-dystopia': { name: 'FS - Dystopie', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/dystopia/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/dystopia/page/{page}/' },
    'tag-friendship': { name: 'FS - Amitié', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/friendship/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/friendship/page/{page}/' },
    'tag-heist': { name: 'FS - Braquage', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/heist/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/heist/page/{page}/' },
    'tag-lgbt': { name: 'FS - LGBT', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/lgbt/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/lgbt/page/{page}/' },
    'tag-martial-arts': { name: 'FS - Arts martiaux', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/martial+arts/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/martial+arts/page/{page}/' },
    'tag-haunted-house': { name: 'FS - Maison hantée', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/haunted+house/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/haunted+house/page/{page}/' },
    'tag-love': { name: 'FS - Romance', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/love/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/love/page/{page}/' },
    'tag-love-triangle': { name: 'FS - Triangle amoureux', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/love+triangle/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/love+triangle/page/{page}/' },
    'tag-religion': { name: 'FS - Religion', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/religion/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/religion/page/{page}/' },
    'tag-revenge': { name: 'FS - Vengeance', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/revenge/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/revenge/page/{page}/' },
    'tag-serial-killer': { name: 'FS - Tueur en série', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/serial+killer/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/serial+killer/page/{page}/' },
    'tag-slasher': { name: 'FS - Slasher', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/slasher/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/slasher/page/{page}/' },
    'tag-space-travel': { name: 'FS - Voyage spatial', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/space+travel/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/space+travel/page/{page}/' },
    'tag-superhero': { name: 'FS - Super-héros', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/superhero/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/superhero/page/{page}/' },
    'tag-survival': { name: 'FS - Survie', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/survival/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/survival/page/{page}/' },
    'tag-time-loop': { name: 'FS - Boucle temporelle', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/time+loop/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/time+loop/page/{page}/' },
    'tag-time-travel': { name: 'FS - Voyage temporel', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/time%20travel/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/time%20travel/page/{page}/' },
    'tag-vampire': { name: 'FS - Vampires', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/vampire/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/vampire/page/{page}/' },
    'tag-zombie': { name: 'FS - Zombies', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/zombie/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/zombie/page/{page}/' }
};

const DEFAULT_CATALOGS = ['derniers-films', 'films-action', 'dernieres-series', 'series-netflix', 'series-appletv', 'series-prime', 'series-disneyplus'];

export default {
    async fetch(request, env, ctx) {
        try {
            return await handleRequest(request, ctx);
        } catch (error) {
            console.error(error);
            return json({ error: 'Internal error' }, 500);
        }
    }
};

async function handleRequest(request, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean).map(part => part.replace(/\.json$/, ''));

    if (url.pathname === '/' || url.pathname === '/configure') {
        return html(configureHtml);
    }

    if (url.pathname === '/test-tmdb') {
        return json(await testTMDBKey(url.searchParams.get('key')));
    }

    const posterMatch = url.pathname.match(/^\/(?:([^/]+)\/)?poster\/(tt\d+)\/(dub|sub|dub_sub)\.svg$/i);
    if (posterMatch) {
        return getEnhancedPosterResponse(request, posterMatch[2], posterMatch[3].toLowerCase(), ctx);
    }

    const route = normalizeRoute(parts);
    const config = parseConfig(route.configStr);
    config.posterBaseUrl = url.origin;

    if (route.resource === 'manifest') {
        return withJsonCache(ctx, `${CACHE_VERSION}:manifest:${await hashConfig(config)}`, MANIFEST_CACHE_TTL, () => createManifest(config));
    }

    if (route.resource === 'catalog') {
        const extra = parseExtra(route.extraParts, url.searchParams);
        return withJsonCache(ctx, `${CACHE_VERSION}:catalog:${await hashConfig(config)}:${route.type}:${route.id}:${extra.search || ''}`, CATALOG_CACHE_TTL, () => {
            return getCatalogResponse(route.type, route.id, extra, config, ctx);
        });
    }

    if (route.resource === 'meta') {
        const meta = await getCachedMeta(route.type, route.id);
        return json({ meta });
    }

    return json({ error: 'Not found' }, 404);
}

function normalizeRoute(parts) {
    let configStr = null;
    if (parts[0] && !['manifest', 'catalog', 'meta'].includes(parts[0])) {
        configStr = parts.shift();
    }

    return {
        configStr,
        resource: parts[0],
        type: parts[1],
        id: decodeStremioPathId(parts[2]),
        extraParts: parts.slice(3)
    };
}

function parseConfig(configStr) {
    const fallback = { tmdbKey: null, rpdbKey: null, catalogs: DEFAULT_CATALOGS, vfOnly: false };
    if (!configStr) return fallback;

    try {
        const config = JSON.parse(decodeBase64Url(configStr));
        return {
            tmdbKey: config.t || null,
            rpdbKey: config.r ? 't0-free-rpdb' : null,
            catalogs: Array.isArray(config.c) ? config.c.filter(id => ALL_CATALOGS[id]) : DEFAULT_CATALOGS,
            vfOnly: Boolean(config.v)
        };
    } catch (error) {
        return fallback;
    }
}

function createManifest(config) {
    const selected = config.catalogs.map(id => ({
        type: ALL_CATALOGS[id].type,
        id: `fs-${id}`,
        name: ALL_CATALOGS[id].name
    }));

    return {
        id: ENHANCED_ID,
        version: '0.1.0',
        name: ENHANCED_NAME,
        description: 'Version publique configurable avec recherche et nouvelles catégories.',
        logo: 'https://french-stream.pink/templates/flavor/dleflavour/assets/images/x325_logo.png.pagespeed.ic.hpZlJOA7lE.webp',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:', 'fs:'],
        catalogs: [
            ...selected,
            { type: 'movie', id: 'fs-search', name: 'Recherche French Stream - Films', extra: [{ name: 'search', isRequired: true }] },
            { type: 'series', id: 'fs-search', name: 'Recherche French Stream - Séries', extra: [{ name: 'search', isRequired: true }] }
        ],
        behaviorHints: { configurable: true, configurationRequired: false }
    };
}

async function getCatalogResponse(type, id, extra, config, ctx) {
    if (id === 'fs-search' && extra.search) {
        const results = await searchFrenchStream(extra.search, type);
        return { metas: await enrichSearchResults(results, config, ctx) };
    }

    const catalogId = id?.replace(/^fs-/, '');
    const items = await getCatalogItems(catalogId, config, ctx);
    return { metas: items };
}

async function getCatalogItems(catalogId, config, ctx) {
    const catalog = ALL_CATALOGS[catalogId];
    if (!catalog) return [];

    const pagePromises = Array.from({ length: 3 }, (_, i) => {
        const pageUrl = i === 0 ? catalog.baseUrl : catalog.pageUrl.replace('{page}', i + 1);
        return fetchPage(pageUrl).then(htmlBody => htmlBody ? scrapeItems(htmlBody, catalog.type) : []);
    });

    const pages = await Promise.all(pagePromises);
    const seen = new Set();
    const items = [];

    pages.flat().forEach(item => {
        if (config.vfOnly && item.isVostfrOnly) return;
        const searchTitle = catalog.type === 'series' ? cleanSeriesTitle(item.title) : item.title;
        const key = searchTitle.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            items.push({ ...item, searchTitle });
        }
    });

    const enriched = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(item => {
            return enrichItem(item, config, ctx, Boolean(config.tmdbKey));
        }));
        enriched.push(...batchResults);
    }

    return enriched;
}

async function enrichItem(item, config, ctx, shouldUseTmdb) {
    const tmdb = shouldUseTmdb ? await searchTMDB(item.searchTitle, item.type, config.tmdbKey) : null;
    let meta = createBasicMeta(item, item.searchTitle);

    if (tmdb) {
        const id = tmdb.imdbId || `tmdb:${tmdb.tmdbId}`;
        const poster = betterPosterUrl(tmdb.imdbId, item.languageTag, config.posterBaseUrl) || tmdb.poster || item.poster;

        meta = {
            id,
            type: item.type,
            name: tmdb.title || item.searchTitle || item.title,
            poster,
            languageTag: item.languageTag,
            background: tmdb.backdrop,
            description: tmdb.description,
            releaseInfo: tmdb.year,
            imdbRating: tmdb.rating,
            genres: tmdb.genres,
            runtime: tmdb.runtime ? `${tmdb.runtime} min` : undefined,
            behaviorHints: item.type === 'movie' ? { defaultVideoId: id, hasScheduledVideos: false } : undefined
        };

        meta.frenchpulse = buildFrenchPulseMeta({
            tmdbId: tmdb.tmdbId,
            imdbId: tmdb.imdbId,
            title: meta.name,
            year: tmdb.year,
            poster,
            backdrop: tmdb.backdrop,
            originalTitle: tmdb.originalTitle,
            vf: ['DUB', 'DUB_SUB'].includes(item.languageTag),
            vfSource: 'French Stream Enhanced',
            vfVerified: ['DUB', 'DUB_SUB'].includes(item.languageTag),
            quality: item.quality || null
        });
    } else {
        meta = await resolveCinemetaMeta(item.searchTitle, item.type) || meta;
        const frenchDescription = await fetchFrenchStreamDescription(item.href);
        if (frenchDescription) meta = { ...meta, description: frenchDescription };
    }

    ctx?.waitUntil(putMeta(meta));
    return { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, posterShape: 'poster' };
}

async function enrichSearchResults(items, config, ctx) {
    const seen = new Set();
    const filtered = [];

    for (const item of items) {
        const searchTitle = item.type === 'series' ? cleanSeriesTitle(item.title) : cleanSearchTitle(item.title);
        const key = `${item.type}:${searchTitle.toLowerCase()}`;
        if (!searchTitle || seen.has(key)) continue;
        seen.add(key);
        filtered.push({ ...item, searchTitle });
    }

    const metas = [];
    const BATCH_SIZE = 6;
    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
        const batch = filtered.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map((item, index) => {
            return enrichItem(item, config, ctx, i + index < SEARCH_ENRICH_LIMIT);
        }));
        metas.push(...batchResults);
    }

    return metas;
}

function createBasicMeta(item, title) {
    return {
        id: `fs:${encodeBase64Url(title)}`,
        type: item.type,
        name: title || item.title,
        poster: item.poster,
        languageTag: item.languageTag,
        posterShape: 'poster',
        behaviorHints: item.type === 'movie' ? { defaultVideoId: `fs:${encodeBase64Url(title)}`, hasScheduledVideos: false } : undefined
    };
}

function getFrenchPoster(details) {
    const posters = details.images?.posters || [];
    const frenchPoster = posters.find(poster => poster.iso_639_1 === 'fr');
    const fallbackPoster = posters.find(poster => !poster.iso_639_1);
    const posterPath = frenchPoster?.file_path || details.poster_path || fallbackPoster?.file_path;
    return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
}

async function searchTMDB(title, type, tmdbKey) {
    if (!tmdbKey) return null;

    try {
        const cleanTitle = title.replace(/\(?\d{4}\)?/g, '').replace(/[^\w\s\u00C0-\u017F]/g, ' ').replace(/\s+/g, ' ').trim();
        const mediaType = type === 'movie' ? 'movie' : 'tv';
        const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanTitle)}&language=fr-FR`;
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) return null;

        const searchData = await searchResponse.json();
        if (!searchData.results?.length) return null;

        let result = searchData.results[0];
        for (const candidate of searchData.results.slice(0, 5)) {
            if ((candidate.title || candidate.name || '').toLowerCase() === cleanTitle.toLowerCase()) {
                result = candidate;
                break;
            }
        }

        const detailsResponse = await fetch(`https://api.themoviedb.org/3/${mediaType}/${result.id}?api_key=${tmdbKey}&language=fr-FR&append_to_response=external_ids,images&include_image_language=fr,null`);
        if (!detailsResponse.ok) return null;

        const details = await detailsResponse.json();
        return {
            tmdbId: result.id,
            imdbId: details.external_ids?.imdb_id || details.imdb_id || null,
            poster: getFrenchPoster(details),
            backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : null,
            year: details.release_date?.substring(0, 4) || details.first_air_date?.substring(0, 4),
            title: details.title || details.name,
            description: details.overview,
            rating: details.vote_average,
            genres: details.genres?.map(genre => genre.name) || [],
            runtime: details.runtime
        };
    } catch (error) {
        console.error('TMDB Error:', error.message);
        return null;
    }
}

async function testTMDBKey(tmdbKey) {
    if (!tmdbKey) return { valid: false, error: 'missing_key' };

    try {
        const response = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(tmdbKey)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { valid: false, error: data.status_message || 'invalid_key' };
        }
        return { valid: Boolean(data.images?.secure_base_url) };
    } catch (error) {
        return { valid: false, error: 'tmdb_unreachable' };
    }
}

async function fetchPage(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return null;
        return await response.text();
    } catch (error) {
        return null;
    }
}

async function fetchSearchPage(query, page = 1) {
    try {
        const response = await fetch(`${FRENCH_STREAM_ORIGIN}/engine/ajax/search.php`, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': `${FRENCH_STREAM_ORIGIN}/`,
                'Origin': FRENCH_STREAM_ORIGIN,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `query=${encodeURIComponent(query)}&page=${page}`
        });
        if (!response.ok) return null;
        return await response.text();
    } catch (error) {
        return null;
    }
}

function getQualityTag(item) {
    const text = `${item?.languageText || ''} ${item?.title || ''}`.toUpperCase();
    const checks = [
        ['HDLight', /\\bHDLIGHT\\b/],
        ['WEB-DL', /\\bWEB[ -]?DL\\b/],
        ['WEBRip', /\\bWEBRIP\\b/],
        ['BluRay', /\\bBLURAY\\b/],
        ['HDRip', /\\bHDRIP\\b/],
        ['FHD', /\\bFHD\\b/],
        ['HD', /\\bHD\\b/],
        ['TS', /\\bTS\\b/],
        ['CAM', /\\bCAM\\b/]
    ];
    return checks.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function getLanguageTag(item) {
    const text = `${item?.languageText || ''} ${item?.title || ''}`.toUpperCase();
    const hasDub = /\bVF\b|\bFRENCH\b|\bTRUEFRENCH\b/.test(text);
    const hasSub = /\bVOSTFR\b/.test(text);
    if (hasDub && hasSub) return 'DUB_SUB';
    if (hasDub) return 'DUB';
    if (hasSub) return 'SUB';
    return 'NONE';
}

function betterPosterUrl(imdbId, languageTag, baseUrl) {
    if (!imdbId || !/^tt\d+$/i.test(imdbId)) return null;
    const safeId = encodeURIComponent(imdbId);
    if (!languageTag || languageTag === 'NONE') return `${BETTERPOSTER_BASE}${safeId}.jpg`;
    return `${baseUrl.replace(/\/$/, '')}/poster/${safeId}/${languageTag.toLowerCase()}.svg`;
}

function escapeXml(value) {
    return String(value).replace(/[<>&\"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\"': '&quot;', "'": '&apos;' }[char]));
}

function posterSvg(imageBase64, mime, tag) {
    const badge = (x, width, label, color) => `<rect x="${x}" y="18" width="${width}" height="54" rx="10" fill="${color}" opacity="0.96"/><text x="${x + width / 2}" y="54" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>`;
    let badges = '';
    if (tag === 'dub') badges = badge(18, 105, 'DUB', '#1976d2');
    else if (tag === 'sub') badges = badge(18, 105, 'SUB', '#d62828');
    else badges = badge(18, 105, 'DUB', '#1976d2') + badge(133, 105, 'SUB', '#d62828');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">
  <image href="data:${mime};base64,${imageBase64}" x="0" y="0" width="500" height="750" preserveAspectRatio="xMidYMid slice"/>
  ${badges}
</svg>`;
}
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

async function getEnhancedPosterResponse(request, imdbId, tag, ctx) {
    if (!/^tt\d+$/i.test(imdbId) || !['dub', 'sub', 'dub_sub'].includes(tag)) return new Response('Invalid poster request', { status: 400 });
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.local/${encodeURIComponent(`poster:${imdbId}:${tag}`)}`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const upstream = await fetch(`${BETTERPOSTER_BASE}${encodeURIComponent(imdbId)}.jpg`, { headers: { 'User-Agent': 'FrenchStreamEnhanced/0.1' } });
    if (!upstream.ok) return new Response('BetterPoster unavailable', { status: 502 });
    const mime = upstream.headers.get('content-type') || 'image/jpeg';
    const base64 = arrayBufferToBase64(await upstream.arrayBuffer());
    const body = posterSvg(base64, mime, tag);
    const response = new Response(body, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': `public, max-age=${POSTER_CACHE_TTL}, s-maxage=${POSTER_CACHE_TTL}, stale-while-revalidate=3600` } });
    ctx?.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

function scrapeItems(htmlBody, type) {
    const $ = cheerio.load(htmlBody);
    const items = [];
    const $items = $('.short-in, .movie-item, .short, article.short, .th-item');

    $items.each((i, el) => {
        const $link = $(el).find('a[href]').first();
        let title = $(el).find('.short-title, .th-title, h3, h4, .title').text().trim() || $link.attr('title') || '';
        let poster = $(el).find('img').first().attr('src') || '';
        if (poster && !poster.startsWith('http')) poster = FRENCH_STREAM_ORIGIN + poster;

        const languageText = $(el).text().replace(/\s+/g, ' ').trim();
        const languageTag = getLanguageTag({ title, languageText });
        const isVostfrOnly = languageTag === 'SUB';
        const quality = getQualityTag({ title, languageText });

        if (title && $link.attr('href')) items.push({ title, poster, href: $link.attr('href'), type, languageText, languageTag, quality, isVostfrOnly });
    });

    return items;
}

function scrapeSearchItems(htmlBody, type) {
    const $ = cheerio.load(htmlBody);
    const items = [];

    $('.search-item').each((i, el) => {
        const $item = $(el);
        const title = $item.find('.search-title').first().text().trim();
        let poster = $item.find('img').first().attr('src') || '';
        const onclick = $item.attr('onclick') || '';
        const hrefMatch = onclick.match(/location\.href=['"]([^'"]+)['"]/i);
        const href = hrefMatch ? hrefMatch[1] : $item.find('a[href]').first().attr('href');
        const itemType = inferSearchItemType(title, href);

        if (!title || !href || itemType !== type) return;
        if (poster && !poster.startsWith('http')) poster = FRENCH_STREAM_ORIGIN + poster;
        const languageTag = getLanguageTag({ title, languageText: title });
        items.push({ title, poster, href, type: itemType, languageText: title, languageTag, isVostfrOnly: languageTag === 'SUB' });
    });

    return items;
}

function inferSearchItemType(title, href = '') {
    const value = `${title} ${href}`.toLowerCase();
    return /saison|season|\/s-tv\//i.test(value) ? 'series' : 'movie';
}

function buildSearchQueries(query) {
    const cleanQuery = cleanSearchTitle(query);
    const withoutAccents = cleanQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const compact = withoutAccents.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(new Set([query.trim(), cleanQuery, withoutAccents, compact].filter(Boolean))).slice(0, 3);
}

function normalizeSearchValue(value) {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isRelevantSearchResult(title, query) {
    const queryTokens = normalizeSearchValue(query).split(' ').filter(token => token.length > 1);
    if (queryTokens.length <= 1) return true;
    const titleValue = normalizeSearchValue(title);
    return queryTokens.every(token => titleValue.includes(token));
}

function cleanSearchTitle(title) {
    return (title || '')
        .replace(/\(?\d{4}\)?/g, '')
        .replace(/\b(VF|VOSTFR|TRUEFRENCH|FRENCH|HD|HDRIP|WEBRIP|BLURAY)\b/gi, '')
        .replace(/[^\w\s\u00C0-\u017F'’:-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function searchFrenchStream(query, type) {
    const searches = await Promise.all(buildSearchQueries(query).map(async searchQuery => {
        const htmlBody = await fetchSearchPage(searchQuery);
        if (htmlBody) return scrapeSearchItems(htmlBody, type);

        const searchUrl = `${FRENCH_STREAM_ORIGIN}/index.php?do=search&subaction=search&story=${encodeURIComponent(searchQuery)}`;
        const fallbackBody = await fetchPage(searchUrl);
        return fallbackBody ? scrapeItems(fallbackBody, type) : [];
    }));

    const seen = new Set();
    const results = [];
    searches.flat().forEach(item => {
        const cleanTitle = item.type === 'series' ? cleanSeriesTitle(item.title) : cleanSearchTitle(item.title);
        const key = `${item.type}:${cleanTitle.toLowerCase()}`;
        if (!cleanTitle || seen.has(key) || !isRelevantSearchResult(cleanTitle, query)) return;
        seen.add(key);
        results.push({ ...item, searchTitle: cleanTitle });
    });

    return results;
}

function cleanSeriesTitle(title) {
    return title
        .replace(/[\s\-–]+(Saison|S|Season)\s*\d+/gi, '')
        .replace(/\s+\d+$/, '')
        .trim();
}

function parseExtra(extraParts, searchParams) {
    const extra = {};
    if (searchParams.has('search')) extra.search = searchParams.get('search');

    extraParts.forEach(part => {
        const [key, ...valueParts] = decodeURIComponent(part).split('=');
        if (key && valueParts.length) extra[key] = valueParts.join('=');
    });

    return extra;
}

async function hashConfig(config) {
    const safeConfig = { ...config, tmdbKey: config.tmdbKey ? await sha256(config.tmdbKey) : null };
    return sha256(JSON.stringify(safeConfig));
}

async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function withJsonCache(ctx, key, ttl, producer) {
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.local/${encodeURIComponent(key)}`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const data = await producer();
    const response = json(data, 200, ttl);
    ctx?.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

async function putMeta(meta) {
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.local/${encodeURIComponent(getMetaCacheKey(meta.type, meta.id))}`);
    await cache.put(cacheKey, json({ meta }, 200, META_CACHE_TTL));
}

async function getCachedMeta(type, id) {
    id = decodeStremioPathId(id);
    if (!type || !id) return null;
    const cache = caches.default;
    const cached = await cache.match(new Request(`https://cache.local/${encodeURIComponent(getMetaCacheKey(type, id))}`));
    if (!cached) return resolveMetaFromFsId(type, id);
    const data = await cached.json();
    return data.meta || resolveMetaFromFsId(type, id);
}

function getMetaCacheKey(type, id) {
    return `${CACHE_VERSION}:meta:${type}:${id}`;
}

async function resolveMetaFromFsId(type, id) {
    const meta = createBasicMetaFromFsId(type, id);
    if (!meta) return null;
    const resolved = await resolveCinemetaMeta(meta.name, type) || meta;
    if (resolved && !resolved.frenchpulse) {
        resolved.frenchpulse = buildFrenchPulseMeta({
            imdbId: resolved.id?.startsWith('tt') ? resolved.id : null,
            title: resolved.name || meta.name,
            year: resolved.releaseInfo || null,
            poster: resolved.poster || null,
            backdrop: resolved.background || null
        });
    }
    const results = await searchFrenchStream(meta.name, type);
    const frenchDescription = await fetchFrenchStreamDescription(results[0]?.href);
    return frenchDescription ? { ...resolved, description: frenchDescription } : resolved;
}

function json(data, status = 200, ttl = 0) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    };

    if (ttl) {
        headers['Cache-Control'] = `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${Math.floor(ttl / 2)}`;
    }

    return new Response(JSON.stringify(data), { status, headers });
}

function html(body) {
    return new Response(body, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=300'
        }
    });
}
