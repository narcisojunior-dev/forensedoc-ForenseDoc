function localizedNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!raw || !/[0-9]/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

export function moneyToCents(value) {
  const number = localizedNumber(value);
  return number === null ? null : Math.round(number * 100);
}

export function percentToNumber(value) {
  return localizedNumber(value);
}
