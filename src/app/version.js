/* Версия приложения: подставляется сборкой из package.json (scripts/build.mjs, define __APP_VERSION__). */
/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
