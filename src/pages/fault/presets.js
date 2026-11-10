/* Типовые схемы для быстрого старта страницы «Отказоустойчивость». */
export const PRESETS = [
  { t: 'Standalone, 1 нода', s: { dcs: [{ name: 'DC1', rf: 1, racks: [1] }], wcl: 'ONE', rcl: 'ONE' } },
  { t: '3 ноды, RF3', s: { dcs: [{ name: 'DC1', rf: 3, racks: [1, 1, 1] }] } },
  { t: '9 нод, 3 racks', s: { dcs: [{ name: 'DC1', rf: 3, racks: [3, 3, 3] }] } },
  { t: '15 нод, 5 racks, RF5', s: { dcs: [{ name: 'DC1', rf: 5, racks: [3, 3, 3, 3, 3] }] } },
  { t: '2 DC по 3 ноды', s: { dcs: [{ name: 'DC1', rf: 3, racks: [1, 1, 1] }, { name: 'DC2', rf: 3, racks: [1, 1, 1] }] } },
  { t: '3 DC по 3 ноды', s: { dcs: [{ name: 'DC1', rf: 3, racks: [1, 1, 1] }, { name: 'DC2', rf: 3, racks: [1, 1, 1] }, { name: 'DC3', rf: 3, racks: [1, 1, 1] }] } },
  { t: 'Racks разного размера', s: { dcs: [{ name: 'DC1', rf: 3, racks: [3, 3, 2] }] } }
];
