// -----------------------------------------------------------------------------
// Entry point of the mailcow integration.
//
// Role of this file: wire the SDK to the refresh loop (src/mailcow/monitor.js),
// the devices (src/devices/) and the Gladys 5.1 capabilities (src/capabilities/).
// It holds NO mailcow logic:
//   1. it instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. it registers the event handlers BEFORE connect();
//   3. it connects, reads the configuration and starts the refresh loop.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { applyLogLevel } from './src/logging.js';
import { MailcowClient } from './src/mailcow/client.js';
import { MailcowMonitor } from './src/mailcow/monitor.js';
import { describeError, describeSnapshot } from './src/mailcow/messages.js';
import { buildDiscoveredDevices } from './src/devices/index.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { WIDGET_KEYS, widgetAction, widgetContent, truncate } from './src/capabilities/widgets.js';

// A promise rejected with nobody listening would terminate Node: log it and
// keep watching the server. Each path already reports its own failures.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

const gladys = new GladysIntegration();
const client = new MailcowClient();
const monitor = new MailcowMonitor({ gladys, client, widgets: Object.values(WIDGET_KEYS) });

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> reading the server and publishing its devices');
  await monitor.refresh();
  await monitor.publishDevices({ force: true });
});

// --- Command: the user flips the "active" switch of a domain or mailbox ------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  try {
    await monitor.setActive(device.external_id, feature.external_id, value);
  } catch (err) {
    // Throw: the SDK sends a success:false acknowledgement to Gladys, with
    // what the user can do about it.
    throw new Error(describeError(err).en, { cause: err });
  }
});

// --- A device just created: Gladys dropped its states until now --------------
gladys.onDeviceCreated(() => monitor.republishStates().catch(() => {}));
gladys.onDeviceUpdated(() => monitor.republishStates().catch(() => {}));

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('test_connection', async () => {
  logger.info('Action test_connection');
  const result = await monitor.refresh();
  return result.ok
    ? describeSnapshot(result.snapshot, client.transportStatus())
    : describeError(result.error);
});

gladys.onAction('flush_queue', async () => {
  logger.info('Action flush_queue');
  try {
    const waiting = await monitor.flushQueue();
    await monitor.refresh();
    const count = waiting ?? '?';
    return {
      en: `Queue flushed (${count} mail(s) were waiting): Postfix is delivering them.`,
      fr: `File vidée (${count} mail(s) en attente) : Postfix les livre.`,
      de: `Warteschlange gesendet (${count} Mail(s) warteten): Postfix stellt sie zu.`,
      es: `Cola vaciada (${count} correo(s) en espera): Postfix los entrega.`,
    };
  } catch (err) {
    return describeError(err);
  }
});

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// Each key of SCENE_ACTIONS is declared in the manifest `scene_actions` field.
// The scene TRIGGERS need no handler: the refresh loop fires them.
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(monitor, fields ?? {}));
}

// --- Dashboard widgets (Gladys 5.1+) -----------------------------------------
for (const widgetKey of Object.values(WIDGET_KEYS)) {
  gladys.onWidgetGet(widgetKey, async (request) => widgetContent(monitor, widgetKey, request));
  gladys.onWidgetAction(widgetKey, async (actionKey) => {
    try {
      return await widgetAction(monitor, actionKey);
    } catch (err) {
      // Shown as the error of the button: what to do about it.
      const message = describeError(err);
      throw new Error(truncate(message.en, 200), { cause: err });
    }
  });
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await initialize(newConfig);
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle under the `gladys-sdk` name: these
// handlers only run the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    await initialize(await gladys.getConfig());
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  monitor.stop();
});

/**
 * Apply a raw configuration and (re)start the refresh loop, which publishes
 * the devices, their states, the badges and the connection status.
 */
async function initialize(rawConfig) {
  const config = normalizeConfig(rawConfig);
  applyLogLevel(config);
  monitor.configure(config);
  // The server device first, so it exists even before the first read ends.
  await gladys
    .publishDiscoveredDevices(buildDiscoveredDevices(gladys, null, config))
    .catch((err) => logger.warn(`Could not publish the devices: ${err.message}`));
  logger.info(
    `Watching mailcow every ${config.poll_frequency} s (LAN: ${config.local_url || '-'}, public: ${
      config.public_url || '-'
    })`,
  );
  monitor.start();
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  monitor.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the mailcow integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
