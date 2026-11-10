/** Версия из package.json, задаётся esbuild при сборке. */
declare const __APP_VERSION__: string | undefined;
interface Window { __app?: Record<string, unknown> }
