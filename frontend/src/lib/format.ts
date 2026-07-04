import type { Moneyish } from '../types';

export function formatMoney(value: Moneyish) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(number);
}

export function formatPrice(value: Moneyish) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(number);
}

export function formatNumber(value: Moneyish) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
