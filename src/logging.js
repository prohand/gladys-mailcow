// -----------------------------------------------------------------------------
// Log level, switchable from the Configuration screen.
//
// The SDK logger reads LOG_LEVEL on every line, its own connection logs
// included: setting the variable is all it takes. The level the container was
// started with (LOG_LEVEL set by hand) stays the floor when the box is
// unticked.
// -----------------------------------------------------------------------------

const STARTUP_LEVEL = process.env.LOG_LEVEL;

/**
 * Apply the "Detailed logs" box of the configuration.
 *
 * @param {{ debug_logs: boolean }} config
 */
export function applyLogLevel(config) {
  if (config.debug_logs) {
    process.env.LOG_LEVEL = 'debug';
  } else if (STARTUP_LEVEL === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = STARTUP_LEVEL;
  }
}
