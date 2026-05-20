import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

export type PickerOption = {
  value: string
  label: string
  selectedLabel?: string
  description?: string
  disabled?: boolean
  keywords?: string[]
}

export type TreePickerOption = PickerOption & {
  depth: number
  ancestorValues?: string[]
}

function normalizeSearchText(v: unknown) {
  return String(v || '').trim().toLowerCase()
}

function filterOptions<T extends PickerOption>(options: T[], query: string) {
  const q = normalizeSearchText(query)
  if (!q) return options
  return options.filter((o) =>
    [o.label, o.description, ...(o.keywords || [])].some((x) => normalizeSearchText(x).includes(q))
  )
}

function useDropdownClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, onClose])
  return ref
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  searchPlaceholder = '搜索…',
  disabled = false,
  pageSize: _pageSize,
  invalidValueLabel,
  filterer = filterOptions
}: {
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  pageSize?: number
  invalidValueLabel?: string
  filterer?: (options: PickerOption[], query: string) => PickerOption[]
}) {
  void _pageSize
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useDropdownClose(open, () => setOpen(false))
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)
  const filtered = useMemo(() => filterer(options, query), [filterer, options, query])

  useLayoutEffect(() => {
    if (!open || query || !value) return
    const list = listRef.current
    const target = list?.querySelector<HTMLElement>(`[data-picker-value="${CSS.escape(value)}"]`)
    if (!list || !target) return
    list.scrollTop = Math.max(0, target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2)
  }, [open, query, value, filtered])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
      >
        <span className={`min-w-0 flex-1 truncate ${selected || value ? '' : 'text-slate-400'}`}>
          {selected?.selectedLabel || selected?.label || (value ? invalidValueLabel || value : placeholder)}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
            {filtered.length ? (
              filtered.map((o) => (
                <button
                  key={o.value}
                  data-picker-value={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                    setQuery('')
                  }}
                  className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <span>
                    <span className="block text-slate-800">{o.label}</span>
                    {o.description ? <span className="mt-0.5 block text-xs text-slate-400">{o.description}</span> : null}
                  </span>
                  {o.value === value ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" /> : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-sm text-slate-400">无匹配结果</div>
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            共 {filtered.length} 项
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function TreeSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  searchPlaceholder = '搜索部门…',
  disabled = false,
  pageSize = 10,
  invalidValueLabel
}: {
  value: string
  options: TreePickerOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  pageSize?: number
  invalidValueLabel?: string
}) {
  const treeFilterer = useMemo(
    () => (allOptions: PickerOption[], query: string) => {
      const q = normalizeSearchText(query)
      if (!q) return allOptions
      const treeOptions = allOptions as TreePickerOption[]
      const matched = treeOptions.filter((o) =>
        [o.label, o.description, ...(o.keywords || [])].some((x) => normalizeSearchText(x).includes(q))
      )
      const visible = new Set<string>()
      for (const o of matched) {
        visible.add(o.value)
        for (const ancestor of o.ancestorValues || []) visible.add(ancestor)
      }
      return treeOptions.filter((o) => visible.has(o.value))
    },
    []
  )
  return (
    <SearchableSelect
      value={value}
      options={options.map((o) => ({
        ...o,
        label: `${'　'.repeat(Math.max(0, o.depth))}${o.depth > 0 ? '└ ' : ''}${o.label}`,
        selectedLabel: o.selectedLabel || [...(o.ancestorValues || []), o.label].join(' / ')
      }))}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      disabled={disabled}
      pageSize={pageSize}
      invalidValueLabel={invalidValueLabel}
      filterer={treeFilterer}
    />
  )
}

export function MultiSelectPanel({
  values,
  options,
  onChange,
  searchPlaceholder = '搜索…',
  pageSize: _pageSize,
  emptyText = '暂无可选项'
}: {
  values: string[]
  options: PickerOption[]
  onChange: (values: string[]) => void
  searchPlaceholder?: string
  pageSize?: number
  emptyText?: string
}) {
  void _pageSize
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterOptions(options, query), [options, query])

  const toggle = (value: string) => {
    const next = values.includes(value) ? values.filter((x) => x !== value) : [...values, value]
    onChange(Array.from(new Set(next)))
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div className="grid min-h-[216px] max-h-[216px] content-start gap-1 overflow-y-auto p-2 sm:grid-cols-2">
        {filtered.length ? (
          filtered.map((o) => {
            const checked = values.includes(o.value)
            return (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm transition ${
                  checked ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={o.disabled}
                  onChange={() => toggle(o.value)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <span>
                  <span className="block">{o.label}</span>
                  {o.description ? <span className="mt-0.5 block text-xs text-slate-400">{o.description}</span> : null}
                </span>
              </label>
            )
          })
        ) : (
          <div className="col-span-full px-3 py-8 text-center text-sm text-slate-400">{emptyText}</div>
        )}
      </div>
      <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        共 {filtered.length} 项
      </div>
    </div>
  )
}
