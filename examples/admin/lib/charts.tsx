/**
 * snapfeed admin — Inline SVG chart helpers
 *
 * Three primitives, no external deps. Each renders a single <svg> and is safe
 * to use inside server components. Numbers are rounded to integers in the
 * output so SSR + client agree byte-for-byte.
 */

import type { CSSProperties, ReactElement } from 'react'

// ─── BarChart ─────────────────────────────────────────────────────────────────

export interface BarDatum {
  label: string
  value: number
}

export function BarChart({
  data,
  width = 480,
  height = 180,
  color = '#D4714B',
  emptyText = 'No data',
}: {
  data: BarDatum[]
  width?: number
  height?: number
  color?: string
  emptyText?: string
}): ReactElement {
  const max = Math.max(1, ...data.map(d => d.value))
  const padX = 12
  const padTop = 8
  const padBottom = 28
  const usableW = width - padX * 2
  const usableH = height - padTop - padBottom
  const barW = data.length > 0 ? usableW / data.length : 0
  const innerGap = Math.min(8, barW * 0.2)

  if (data.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={emptyText}
        style={emptyStyle}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fontSize={12}
          fill="#9CA3AF"
        >
          {emptyText}
        </text>
      </svg>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={`Bar chart with ${data.length} bars`}
      style={baseStyle}
    >
      {data.map((d, i) => {
        const h = Math.round((d.value / max) * usableH)
        const x = Math.round(padX + i * barW + innerGap / 2)
        const y = Math.round(padTop + (usableH - h))
        const w = Math.max(2, Math.round(barW - innerGap))
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={3}
              fill={color}
              opacity={0.92}
            />
            <text
              x={x + w / 2}
              y={padTop + usableH + 14}
              textAnchor="middle"
              fontSize={11}
              fill="#6B7280"
            >
              {truncateLabel(d.label, 10)}
            </text>
            <text
              x={x + w / 2}
              y={y - 4}
              textAnchor="middle"
              fontSize={11}
              fill="#374151"
              fontWeight={600}
            >
              {d.value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── DonutChart ───────────────────────────────────────────────────────────────

export interface DonutDatum {
  label: string
  value: number
  color: string
}

export function DonutChart({
  data,
  size = 160,
  thickness = 22,
  centerLabel,
}: {
  data: DonutDatum[]
  size?: number
  thickness?: number
  centerLabel?: string
}): ReactElement {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r

  if (total === 0) {
    return (
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label="Empty donut chart"
        style={baseStyle}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={thickness}
        />
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontSize={12}
          fill="#9CA3AF"
        >
          No data
        </text>
      </svg>
    )
  }

  // Build arcs by stacking stroke-dasharray with growing offsets.
  let acc = 0
  const arcs = data.map(d => {
    const frac = d.value / total
    const arcLen = circumference * frac
    const dashArray = `${arcLen} ${circumference - arcLen}`
    const dashOffset = -acc
    acc += arcLen
    return { d, dashArray, dashOffset }
  })

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Donut chart, total ${total}`}
      style={baseStyle}
    >
      {/* Background ring so zero-value slices still feel like a donut. */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#F3F4F6"
        strokeWidth={thickness}
      />
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {arcs.map((a, i) => (
          <circle
            key={`${a.d.label}-${i}`}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={a.d.color}
            strokeWidth={thickness}
            strokeDasharray={a.dashArray}
            strokeDashoffset={a.dashOffset}
          />
        ))}
      </g>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={20}
        fontWeight={700}
        fill="#111"
      >
        {total}
      </text>
      {centerLabel ? (
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          fontSize={11}
          fill="#6B7280"
        >
          {centerLabel}
        </text>
      ) : null}
    </svg>
  )
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  width = 160,
  height = 40,
  color = '#D4714B',
  emptyText = 'No data',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
  emptyText?: string
}): ReactElement {
  if (values.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={emptyText}
        style={emptyStyle}
      >
        <text
          x={width / 2}
          y={height / 2 + 4}
          textAnchor="middle"
          fontSize={11}
          fill="#9CA3AF"
        >
          {emptyText}
        </text>
      </svg>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = values.length > 1 ? width / (values.length - 1) : 0
  const points = values.map((v, i) => {
    const x = Math.round(i * stepX)
    const y = Math.round(height - ((v - min) / range) * (height - 4) - 2)
    return `${x},${y}`
  })

  const path = `M${points.join(' L')}`
  const lastIdx = points.length - 1
  const [lastX, lastY] = points[lastIdx].split(',').map(Number)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`Sparkline of ${values.length} values`}
      style={baseStyle}
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  )
}

// ─── Internals ────────────────────────────────────────────────────────────────

const baseStyle: CSSProperties = {
  display: 'block',
  overflow: 'visible',
}
const emptyStyle: CSSProperties = {
  display: 'block',
}

function truncateLabel(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
