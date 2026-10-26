// -----------------------------------------------------------------------------
// The texts the user reads: what went wrong, what the server looks like.
//
// Every one is a multi-language object (`{ en, fr, de, es }`), shown in the
// Configuration screen (connection status, answers of the action buttons) or
// as a toast of a widget button.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { localize, pick } from '../i18n.js';
import { summaryOf } from './snapshot.js';

/**
 * What a MailcowError means for the user, and what to do about it.
 *
 * @param {Error & { code?: string, detail?: string }} err
 */
export function describeError(err) {
  const detail = err?.detail ?? '';
  switch (err?.code) {
    case 'not_configured':
      return {
        en: 'Fill in the address of your mailcow server and its API key.',
        fr: "Renseignez l'adresse de votre serveur mailcow et sa clé d'API.",
        de: 'Trage die Adresse deines mailcow-Servers und seinen API-Schlüssel ein.',
        es: 'Indique la dirección de su servidor mailcow y su clave de API.',
      };
    case 'timeout':
    case 'network':
      return {
        en: `The mailcow server does not answer (${detail || err.code}). Check its address and that Gladys can reach it.`,
        fr: `Le serveur mailcow ne répond pas (${detail || err.code}). Vérifiez son adresse et que Gladys peut le joindre.`,
        de: `Der mailcow-Server antwortet nicht (${detail || err.code}). Prüfe seine Adresse und ob Gladys ihn erreichen kann.`,
        es: `El servidor mailcow no responde (${detail || err.code}). Compruebe su dirección y que Gladys pueda alcanzarlo.`,
      };
    case 'tls':
      return {
        en: `The HTTPS certificate of the server is refused (${detail}). Reached by its LAN IP, a mailcow certificate does not match: turn off "Check the certificate of the LAN address".`,
        fr: `Le certificat HTTPS du serveur est refusé (${detail}). Joint par son IP locale, le certificat de mailcow ne correspond pas : désactivez « Vérifier le certificat de l'adresse locale ».`,
        de: `Das HTTPS-Zertifikat des Servers wird abgelehnt (${detail}). Über die lokale IP erreicht, passt das mailcow-Zertifikat nicht: Schalte „Zertifikat der lokalen Adresse prüfen“ aus.`,
        es: `Se rechaza el certificado HTTPS del servidor (${detail}). Accedido por su IP local, el certificado de mailcow no coincide: desactive «Verificar el certificado de la dirección local».`,
      };
    case 'auth':
      return {
        en: 'The API key is refused. Copy it again from mailcow: System → Configuration → Access → Administrators → API.',
        fr: "La clé d'API est refusée. Copiez-la à nouveau depuis mailcow : Système → Configuration → Accès → Administrateurs → API.",
        de: 'Der API-Schlüssel wird abgelehnt. Kopiere ihn erneut aus mailcow: System → Konfiguration → Zugang → Administratoren → API.',
        es: 'Se rechaza la clave de API. Cópiela de nuevo desde mailcow: Sistema → Configuración → Acceso → Administradores → API.',
      };
    case 'forbidden_ip':
      return {
        en: `mailcow refuses the API to the IP ${detail}: add it to "Allow API access from these IPs/CIDR" next to the API key.`,
        fr: `mailcow refuse l'API à l'IP ${detail} : ajoutez-la dans « Autoriser l'accès API depuis ces IP/CIDR », à côté de la clé d'API.`,
        de: `mailcow verweigert der IP ${detail} die API: Füge sie bei „API-Zugriff von diesen IPs/CIDR erlauben“ neben dem API-Schlüssel hinzu.`,
        es: `mailcow niega la API a la IP ${detail}: añádala en «Permitir acceso a la API desde estas IP/CIDR», junto a la clave de API.`,
      };
    case 'read_only':
      return {
        en: 'This API key is read-only: use the read-write key to make changes from Gladys.',
        fr: "Cette clé d'API est en lecture seule : utilisez la clé en lecture-écriture pour agir depuis Gladys.",
        de: 'Dieser API-Schlüssel ist schreibgeschützt: Verwende den Schlüssel mit Schreibzugriff, um aus Gladys zu ändern.',
        es: 'Esta clave de API es de solo lectura: use la clave de lectura y escritura para hacer cambios desde Gladys.',
      };
    case 'changes_disabled':
      return {
        en: 'Changes are turned off: enable "Allow changes" in the configuration, with a read-write API key.',
        fr: "Les modifications sont désactivées : activez « Autoriser les modifications » dans la configuration, avec une clé d'API en lecture-écriture.",
        de: 'Änderungen sind ausgeschaltet: Aktiviere „Änderungen erlauben“ in der Konfiguration, mit einem API-Schlüssel mit Schreibzugriff.',
        es: 'Los cambios están desactivados: active «Permitir cambios» en la configuración, con una clave de API de lectura y escritura.',
      };
    case 'invalid_response':
      return {
        en: 'Something answered, but not the mailcow API. Give the address of the mailcow web interface, without any path.',
        fr: "Quelque chose a répondu, mais pas l'API mailcow. Indiquez l'adresse de l'interface web de mailcow, sans chemin.",
        de: 'Etwas hat geantwortet, aber nicht die mailcow-API. Gib die Adresse der mailcow-Weboberfläche an, ohne Pfad.',
        es: 'Algo ha respondido, pero no la API de mailcow. Indique la dirección de la interfaz web de mailcow, sin ruta.',
      };
    case 'api':
      return {
        en: `mailcow refused: ${err.message}`,
        fr: `mailcow a refusé : ${err.message}`,
        de: `mailcow hat abgelehnt: ${err.message}`,
        es: `mailcow lo ha rechazado: ${err.message}`,
      };
    default:
      return {
        en: `Unexpected error: ${err?.message ?? err}`,
        fr: `Erreur inattendue : ${err?.message ?? err}`,
        de: `Unerwarteter Fehler: ${err?.message ?? err}`,
        es: `Error inesperado: ${err?.message ?? err}`,
      };
  }
}

const TRANSPORT_NAMES = {
  [DEVICE_TRANSPORTS.LOCAL]: {
    en: 'the LAN address',
    fr: "l'adresse locale",
    de: 'die lokale Adresse',
    es: 'la dirección local',
  },
  [DEVICE_TRANSPORTS.CLOUD]: {
    en: 'the public address',
    fr: "l'adresse publique",
    de: 'die öffentliche Adresse',
    es: 'la dirección pública',
  },
};

/** "17/18 running (stopped: clamd)" and the like, in one language. */
function containersLine(language, summary) {
  if (summary.containersTotal === null) {
    return pick(language, {
      en: 'Containers: not read.',
      fr: 'Conteneurs : non lus.',
      de: 'Container: nicht gelesen.',
      es: 'Contenedores: no leídos.',
    });
  }
  const stopped = summary.stoppedContainers.length
    ? pick(language, {
        en: ` (stopped: ${summary.stoppedContainers.join(', ')})`,
        fr: ` (arrêtés : ${summary.stoppedContainers.join(', ')})`,
        de: ` (gestoppt: ${summary.stoppedContainers.join(', ')})`,
        es: ` (detenidos: ${summary.stoppedContainers.join(', ')})`,
      })
    : '';
  const count = `${summary.containersRunning}/${summary.containersTotal}`;
  return pick(language, {
    en: `Containers: ${count} running${stopped}.`,
    fr: `Conteneurs : ${count} en marche${stopped}.`,
    de: `Container: ${count} laufen${stopped}.`,
    es: `Contenedores: ${count} en marcha${stopped}.`,
  });
}

const dash = (value) => (value === null || value === undefined ? '–' : value);

/**
 * What "Test the connection" answers: who answered, then the main counters.
 *
 * @param {object} snapshot a fresh snapshot
 * @param {{ transport: string, degraded?: boolean }} status the transport used
 */
export function describeSnapshot(snapshot, status) {
  const summary = summaryOf(snapshot);
  return localize((language) => {
    const via = pick(language, TRANSPORT_NAMES[status.transport] ?? TRANSPORT_NAMES.local);
    const version = snapshot.version ?? '?';
    const lines = [
      pick(language, {
        en: `Connected to mailcow ${version} through ${via}.`,
        fr: `Connecté à mailcow ${version} par ${via}.`,
        de: `Mit mailcow ${version} über ${via} verbunden.`,
        es: `Conectado a mailcow ${version} a través de ${via}.`,
      }),
    ];
    if (status.degraded) {
      lines.push(pick(language, status.message));
    }
    lines.push(containersLine(language, summary));
    lines.push(
      pick(language, {
        en: `Queue: ${dash(summary.queue)}, quarantine: ${dash(summary.quarantine)}, banned IPs: ${dash(summary.bans)}.`,
        fr: `File d'attente : ${dash(summary.queue)}, quarantaine : ${dash(summary.quarantine)}, IP bannies : ${dash(summary.bans)}.`,
        de: `Warteschlange: ${dash(summary.queue)}, Quarantäne: ${dash(summary.quarantine)}, gesperrte IPs: ${dash(summary.bans)}.`,
        es: `Cola: ${dash(summary.queue)}, cuarentena: ${dash(summary.quarantine)}, IP bloqueadas: ${dash(summary.bans)}.`,
      }),
    );
    if (summary.storagePercent !== null) {
      const used = `${dash(summary.storageUsedGb)} / ${dash(summary.storageTotalGb)} GB (${summary.storagePercent} %)`;
      lines.push(
        pick(language, {
          en: `Mail storage: ${used}.`,
          fr: `Stockage des mails : ${used}.`,
          de: `Mailspeicher: ${used}.`,
          es: `Almacenamiento de correo: ${used}.`,
        }),
      );
    }
    lines.push(
      pick(language, {
        en: `Domains: ${dash(summary.domains)}, mailboxes: ${dash(summary.mailboxes)}.`,
        fr: `Domaines : ${dash(summary.domains)}, boîtes mail : ${dash(summary.mailboxes)}.`,
        de: `Domains: ${dash(summary.domains)}, Postfächer: ${dash(summary.mailboxes)}.`,
        es: `Dominios: ${dash(summary.domains)}, buzones: ${dash(summary.mailboxes)}.`,
      }),
    );
    const missing = Object.keys(snapshot.errors ?? {});
    if (missing.length > 0) {
      lines.push(
        pick(language, {
          en: `Not read: ${missing.join(', ')} (see the logs).`,
          fr: `Non lu : ${missing.join(', ')} (voir les journaux).`,
          de: `Nicht gelesen: ${missing.join(', ')} (siehe Protokolle).`,
          es: `No leído: ${missing.join(', ')} (vea los registros).`,
        }),
      );
    }
    return lines.join('\n');
  });
}
