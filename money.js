function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'object' && v.toNumber) return v.toNumber();
  return Number(v) || 0;
}
function calcCharge(ratePer1000, qty) {
  return Number(((toNum(ratePer1000) / 1000) * qty).toFixed(6));
}
function formatMoney(v, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(toNum(v));
}
module.exports = { toNum, calcCharge, formatMoney };
