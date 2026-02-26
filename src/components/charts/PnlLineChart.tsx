import { useEffect, useRef } from 'react'
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts'
import { useAppStore } from '@/stores/useAppStore'

interface PnlLineChartProps {
  data: { time: string; value: number }[]
  height?: number
  showArea?: boolean
}

export function PnlLineChart({ data, height = 250, showArea = true }: PnlLineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Line'> | null>(null)
  const { theme } = useAppStore()

  const isDark = theme === 'dark'

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: isDark ? '#6b7280' : '#9ca3af',
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: isDark ? '#1e2130' : '#e5e7eb' },
        horzLines: { color: isDark ? '#1e2130' : '#e5e7eb' },
      },
      width: chartContainerRef.current.clientWidth,
      height,
      rightPriceScale: {
        borderColor: isDark ? '#2e3140' : '#d1d5db',
      },
      timeScale: {
        borderColor: isDark ? '#2e3140' : '#d1d5db',
        timeVisible: true,
      },
      crosshair: {
        vertLine: { color: isDark ? '#4b5563' : '#9ca3af', width: 1, style: 3 },
        horzLine: { color: isDark ? '#4b5563' : '#9ca3af', width: 1, style: 3 },
      },
      handleScroll: { vertTouchDrag: false },
    })

    const hasPositiveValues = data.some((d) => d.value >= 0)
    const lineColor = hasPositiveValues ? '#22c55e' : '#ef4444'

    if (showArea) {
      const series = chart.addAreaSeries({
        lineColor,
        topColor: hasPositiveValues ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
        bottomColor: hasPositiveValues ? 'rgba(34, 197, 94, 0.02)' : 'rgba(239, 68, 68, 0.02)',
        lineWidth: 2,
      })
      series.setData(data as any)
      seriesRef.current = series
    } else {
      const series = chart.addLineSeries({
        color: lineColor,
        lineWidth: 2,
      })
      series.setData(data as any)
      seriesRef.current = series
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]) {
        chart.applyOptions({ width: entries[0].contentRect.width })
      }
    })
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
    }
  }, [data, height, showArea, isDark])

  return <div ref={chartContainerRef} />
}
