import { locale } from '../i18n'

function intlLocale() {
  return locale.value === 'vi' ? 'vi-VN' : 'en-US'
}

export function formatUsd(value) {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatNumber(value) {
  return new Intl.NumberFormat(intlLocale()).format(Number(value) || 0)
}

export function formatBytes(value) {
  const n = Number(value) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`
  return `${(n / 1024 ** 4).toFixed(2)} TB`
}

// bytes/second -> human (decimal MB/s style, matching what a "Mbps plan" implies)
export function formatRate(bytesPerSec) {
  const n = Number(bytesPerSec) || 0
  if (n === 0) return null
  if (n < 1000) return `${n} B/s`
  if (n < 1000 ** 2) return `${(n / 1000).toFixed(0)} KB/s`
  return `${(n / 1000 ** 2).toFixed(1)} MB/s`
}
