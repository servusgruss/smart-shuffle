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
- **Kriterien:** „nur …“, „ohne/kein …“, „die letzten 50“, „alle“, Interpret, Genre, Songtitel
- **Umfang:** Letzte 100 / Letzte 250 / Alle Lieblingssongs
- **Smart Shuffle:** derselbe Interpret frühestens nach 3 anderen Songs wieder
- **Abspielen ohne Längenlimit:** die Reihenfolge wird in eine eigene private Playlist
  „Smart Shuffle“ geschrieben (bei jedem Abspielen überschrieben) und von dort gestartet
- **Merkt sich alles auf dem Gerät:** Login, Client ID, Bibliothek, Genres, Design und
  letzten Wunsch. Beim Öffnen werden nur neu gespeicherte Songs nachgeladen.
- **5 Designs** (Einstellungen → Design): Grün (Spotify-Stil), Weiß, Schwarz, Nebel, Vinyl
- **Als App auf den Home-Bildschirm** legbar (eigenes Icon, Vollbild)

## Einrichtung
1. **GitHub Pages:** Repo → Settings → Pages → *Deploy from a branch* → `main` / `(root)`
2. **Spotify-App** auf <https://developer.spotify.com/dashboard> anlegen, *Web API* anhaken
   - Redirect URI: `https://servusgruss.github.io/smart-shuffle/` (mit `/` am Ende)
   - User Management: eigenes Spotify-Konto eintragen
3. **Client ID** in der App unter Einstellungen eintragen – oder einmalig in `config.js`,
   dann muss sie auf keinem Gerät mehr eingegeben werden (sie ist kein Geheimnis)
4. Anmelden. Nach Updates mit neuen Rechten fordert die App einmal zur Neuanmeldung auf.

Seit Februar 2026 braucht der Besitzer der Spotify-App **Premium**; Apps im Development
Mode sind auf wenige Nutzer begrenzt – für privaten Gebrauch reicht das.

## Sicherheit
- Das Spotify-Passwort sieht die App nie, Login läuft auf accounts.spotify.com
- Rechte: Profil lesen, Lieblingssongs lesen, Wiedergabe steuern, *eigene private*
  Playlist anlegen/befüllen. Kein Löschen, keine Käufe.
- Content-Security-Policy: Die Seite lädt keine fremden Skripte und spricht nur mit Spotify
- Zugriff jederzeit entziehen: spotify.com → Konto → Apps

## Dateien
| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche |
| `style.css` | Layout und die 5 Designs (nur Farb-/Schrift-Tokens je Design) |
| `app.js` | Login, Spotify-API, Zwischenspeicher, Quellen, Shuffle, Wiedergabe, Sprache |
| `match.js` | Wunsch-Zerlegung und unscharfe Zuordnung zu Interpreten/Genres |
| `config.js` | optionale feste Client ID |
| `test/match.test.js` | Tests für die Namenserkennung (`node test/match.test.js`) |

## Erweiterbar
Weitere Quellen (eigene Playlists, gespeicherte Alben) werden in `app.js` unter `SOURCES`
ergänzt. Hinweis: Spotify liefert Playlist-Inhalte seit 2026 nur noch für eigene oder
gemeinsame Playlists.

## Bekannte Grenzen
- Stimmungen („ruhig“, „zum Feiern“) versteht die App noch nicht – Spotify gibt neuen Apps
  keine Audio-Merkmale mehr. Dafür ist eine KI-Anbindung geplant.
- Genres lädt Spotify nur einzeln pro Interpret; beim ersten Start dauert das im
  Hintergrund ein paar Minuten, danach sind sie gespeichert.
