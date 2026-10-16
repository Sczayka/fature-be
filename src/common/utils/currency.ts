/** Arredondamento monetário em 2 casas, idêntico ao do fature-fe (`roundCurrency`). */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
