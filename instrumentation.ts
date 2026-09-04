export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Next's standalone server swallows a thrown register() error (logs "Failed to
    // prepare server" and keeps the process alive, serving 500s forever) instead of
    // exiting, so we exit here ourselves to let the platform's restart/healthcheck work.
    // This covers the whole node startup: env validation, imports, and starting the worker.
    try {
      const { assertProductionEnv } = await import("./lib/env");
      assertProductionEnv();
      const { startWorker } = await import("./lib/worker");
      startWorker();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
