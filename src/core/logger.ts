// ---------------------------------------------------------------------------
// Structured logger (pino) — logs to stderr to avoid MCP stdio conflicts
// ---------------------------------------------------------------------------

import pino from "pino";

export const logger = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 2 } } // stderr
      : undefined,
  level: process.env.LOG_LEVEL ?? "info",
});
