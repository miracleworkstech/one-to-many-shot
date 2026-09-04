export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
    const { startWorker } = await import("./lib/worker");
    startWorker();
  }
}
