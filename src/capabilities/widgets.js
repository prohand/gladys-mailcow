// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
// Three widgets, declared in the manifest `widgets` field under the same keys:
//   - `mailcow_status`: is the server up, which containers are down, the
//     queue, the quarantine, the storage — the morning glance;
//   - `mailcow_quarantine`: the last mails held in quarantine;
//   - `mailcow_mailboxes`: the mailboxes closest to their quota.
//
// The content is declarative (status rows, tiles, a gauge, a card list,
// buttons): the core renders it with its own theme, dark mode and languages.
// It is computed from the last snapshot of the refresh loop, which nudges the
// widgets after every read: nothing here calls mailcow, except the buttons.
// Contents are checked with `validateWidgetContent` in test/widgets.test.js.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { server, SERVER_FEATURES } from '../devices/server.js';
import { describeError } from '../mailcow/messages.js';
import { summaryOf } from '../mailcow/snapshot.js';

const logger = createLogger({ name: 'widgets' });

export const WIDGET_KEYS = {
  STATUS: 'mailcow_status',
  QUARANTINE: 'mailcow_quarantine',
  MAILBOXES: 'mailcow_mailboxes',
};

// Keys of the `button` actions the contents declare.
export const WIDGET_ACTIONS = {
  REFRESH: 'refresh',
  FLUSH_QUEUE: 'flush_queue',
};

/** Cut a text to `max` characters, with an ellipsis when cut. */
export function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** How long the core may serve the content from its cache: one read. */
function ttlOf(config) {
  return Math.min(3600, Math.max(10, Math.round(config.poll_frequency)));
}

const refreshButton = {
  type: 'button',
  label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: WIDGET_ACTIONS.REFRESH },
};

/** The first rows, shared by every widget: is the server answering? */
function serverRow(monitor) {
  const status = monitor.client.transportStatus();
  const label = { en: 'Server', fr: 'Serveur', de: 'Server', es: 'Servidor' };
  if (!monitor.reachable) {
    return {
      label,
      icon: 'server',
      value: {
        en: 'Unreachable',
        fr: 'Injoignable',
        de: 'Nicht erreichbar',
        es: 'Inaccesible',
      },
      color: WIDGET_COLORS.DANGER,
    };
  }
  const value =
    status.transport === DEVICE_TRANSPORTS.CLOUD
      ? { en: 'Public address', fr: 'Adresse publique', de: 'Öffentlich', es: 'Dirección pública' }
      : { en: 'LAN address', fr: 'Adresse locale', de: 'Lokal', es: 'Dirección local' };
  return {
    label,
    icon: 'server',
    value: status.degraded
      ? {
          en: `${value.en} (fallback)`,
          fr: `${value.fr} (secours)`,
          de: `${value.de} (Ersatz)`,
          es: `${value.es} (respaldo)`,
        }
      : value,
    color: status.degraded ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
  };
}

/** What a widget shows when there is no snapshot to show. */
function unavailableContent(monitor) {
  const message = monitor.lastError
    ? describeError(monitor.lastError)
    : {
        en: 'Waiting for the first read of the server.',
        fr: 'En attente de la première lecture du serveur.',
        de: 'Warten auf das erste Lesen des Servers.',
        es: 'Esperando la primera lectura del servidor.',
      };
  return {
    ttl_seconds: 60,
    components: [
      { type: 'status', items: [serverRow(monitor)] },
      {
        type: 'text',
        variant: 'body',
        text: Object.fromEntries(
          Object.entries(message).map(([language, text]) => [language, truncate(text, 300)]),
        ),
      },
      refreshButton,
    ],
  };
}

function statusContent(monitor) {
  const { snapshot, config } = monitor;
  const summary = summaryOf(snapshot);
  const items = [serverRow(monitor)];
  if (snapshot.version) {
    items.push({
      label: { en: 'Version', fr: 'Version', de: 'Version', es: 'Versión' },
      icon: 'tag',
      value: truncate(snapshot.version, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (summary.containersTotal !== null) {
    items.push({
      label: { en: 'Containers', fr: 'Conteneurs', de: 'Container', es: 'Contenedores' },
      icon: 'box',
      value: `${summary.containersRunning}/${summary.containersTotal}`,
      color: summary.containersDown > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    });
  }
  if (summary.stoppedContainers.length > 0) {
    items.push({
      label: { en: 'Stopped', fr: 'Arrêtés', de: 'Gestoppt', es: 'Detenidos' },
      icon: 'alert-triangle',
      value: truncate(summary.stoppedContainers.join(', '), 40),
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (summary.queue !== null) {
    items.push({
      label: { en: 'Mail queue', fr: "File d'attente", de: 'Warteschlange', es: 'Cola de correo' },
      icon: 'clock',
      value: summary.queue,
      color:
        summary.queue >= config.queue_threshold
          ? WIDGET_COLORS.WARNING
          : summary.queue > 0
            ? WIDGET_COLORS.INFO
            : WIDGET_COLORS.SUCCESS,
    });
  }

  const ids = server.ids(monitor.gladys);
  const components = [{ type: 'status', items }];
  if (summary.storagePercent !== null) {
    components.push({
      type: 'gauge',
      label: { en: 'Mail storage', fr: 'Stockage mails', de: 'Mailspeicher', es: 'Almacenamiento' },
      value: Math.min(100, Math.max(0, summary.storagePercent)),
      min: 0,
      max: 100,
      unit: '%',
      color:
        summary.storagePercent >= config.storage_threshold
          ? WIDGET_COLORS.DANGER
          : WIDGET_COLORS.PRIMARY,
    });
  }
  // Live tiles: they follow the states of the server device, nothing to
  // refresh.
  components.push(
    {
      type: 'value',
      label: { en: 'Quarantine', fr: 'Quarantaine', de: 'Quarantäne', es: 'Cuarentena' },
      icon: 'shield',
      device_feature: ids.feature(SERVER_FEATURES.QUARANTINE),
    },
    {
      type: 'value',
      label: { en: 'Banned IPs', fr: 'IP bannies', de: 'Gesperrte IPs', es: 'IP bloqueadas' },
      icon: 'slash',
      device_feature: ids.feature(SERVER_FEATURES.BANNED_IPS),
    },
    refreshButton,
  );
  if (config.allow_changes) {
    components.push({
      type: 'button',
      label: {
        en: 'Flush queue',
        fr: 'Vider la file',
        de: 'Warteschlange senden',
        es: 'Vaciar la cola',
      },
      icon: 'send',
      style: 'secondary',
      // `confirm`: the frontend asks before sending a change.
      action: { key: WIDGET_ACTIONS.FLUSH_QUEUE, confirm: true },
    });
  }
  const link = monitor.client.baseUrl;
  if (link?.startsWith('https://')) {
    components.push({
      type: 'button',
      label: {
        en: 'Open mailcow',
        fr: 'Ouvrir mailcow',
        de: 'mailcow öffnen',
        es: 'Abrir mailcow',
      },
      icon: 'external-link',
      style: 'secondary',
      link: { url: link },
    });
  }
  return { ttl_seconds: ttlOf(config), components };
}

function quarantineContent(monitor, settings) {
  const { snapshot, config } = monitor;
  const quarantine = snapshot.quarantine;
  if (!quarantine) {
    return unavailableContent(monitor);
  }
  const count = Math.min(8, Math.max(1, Number(settings?.items) || 5));
  const items = quarantine.items.slice(0, count).map((item) => ({
    title: truncate(item.subject || '(no subject)', 60),
    subtitle: truncate(`${item.sender} → ${item.recipient}`, 60),
    ...(item.createdAt ? { date: item.createdAt } : {}),
    badge: item.virus
      ? {
          text: { en: 'Virus', fr: 'Virus', de: 'Virus', es: 'Virus' },
          color: WIDGET_COLORS.DANGER,
        }
      : { text: truncate(`${item.score}`, 16), color: WIDGET_COLORS.WARNING },
    description: truncate(
      [
        `From: ${item.sender}`,
        `To: ${item.recipient}`,
        `Subject: ${item.subject}`,
        `Score: ${item.score}`,
        item.qid ? `Queue id: ${item.qid}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      2000,
    ),
  }));
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: {
        en: `${quarantine.total} mail(s) in quarantine`,
        fr: `${quarantine.total} mail(s) en quarantaine`,
        de: `${quarantine.total} Mail(s) in Quarantäne`,
        es: `${quarantine.total} correo(s) en cuarentena`,
      },
    },
  ];
  if (items.length > 0) {
    components.push({ type: 'card-list', display: 'list', items });
  }
  components.push(refreshButton);
  return { ttl_seconds: ttlOf(config), components };
}

function mailboxesContent(monitor, settings) {
  const { snapshot, config } = monitor;
  if (!snapshot.mailboxes) {
    return unavailableContent(monitor);
  }
  const count = Math.min(10, Math.max(1, Number(settings?.items) || 5));
  const domain = String(settings?.domain ?? '')
    .trim()
    .toLowerCase();
  const mailboxes = snapshot.mailboxes
    .filter((mailbox) => !domain || mailbox.domain === domain)
    .filter((mailbox) => mailbox.quotaGb > 0)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, count);
  if (mailboxes.length === 0) {
    return {
      ttl_seconds: ttlOf(config),
      components: [
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'No mailbox with a quota to show.',
            fr: 'Aucune boîte mail avec un quota à afficher.',
            de: 'Kein Postfach mit Kontingent anzuzeigen.',
            es: 'Ningún buzón con cuota que mostrar.',
          },
        },
        refreshButton,
      ],
    };
  }
  const items = mailboxes.map((mailbox) => ({
    label: truncate(mailbox.username, 40),
    icon: mailbox.active ? 'inbox' : 'lock',
    value: `${mailbox.percent} %`,
    color:
      mailbox.percent >= config.quota_threshold
        ? WIDGET_COLORS.DANGER
        : mailbox.percent >= config.quota_threshold * 0.8
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.SUCCESS,
  }));
  return {
    ttl_seconds: ttlOf(config),
    components: [{ type: 'status', items }, refreshButton],
  };
}

const CONTENTS = {
  [WIDGET_KEYS.STATUS]: statusContent,
  [WIDGET_KEYS.QUARANTINE]: quarantineContent,
  [WIDGET_KEYS.MAILBOXES]: mailboxesContent,
};

/**
 * The content of a widget, from the last snapshot.
 *
 * @param {import('../mailcow/monitor.js').MailcowMonitor} monitor
 * @param {string} key the widget key
 * @param {{ settings?: object }} request what Gladys sent with widget.get
 */
export function widgetContent(monitor, key, { settings } = {}) {
  logger.debug(`onWidgetGet <- ${key}`);
  if (!monitor.snapshot || !monitor.reachable) {
    return unavailableContent(monitor);
  }
  return CONTENTS[key](monitor, settings ?? {});
}

/**
 * A tapped widget button. Resolves the toast (≤ 200 characters per
 * language); throwing shows the error instead.
 */
export async function widgetAction(monitor, actionKey) {
  logger.info(`onWidgetAction <- ${actionKey}`);
  if (actionKey === WIDGET_ACTIONS.REFRESH) {
    const result = await monitor.refresh();
    if (!result.ok) {
      const message = describeError(result.error);
      return Object.fromEntries(
        Object.entries(message).map(([language, text]) => [language, truncate(text, 200)]),
      );
    }
    return {
      en: 'Server read again.',
      fr: 'Serveur relu.',
      de: 'Server neu gelesen.',
      es: 'Servidor leído de nuevo.',
    };
  }
  if (actionKey === WIDGET_ACTIONS.FLUSH_QUEUE) {
    await monitor.flushQueue();
    // The queue is read again so the tiles follow what Postfix did.
    await monitor.refresh();
    return {
      en: 'Queue flushed: Postfix is delivering the waiting mails.',
      fr: 'File vidée : Postfix livre les mails en attente.',
      de: 'Queue gesendet: Postfix stellt die wartenden Mails zu.',
      es: 'Cola vaciada: Postfix entrega los correos en espera.',
    };
  }
  throw new Error(`Unknown widget action: ${actionKey}`);
}
