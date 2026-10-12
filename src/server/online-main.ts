// Entry point of the online server (bundled by scripts/build-online.mjs, run in the
// Binotech server's container).
import { startOnline } from './online';

// One room's bug must not take the others down.
process.on('uncaughtException', (e) => console.error(`uncaught ${e.stack ?? String(e)}`));
process.on('unhandledRejection', (e) => console.error(`unhandled ${String(e)}`));
process.on('SIGTERM', () => process.exit(0));

startOnline();
