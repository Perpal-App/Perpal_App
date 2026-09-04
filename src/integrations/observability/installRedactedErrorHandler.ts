import { recordClientTelemetry } from '@/integrations/observability/clientTelemetry';

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ReactNativeErrorUtils = {
  readonly getGlobalHandler: () => ErrorHandler;
  readonly setGlobalHandler: (handler: ErrorHandler) => void;
};

let installed = false;

function installRedactedErrorHandler(): void {
  const errorUtils = (globalThis as typeof globalThis & {
    readonly ErrorUtils?: ReactNativeErrorUtils;
  }).ErrorUtils;

  if (installed || errorUtils === undefined) return;
  installed = true;

  const previousHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      recordClientTelemetry({
        durationMs: 0,
        errorCode: errorCode(error, isFatal === true),
        operation: 'app.javascript_error',
        outcome: 'error',
      });
    } finally {
      previousHandler(error, isFatal);
    }
  });
}

function errorCode(error: unknown, fatal: boolean): string {
  const name = error instanceof Error ? error.name : typeof error;
  const normalized = name.toLowerCase().replace(/[^a-z0-9_-]/gu, '').slice(0, 48);
  return `${fatal ? 'fatal' : 'handled'}_${normalized || 'unknown'}`;
}

installRedactedErrorHandler();
