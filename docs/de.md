# Mailcow für Gladys Assistant

Überwache deinen Mailserver [mailcow: dockerized](https://mailcow.email) aus Gladys: Container,
Mail-Warteschlange, Quarantäne, gesperrte IPs, Speicher, Domains und Postfächer — mit
Szenen-Auslösern, Szenen-Aktionen und Dashboard-Widgets.

Benötigt **Gladys 5.3 oder neuer** und einen mailcow-API-Schlüssel.

## 1. Einen API-Schlüssel in mailcow erstellen

1. Melde dich als Administrator an der mailcow-Weboberfläche an.
2. Öffne **System → Konfiguration → Zugang → Administratoren** und klappe **API** auf.
3. Wähle den Schlüssel:
   - **Nur Lesen**: reicht zum Überwachen des Servers (empfohlen);
   - **Lesen und Schreiben**: nur nötig, wenn Gladys die Warteschlange senden oder Domains und
     Postfächer ein- und ausschalten soll.
4. Trage bei **API-Zugriff von diesen IPs/CIDR erlauben** die IP-Adresse ein, von der Gladys
   mailcow erreicht (die IP des Gladys-Rechners oder seine öffentliche IP, wenn mailcow im
   Internet steht).
5. Aktiviere **API aktivieren** und speichere. Kopiere den Schlüssel.

> Fehlt die IP, antwortet mailcow „api access denied for ip …“: **Verbindung testen** zeigt
> diese IP, trage sie in die Liste ein.

## 2. Die Integration konfigurieren

| Feld                                  | Was eintragen                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Lokale Adresse                        | mailcow in deinem Netzwerk, z. B. `https://192.168.1.20`. Leer, wenn mailcow woanders ist.                   |
| Öffentliche Adresse                   | mailcow im Internet, z. B. `https://mail.beispiel.de`.                                                       |
| API-Schlüssel                         | Der oben kopierte Schlüssel.                                                                                 |
| Zertifikat der lokalen Adresse prüfen | Deaktivieren, wenn die lokale Adresse eine IP ist (das Zertifikat nennt die Domain).                         |
| Aktualisierungsintervall (s)          | Wie oft der Server gelesen wird: 60 s bis 1 h, standardmäßig 300 s.                                          |
| Ein Gerät pro Domain                  | Standardmäßig an.                                                                                            |
| Ein Gerät pro Postfach                | Standardmäßig aus; für einen Server mit wenigen Postfächern (höchstens 200).                                 |
| Änderungen erlauben                   | Standardmäßig aus. An (mit Schreibschlüssel): Warteschlange senden, Domains/Postfächer ein- und ausschalten. |
| Schwellen                             | Warteschlange (20 Mails), Speicher (85 %), Postfach-Kontingent (90 %): für die Szenen-Auslöser.              |
| Detaillierte Protokolle               | Protokolliert jedes Lesen. Der API-Schlüssel wird nie protokolliert.                                         |

Klicke dann auf **Verbindung testen**: Es liest den Server und fasst ihn zusammen (Version,
Container, Warteschlange, Quarantäne, Speicher, Domains, Postfächer) oder sagt, was nicht
stimmt.

## 3. Lokal und Cloud

Die Integration kennt zwei Wege zu mailcow:

- die **lokale Adresse** ist der Transport `local`;
- die **öffentliche Adresse** ist der Transport `cloud` (ein Server bei einem Hoster oder dein
  eigener Server, über das Internet erreicht).

Gib eine oder beide an. Mit beiden wählt der Schalter **Lokale Verbindung bevorzugen** (von
Gladys angezeigt), welche zuerst versucht wird; die andere dient als Ersatz. Jedes Gerät zeigt
ein Abzeichen mit der Adresse, die geantwortet hat. Wird der Ersatz verwendet, ist das Abzeichen
**eingeschränkt** (oranger Punkt): Es funktioniert, aber nicht über die bevorzugte Adresse.

Das Zertifikat der öffentlichen Adresse wird immer geprüft. Nur die lokale Adresse kann die
Prüfung auslassen.

## 4. Geräte

Öffne **Integrationen → Mailcow → Entdecken**, um sie anzulegen.

**mailcow server** (immer): laufende Container, gestoppte Container, Mail-Warteschlange,
Quarantäne, gesperrte IPs, belegter Mailspeicher (GB und %), Domains, Postfächer,
mailcow-Version.

**mailcow &lt;Domain&gt;** (eine pro Domain): aktiv (Schalter), Postfächer, Aliasse, Nachrichten,
belegter Speicher.

**&lt;Postfachadresse&gt;** (eines pro Postfach, falls aktiviert): aktiv (Schalter), belegtes
Kontingent (%), belegter Speicher, Nachrichten.

Die Schalter **aktiv** sind aus Gladys nur nutzbar, wenn **Änderungen erlauben** an ist; sonst
sind sie schreibgeschützt.

## 5. Szenen-Auslöser

Wähle in einer Szene **Integrationen → Mailcow**. Ein Auslöser feuert, wenn sich zwischen zwei
Lesevorgängen etwas _ändert_: Das erste Lesen nach einem Start löst nie etwas aus.

| Auslöser                               | Schlüssel             | Filter           | Variablen                                          |
| -------------------------------------- | --------------------- | ---------------- | -------------------------------------------------- |
| Ein mailcow-Container ist gestoppt     | `container_down`      | Container        | `container`, `state`                               |
| Ein mailcow-Container läuft wieder     | `container_up`        | Container        | `container`                                        |
| Mail-Warteschlange zu lang             | `queue_high`          | –                | `queue_size`, `threshold`                          |
| Mailspeicher fast voll                 | `storage_high`        | –                | `used_percent`, `threshold`                        |
| Postfach fast voll                     | `quota_high`          | Domain, Postfach | `mailbox`, `domain`, `percent`, `threshold`        |
| Eine Mail wurde in Quarantäne gestellt | `quarantine_new`      | Empfänger        | `sender`, `recipient`, `subject`, `score`, `virus` |
| Eine IP wurde gesperrt                 | `ip_banned`           | –                | `ip`                                               |
| mailcow-Server nicht erreichbar        | `connection_lost`     | –                | `reason`, `message`                                |
| mailcow-Server wieder erreichbar       | `connection_restored` | –                | `transport`                                        |

Die Schwellen lösen einmal aus, wenn der Wert sie überschreitet. Nutze die Variablen in den
folgenden Aktionen, z. B. eine Nachricht `{{triggerEvent.data.container}} ist gestoppt`. Pro
Lesen werden höchstens 10 Ereignisse einer Art gesendet (eine Spam-Welle überflutet deine Szenen
nicht).

## 6. Szenen-Aktionen

| Aktion                         | Schlüssel            | Felder                 | Ausgaben                                                                      |
| ------------------------------ | -------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| mailcow-Server jetzt lesen     | `refresh`            | –                      | `reachable`, `queue_size`, `quarantine`, `containers_down`, `storage_percent` |
| Mail-Warteschlange senden      | `flush_queue`        | –                      | `queued_before`                                                               |
| Postfach ein- oder ausschalten | `set_mailbox_active` | Postfachadresse, aktiv | `changed`                                                                     |

`flush_queue` und `set_mailbox_active` benötigen **Änderungen erlauben** und einen Schlüssel mit
Schreibzugriff.

## 7. Dashboard-Widgets

- **mailcow-Server**: verwendete Adresse, Version, Container, gestoppte Container,
  Warteschlange, Speicheranzeige, Quarantäne und gesperrte IPs, eine Schaltfläche
  **Aktualisieren**, eine Schaltfläche **Warteschlange senden** (wenn Änderungen erlaubt sind,
  mit Bestätigung) und ein Link zu mailcow.
- **mailcow-Quarantäne**: die letzten Mails in Quarantäne (Betreff, Absender, Empfänger, Wert
  oder Virus). Einstellung: Anzahl der Mails (1 bis 8).
- **mailcow-Postfächer**: die Postfächer, die ihrem Kontingent am nächsten sind.
  Einstellungen: Anzahl (1 bis 10) und eine optionale Domain.

## 8. Fehlerbehebung

| Meldung                                   | Was tun                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Der mailcow-Server antwortet nicht        | Prüfe die Adresse und ob Gladys ihn erreicht (Firewall, DNS).                          |
| Das HTTPS-Zertifikat wird abgelehnt       | Bei einer lokalen Adresse als IP „Zertifikat der lokalen Adresse prüfen“ deaktivieren. |
| Der API-Schlüssel wird abgelehnt          | Kopiere den Schlüssel erneut; prüfe, ob die API aktiviert ist.                         |
| mailcow verweigert der IP … die API       | Trage diese IP bei „API-Zugriff von diesen IPs/CIDR erlauben“ ein.                     |
| Etwas hat geantwortet, aber nicht die API | Gib die Adresse der mailcow-Weboberfläche an, ohne Pfad.                               |
| Änderungen sind ausgeschaltet             | Aktiviere „Änderungen erlauben“ und verwende den Schlüssel mit Schreibzugriff.         |
| Dieser API-Schlüssel ist schreibgeschützt | Verwende für Änderungen den Schlüssel mit Schreibzugriff.                              |

Ein Bereich, auf den mailcow nicht antwortet (etwa bei einer älteren Version), wird einfach
ausgelassen: Der Rest wird trotzdem gelesen, und **Verbindung testen** listet auf, was nicht
gelesen wurde.
