import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * 通用「可拖动调宽」表格列工具。
 *
 * 自适应规则：
 *   - 父容器宽度 ≥ 所有列默认宽度之和 → 表格铺满父容器，列按比例放大
 *   - 父容器宽度 < 所有列默认宽度之和（如手机端、窄侧栏）→ 表格保持内容友好的基础宽度，
 *     由外层 `overflow-x-auto` 提供横向滚动条
 *   - 拖动列宽时，所有列保留各自基础宽度（base width）；显示宽度 = base × scale
 *   - 拖动手感始终按屏幕像素响应，无论 scale 多少
 *
 * 用法：
 *
 *   const cols = useColumnWidths('my-table', [
 *     { id: 'name', defaultWidth: 130, minWidth: 80 },
 *     ...
 *   ])
 *
 *   <div className="overflow-x-auto">
 *     <table ref={cols.tableRef} className="table-fixed" style={cols.tableStyle}>
 *       <colgroup>{cols.colNodes}</colgroup>
 *       <thead>
 *         <tr>
 *           <ResizableTh col={cols.byId.name}>姓名</ResizableTh>
 *           ...
 */

export type ColumnSpec = {
  id: string
  defaultWidth: number
  minWidth?: number
  maxWidth?: number
}

export type ColumnInfo = {
  id: string
  /** 用户设定的基础列宽（即拖动时改变的值） */
  width: number
  /** 当前实际渲染的列宽（= width × scale） */
  displayWidth: number
  /** 当前拉伸倍率，>= 1 */
  scale: number
  defaultWidth: number
  minWidth: number
  maxWidth: number
  setWidth: (next: number) => void
  resetWidth: () => void
}

export type ColumnWidthsApi = {
  /** 必须挂到 `<table>` 元素上，用于测量实际宽度 */
  tableRef: React.RefObject<HTMLTableElement | null>
  /** 直接展开给 `<table>` 的 style：width: '100%' + minWidth: baseTotalWidth */
  tableStyle: React.CSSProperties
  /** 所有列基础宽度之和（用作 table 的 minWidth） */
  baseTotalWidth: number
  /** 当前实际渲染总宽度（≈ table 元素当前宽度） */
  totalWidth: number
  /** 当前拉伸倍率 */
  scale: number
  byId: Record<string, ColumnInfo>
  list: ColumnInfo[]
  /** 渲染到 `<colgroup>` 里的 `<col>` 节点（百分比宽度，自动按比例分配） */
  colNodes: React.ReactNode
  /** 清除所有自定义列宽，恢复默认 */
  resetAll: () => void
}

const COLUMN_WIDTH_STORAGE_VERSION = 'v3'

function storageKey(tableId: string) {
  return `ai-recruit:col-widths:${COLUMN_WIDTH_STORAGE_VERSION}:${tableId}`
}

function readStored(tableId: string): Record<string, number> {
  try {
    const raw = window.localStorage?.getItem(storageKey(tableId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeStored(tableId: string, value: Record<string, number>) {
  try {
    window.localStorage?.setItem(storageKey(tableId), JSON.stringify(value))
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function useColumnWidths(tableId: string, specs: ColumnSpec[]): ColumnWidthsApi {
  const specsRef = useRef(specs)
  specsRef.current = specs

  const tableRef = useRef<HTMLTableElement | null>(null)
  const [observedWidth, setObservedWidth] = useState(0)

  useEffect(() => {
    const el = tableRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      setObservedWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const stored = typeof window === 'undefined' ? {} : readStored(tableId)
    const out: Record<string, number> = {}
    for (const s of specs) {
      const v = stored[s.id]
      out[s.id] = typeof v === 'number' && v > 0 ? v : s.defaultWidth
    }
    return out
  })

  useEffect(() => {
    setWidths((prev) => {
      const stored = readStored(tableId)
      const out: Record<string, number> = { ...prev }
      let changed = false
      for (const s of specs) {
        if (out[s.id] == null) {
          const v = stored[s.id]
          out[s.id] = typeof v === 'number' && v > 0 ? v : s.defaultWidth
          changed = true
        }
      }
      return changed ? out : prev
    })
  }, [tableId, specs])

  const setWidth = useCallback(
    (id: string, next: number) => {
      setWidths((prev) => {
        const spec = specsRef.current.find((s) => s.id === id)
        if (!spec) return prev
        const min = spec.minWidth ?? 40
        const max = spec.maxWidth ?? 1200
        const clamped = Math.min(max, Math.max(min, Math.round(next)))
        if (prev[id] === clamped) return prev
        const updated = { ...prev, [id]: clamped }
        writeStored(tableId, updated)
        return updated
      })
    },
    [tableId]
  )

  const resetWidth = useCallback(
    (id: string) => {
      setWidths((prev) => {
        const spec = specsRef.current.find((s) => s.id === id)
        if (!spec) return prev
        if (prev[id] === spec.defaultWidth) return prev
        const updated = { ...prev, [id]: spec.defaultWidth }
        writeStored(tableId, updated)
        return updated
      })
    },
    [tableId]
  )

  const resetAll = useCallback(() => {
    const next: Record<string, number> = {}
    for (const s of specsRef.current) next[s.id] = s.defaultWidth
    setWidths(next)
    writeStored(tableId, {})
  }, [tableId])

  return useMemo<ColumnWidthsApi>(() => {
    const baseTotalWidth = specs.reduce((sum, s) => sum + (widths[s.id] ?? s.defaultWidth), 0)
    // 实际渲染倍率：表格当前显示宽度 / 列基础宽度之和
    //   - viewport ≥ baseTotal → scale > 1，列按比例放大铺满父容器
    //   - viewport < baseTotal → 表格自身 minWidth 兜底，外层横向滚动，避免表头和内容挤压重叠
    const scale =
      baseTotalWidth > 0 && observedWidth > 0 ? observedWidth / baseTotalWidth : 1
    const totalWidth = baseTotalWidth * scale

    const list: ColumnInfo[] = specs.map((s) => {
      const w = widths[s.id] ?? s.defaultWidth
      return {
        id: s.id,
        width: w,
        displayWidth: w * scale,
        scale,
        defaultWidth: s.defaultWidth,
        minWidth: s.minWidth ?? 40,
        maxWidth: s.maxWidth ?? 1200,
        setWidth: (n) => setWidth(s.id, n),
        resetWidth: () => resetWidth(s.id)
      }
    })
    const byId: Record<string, ColumnInfo> = {}
    for (const c of list) byId[c.id] = c

    // 用百分比让 `table-layout: fixed` + `width: 100%` 自动按列基础宽度比例分配空间。
    // 当父容器够宽时，每列按比例放大；窄屏时 table 的 minWidth 保住下限，外层横向滚动。
    const colNodes = (
      <>
        {list.map((c) => (
          <col
            key={c.id}
            style={{ width: baseTotalWidth > 0 ? `${(c.width / baseTotalWidth) * 100}%` : undefined }}
          />
        ))}
      </>
    )

    const tableStyle: React.CSSProperties = {
      width: '100%',
      minWidth: baseTotalWidth
    }

    return {
      tableRef,
      tableStyle,
      baseTotalWidth,
      totalWidth,
      scale,
      byId,
      list,
      colNodes,
      resetAll
    }
  }, [specs, widths, setWidth, resetWidth, resetAll, observedWidth])
}

type ResizableThProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  col: ColumnInfo | undefined
  /** 是否允许拖动（默认 true） */
  resizable?: boolean
}

export function ResizableTh({ col, resizable = true, className = '', style, children, ...rest }: ResizableThProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!col || !resizable) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const baseStart = col.width
      const scale = col.scale > 0 ? col.scale : 1
      const handleMove = (ev: PointerEvent) => {
        const screenDelta = ev.clientX - startX
        // 屏幕像素增量 → 基础宽度增量（拖动手感按屏幕像素响应）
        const baseDelta = screenDelta / scale
        col.setWidth(baseStart + baseDelta)
      }
      const handleUp = () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [col, resizable]
  )

  const handleDoubleClick = useCallback(() => {
    if (!col || !resizable) return
    col.resetWidth()
  }, [col, resizable])

  const mergedStyle: React.CSSProperties = {
    ...style,
    position: 'relative',
    paddingRight: style?.paddingRight ?? '2rem'
  }

  return (
    <th {...rest} className={className} style={mergedStyle}>
      <span className="block min-w-0">{children}</span>
      {col && resizable ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整列宽"
          title="拖动调整列宽（双击恢复默认）"
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
          onClick={(e) => e.stopPropagation()}
          className="group absolute top-0 -right-1 z-10 flex h-full w-6 cursor-col-resize touch-none select-none items-center justify-center"
        >
          <span className="block h-6 w-[3px] rounded bg-slate-200 transition-colors group-hover:bg-indigo-400 group-active:bg-indigo-500" />
        </span>
      ) : null}
    </th>
  )
}
