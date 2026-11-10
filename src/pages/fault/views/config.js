/* Вкладка «Конфигурация»: фрагменты CQL, cassandra.yaml, rackdc, драйвера и команд проверки. */
import { esc } from '../../../shared/format.js';

export function cfgHtml(cfgFiles) {
  return '<p class="lead">Фрагменты для нового кластера. Значения в угловых скобках заменить на свои. num_tokens и allocate_tokens_for_local_replication_factor задаются до первого запуска ноды: на работающей ноде их не меняют.</p><div class="files">' +
    cfgFiles.map((f, i) => '<div class="file"><div class="file-h"><b>' + esc(f.name) + '</b><span>' + esc(f.title) + '</span><span class="spacer"></span><button class="btn sm" type="button" data-copy="' + i + '">Копировать</button><button class="btn sm" type="button" data-dl="' + i + '">Скачать</button></div><pre>' + esc(f.content) + '</pre></div>').join('') + '</div>';
}