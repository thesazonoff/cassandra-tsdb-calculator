/* Вкладка «Конфигурация»: cassandra.yaml, CQL, драйвер C#, rackdc, JVM, ОС, эксплуатация. */
import * as E from '../../../core/sizing.js';
import { configs } from '../../../core/sizing-config.js';
import { esc } from '../../../shared/format.js';
import { VN, codeBlock } from './common.js';

export function paneCfg(ctx) {
  const { R, VAR, code } = ctx;
  const v = R.variants[VAR], files = configs(R, v);
  return `<p class="hint">Вариант «${esc(VN[VAR])}», нода ${v.chosen.p.c} ядер / ${v.chosen.p.ram} ГБ. Остальные параметры cassandra.yaml берутся из <code>cassandra_latest.yaml</code> релиза ${E.CASSANDRA_VERSION}.</p>` +
    files.filter(f => f.main).map(f => codeBlock(code, f)).join('') +
    `<details class="more"><summary>Остальные файлы: rackdc, JVM, ОС, эксплуатация</summary><div class="more-body">${files.filter(f => !f.main).map(f => codeBlock(code, f)).join('')}</div></details>`;
}
