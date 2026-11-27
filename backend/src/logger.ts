export type LogSeverity = 'INFO' | 'WARN' | 'ERROR';

export type LogValue = string | number | boolean | null;

export type LogContext = Record<string, LogValue | undefined>;

const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|auth|cookie|credential|spreadsheet[_-]?id|api[_-]?key|email|phone|ssn|pii|payload|body)/i;

function sanitizeContext(context: LogContext): Record<string, LogValue> {
  const safe: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

/**
 * Emits a structured JSON log entry compatible with GAS Cloud Logging (STACKDRIVER).
 * Excludes sensitive keys and never serializes secrets, tokens, PII, or raw Spreadsheet IDs.
 */
export function logStructured(
  severity: LogSeverity,
  event: string,
  context: LogContext = {},
): void {
  const entry = {
    severity,
    timestamp: new Date().toISOString(),
    event,
    ...sanitizeContext(context),
  };

  const line = JSON.stringify(entry);
  if (severity === 'ERROR') {
    console.error(line);
  } else if (severity === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logInfo(event: string, context?: LogContext): void {
  logStructured('INFO', event, context);
}

export function logWarn(event: string, context?: LogContext): void {
  logStructured('WARN', event, context);
}

export function logError(event: string, context?: LogContext): void {
  logStructured('ERROR', event, context);
}

export function getErrorName(err: unknown): string {
  if (err instanceof Error && err.name) {
    return err.name;
  }
  return typeof err;
}
