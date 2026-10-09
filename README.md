# Smart Shuffle (Prototyp)

Web-App, die die letzten 100 gespeicherten Spotify-Songs nach gesprochenen oder getippten
Kriterien filtert, „smart“ mischt (kein Interpret zweimal hintereinander) und auf einem
Spotify-Gerät abspielt. Dieser Prototyp dient vor allem dem **Verbindungstest**.

Läuft komplett im Browser (iPhone-Safari geeignet), ohne Server und ohne Client Secret
(OAuth mit PKCE).

## Einrichtung

### 1. GitHub Pages aktivieren
Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)`.
Nach ca. einer Minute ist die App erreichbar unter
`https://<github-name>.github.io/<repo-name>/`.

### 2. Spotify-App anlegen
1. <https://developer.spotify.com/dashboard> öffnen → **Create app**
2. Name/Beschreibung frei wählen, bei *Which API/SDKs* **Web API** anhaken
3. **Redirect URI** exakt so eintragen, wie sie in der App unter „1 · Spotify verbinden“ angezeigt
   wird, z. B. `https://<github-name>.github.io/smart-shuffle/` (inkl. abschließendem `/`)
4. Unter **User Management** das eigene Spotify-Konto (E-Mail) eintragen
5. **Client ID** kopieren (das Client Secret wird *nicht* gebraucht)

Hinweis: Seit Februar 2026 braucht der Besitzer der Spotify-App **Premium**, und eine App im
Development Mode ist auf wenige Nutzer begrenzt – für den privaten Gebrauch reicht das.

### 3. Testen
1. Seite auf dem iPhone in Safari öffnen, Client ID eintragen, **Mit Spotify anmelden**
2. **Songs laden** → **Genres laden**
3. Mikrofon antippen und z. B. sagen: *„nur Indie, ohne Rap“* oder
   *„die letzten 50 Songs von Cro“*
4. Spotify-App kurz öffnen (damit das iPhone als Gerät aktiv ist), dann **Auf Spotify abspielen**

Die Checkliste „Verbindungstest“ zeigt für jeden Schritt ✓ oder ✕ mit Fehlergrund.

## Was der Prototyp kann
| Bereich | Stand |
|---|---|
| Login (PKCE, Token-Erneuerung) | ✓ |
| Letzte 100 gespeicherte Songs | ✓ |
| Genres pro Interpret (zwischengespeichert) | ✓ |
| Spracheingabe (Web Speech API, Deutsch) | ✓ |
| Kriterien: „nur …“, „ohne/kein …“, „die letzten N“, Interpret, Genre, Songtitel | ✓ regelbasiert |
| Smart Shuffle: Interpreten verteilen | ✓ |
| Wiedergabe über Spotify Connect | ✓ |
| Stimmung („ruhig“, „energiegeladen“) per KI | geplant |

## Bekannte Grenzen
- Spracheingabe funktioniert am zuverlässigsten direkt in Safari; als Home-Bildschirm-App
  kann iOS das Mikrofon einschränken.
- Stimmungsbegriffe wie „ruhig“ werden noch nicht verstanden (Spotify liefert für neue Apps
  keine Audio-Features mehr) – das ist der nächste Schritt mit KI.
- Lokal testen: `python3 -m http.server 8888` und als Redirect URI
  `http://127.0.0.1:8888/` eintragen (Spotify erlaubt `localhost` nicht).

## Dateien
- `index.html` – Oberfläche
- `style.css` – Design (hell/dunkel automatisch)
- `app.js` – Login, Spotify-API, Spracheingabe, Kriterien-Parser, Shuffle
