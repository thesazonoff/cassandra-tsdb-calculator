/* Печатная версия расчёта (кнопка «Отчёт PDF»). */
import * as E from '../../../core/sizing.js';
import { configs } from '../../../core/sizing-config.js';
import { APP_VERSION } from '../../../app/version.js';
import { esc } from '../../../shared/format.js';
import { VN, checksHtml, codeBlock } from './common.js';
import { paneSum } from './summary.js';
import { paneDisk } from './disk.js';

/** Отчёт для печати в PDF: итог, диски, проверки, основная конфигурация. */
export function printHtml(ctx) {
  const { R, VAR, code } = ctx;
  const v = R.variants[VAR];
  code.length = 0;
  return `<div class="pane"><h2 style="font-size:20px">Расчёт кластера Cassandra для MES · ${esc(VN[VAR])}</h2><p class="hint">Калькулятор TSDB Cassandra ${APP_VERSION} · Apache Cassandra ${E.CASSANDRA_VERSION} · ${new Date().toLocaleDateString('ru-RU')}</p>${paneSum(ctx)}</div>
    <div class="pane pb">${paneDisk(ctx)}</div>
    <div class="pane pb"><h3>Проверки</h3>${checksHtml(R)}</div>
    <div class="pane pb"><h3>Конфигурация</h3>${configs(R, v).filter(f => f.main).map(f => codeBlock(code, f)).join('')}</div>`;
}
