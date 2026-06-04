import type { Moneyish } from '../types';

export function formatMoney(value: Moneyish) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function formatNumber(value: Moneyish) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
