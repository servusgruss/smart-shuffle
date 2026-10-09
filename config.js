/* Optional: Client ID der eigenen Spotify-App fest eintragen.
 * Dann muss sie auf keinem Gerät mehr eingegeben werden.
 * Die Client ID ist kein Geheimnis (sie steht bei jedem Login ohnehin in der Adresszeile);
 * geheim wäre nur das Client Secret – und das braucht diese App nicht.
 */
window.SMART_SHUFFLE_CONFIG = {
  clientId: '',
  // Adresse des eigenen KI-Workers, z. B. 'https://smart-shuffle-ki.NAME.workers.dev'.
  // Als Voreinstellung für alle Geräte; in der App pro Gerät änderbar.
  kiUrl: '',
};
