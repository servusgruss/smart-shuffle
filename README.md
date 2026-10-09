# Smart Shuffle

Web-App für einen intelligenteren Spotify-Shuffle: Wunsch sprechen oder tippen
(„nur Kraftklub und Indie, ohne Rap“), die App filtert deine Lieblingssongs, mischt
so, dass derselbe Interpret nicht ständig hintereinander kommt, und spielt alles auf
deinem iPhone ab. Läuft komplett im Browser (iPhone-Safari), ohne Server und ohne
Client Secret (OAuth mit PKCE).

App: `https://servusgruss.github.io/smart-shuffle/`

## Funktionen
- **Spracheingabe** auf Deutsch (Web Speech API in Safari)
- **Versteht Hörfehler bei Namen:** „Kraft Club“ → Kraftklub, „Billy Eilish“ → Billie Eilish,
  „Apatsche“ → Apache 207. Abgleich gegen die Interpreten *deiner* Bibliothek mit
  Tippabstand und deutscher Aussprache (Kölner Phonetik), komplett lokal, ohne KI-Dienst.
- **Kriterien:** „nur …“, „ohne/kein …“, „die letzten 50“, „alle“, Interpret, Genre, Songtitel,
  Jahrzehnt/Jahr („90er“, „aus den 2000ern“, „von 1995“ – nach Erscheinungsjahr des Albums)
- **Umfang:** Letzte 10 / 50 / 100 / 250 / Alle Lieblingssongs
- **Smart Shuffle:** derselbe Interpret frühestens nach 3 anderen Songs wieder
- **Abspielen ohne Längenlimit:** die Reihenfolge wird in eine eigene private Playlist
  „Smart Shuffle“ geschrieben (bei jedem Abspielen überschrieben) und von dort gestartet
- **Merkt sich alles auf dem Gerät:** Login, Client ID, Bibliothek, Genres, Design und
  letzten Wunsch. Beim Öffnen werden nur neu gespeicherte Songs nachgeladen.
- **KI (optional):** versteht auch Stimmungen und Anlässe („was Ruhiges zum Kochen“) über einen
  eigenen Cloudflare Worker mit Claude – Einrichtung in [`worker/README.md`](worker/README.md).
  Ohne KI läuft die Erkennung komplett auf dem Gerät.
- **5 Designs** (Einstellungen → Design): Grün (Spotify-Stil), Weiß, Schwarz, Nebel, Vinyl
- **Als App auf den Home-Bildschirm** legbar (eigenes Icon, Vollbild)

## Einrichtung
1. **GitHub Pages:** Repo → Settings → Pages → *Deploy from a branch* → `main` / `(root)`
2. **Spotify-App** auf <https://developer.spotify.com/dashboard> anlegen, *Web API* anhaken
   - Redirect URI: `https://servusgruss.github.io/smart-shuffle/` (mit `/` am Ende)
   - User Management: eigenes Spotify-Konto eintragen
3. **Client ID** in der App unter Einstellungen eintragen. Sie wird nur auf dem jeweiligen
   Gerät gespeichert (`config.js` bleibt leer), damit jede Person ihr eigenes Spotify nutzen kann.
4. Anmelden. Nach Updates mit neuen Rechten fordert die App einmal zur Neuanmeldung auf.

Seit Februar 2026 braucht der Besitzer der Spotify-App **Premium**; Apps im Development
Mode sind auf wenige Nutzer begrenzt – für privaten Gebrauch reicht das.

## Mehrere Personen
- **Über deine Spotify-App:** Bis zu 5 Personen im Dashboard unter *User Management*
  eintragen; sie nutzen deine Client ID.
- **Mit eigener Spotify-App:** Jede Person legt eine eigene App an (Premium nötig), trägt
  dieselbe Redirect URI ein und gibt ihre Client ID auf ihrem Gerät ein.
- Meldet sich auf einem Gerät eine andere Person an, wird die vorherige Bibliothek entfernt.
  „Abmelden“ löscht Login und Songs vom Gerät; Client ID und Design bleiben.

## Sicherheit
- Das Spotify-Passwort sieht die App nie, Login läuft auf accounts.spotify.com
- Rechte: Profil lesen, Lieblingssongs lesen, Wiedergabe steuern, *eigene private*
  Playlist anlegen/befüllen. Kein Löschen, keine Käufe.
- Content-Security-Policy: Die Seite lädt keine fremden Skripte und spricht nur mit Spotify
  und dem eigenen KI-Worker (`*.workers.dev`)
- Der KI-Schlüssel liegt nur im Worker, nie auf einem Gerät
- Zugriff jederzeit entziehen: spotify.com → Konto → Apps

## Dateien
| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche |
| `style.css` | Layout und die 5 Designs (nur Farb-/Schrift-Tokens je Design) |
| `app.js` | Login, Spotify-API, Zwischenspeicher, Quellen, Shuffle, Wiedergabe, Sprache |
| `match.js` | Wunsch-Zerlegung und unscharfe Zuordnung zu Interpreten/Genres |
| `config.js` | optionale Voreinstellungen (Client ID, KI-Adresse) |
| `worker/` | KI-Worker für Cloudflare (eigene Anleitung) |
| `test/` | Tests: Namenserkennung (`node test/match.test.js`), Worker (`node test/worker.test.mjs`) |

## Erweiterbar
Weitere Quellen (eigene Playlists, gespeicherte Alben) werden in `app.js` unter `SOURCES`
ergänzt. Hinweis: Spotify liefert Playlist-Inhalte seit 2026 nur noch für eigene oder
gemeinsame Playlists.

## Bekannte Grenzen
- Stimmungen erkennt die KI über Genres und bekannte Interpreten, nicht pro einzelnem Song
  (Spotify gibt neuen Apps keine Audio-Merkmale mehr).

- **Genres:** Mit KI-Server ordnet Claude einmalig alle Interpreten ihren Genres zu (Pakete à 150,
  gespeichert auf dem Gerät). Ohne KI fragt die App Spotify einzeln pro Interpret – Spotify bremst
  das bei großen Bibliotheken stark, es geht dann bei jedem Öffnen ein Stück weiter.
- Jahrzehnte richten sich nach dem Erscheinungsjahr des Albums; Songs auf späteren
  Best-of-Alben oder Remastern zählen zum späteren Jahr.

## Offene Punkte
- Client ID als Voreinstellung in `config.js`, damit Freunde nur den Link öffnen und sich anmelden
