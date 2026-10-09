/* Voreinstellungen für alle Geräte: Client ID der Spotify-App und Adresse des KI-Workers.
 * Dann muss auf keinem Gerät mehr etwas eingegeben werden; in der App bleiben beide pro Gerät änderbar.
 * Die Client ID ist kein Geheimnis (sie steht bei jedem Login ohnehin in der Adresszeile);
 * geheim wäre nur das Client Secret – und das braucht diese App nicht.
 */
window.SMART_SHUFFLE_CONFIG = {
  clientId: 'd0a1b6379491427182a18ed38a983dd4',
  // Adresse des eigenen KI-Workers, z. B. 'https://smart-shuffle-ki.NAME.workers.dev'.
  // Als Voreinstellung für alle Geräte; in der App pro Gerät änderbar.
  kiUrl: 'https://smart-shuffle-ki.jannis-woerner.workers.dev',
};
