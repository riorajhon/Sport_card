import { useState, useRef, useEffect } from 'react'
import './App.css'

function formatPriceDisplay(str) {
  if (!str || typeof str !== 'string') return str
  const s = str.trim()
  if (s.endsWith(' USD')) return `$${s.slice(0, -4).trim()}`
  if (s.endsWith(' EUR')) return `€${s.slice(0, -4).trim()}`
  return str
}

function formatUpdatedAt(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

function Toast({ notification, onDismiss }) {
  const { action, item } = notification
  return (
    <div className={`toast toast-${action}`} role="alert">
      {item.photo_url && (
        <img src={item.photo_url} alt="" className="toast-img" />
      )}
      <div className="toast-body">
        <span className="toast-action">{action === 'added' ? 'Added' : 'Updated'}</span>
        <span className="toast-title">{item.title || 'Card'}</span>
      </div>
      <button type="button" className="toast-dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen-inner">
        <h2 className="loading-title">Sport cards</h2>
        <div className="loading-bar-wrap">
          <div className="loading-bar" />
        </div>
        <p className="loading-text">Loading…</p>
      </div>
    </div>
  )
}

function EbayCell({ item }) {
  const data = item.ebayData || null
  if (!data || (data.minPrice == null && data.maxPrice == null))
    return <span className="ebay-status">—</span>
  const minStr = formatPriceDisplay(data.minPrice) || data.minPrice
  const maxStr = formatPriceDisplay(data.maxPrice) || data.maxPrice
  return (
    <div className="ebay-result">
      <span className="ebay-price">From {minStr}</span>
      {data.maxPrice != null && data.maxPrice !== data.minPrice && (
        <span className="ebay-price ebay-max">Up to {maxStr}</span>
      )}
      <a
        href={item.ebay_link || `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent((item.title || '').slice(0, 80))}`}
        target="_blank"
        rel="noopener noreferrer"
        className="table-link ebay-link"
      >
        View
      </a>
    </div>
  )
}

export default function App() {
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tableFilter, setTableFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sortKey, setSortKey] = useState('updatedAt')
  const [sortDir, setSortDir] = useState('desc')
  const [toasts, setToasts] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [vintedDomain, setVintedDomain] = useState(null)
  const [vintedCount, setVintedCount] = useState(0)
  const [catawikiCount, setCatawikiCount] = useState(0)
  const [topLiked, setTopLiked] = useState([])
  const [ebayTotalCount, setEbayTotalCount] = useState(0)
  const refetchTimeoutRef = useRef(null)

  const loadItems = (nextPage) => {
    const targetPage = nextPage || page || 1
    setLoading(true)
    const params = new URLSearchParams({
      page: String(targetPage),
      limit: '30',
      source: sourceFilter,
      sort: sortKey,
      dir: sortDir,
    })
    fetch(`/api/items?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || [])
        setPage(data.page || targetPage)
        setTotalPages(data.totalPages || 1)
        setLastUpdated(data.lastScrapeEndedAt || null)
        setVintedDomain(data.vintedDomain || null)
        setVintedCount(data.vintedCount || 0)
        setCatawikiCount(data.catawikiCount || 0)
        setTopLiked(data.topLiked || [])
        setEbayTotalCount(data.ebayTotalCount || 0)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadItems()
  }, [])

  // Refetch when source or sort changes (reset to first page)
  useEffect(() => {
    loadItems(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, sortKey, sortDir])

  useEffect(() => {
    const es = new EventSource('/api/notifications')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'notification' && data.item) {
          const id = Date.now()
          setToasts((prev) => [...prev.slice(-4), { id, ...data }])
          setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
          // Debounce refetch: one refetch 1.5s after last notification to avoid infinite/burst refetches
          if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current)
          refetchTimeoutRef.current = setTimeout(() => {
            refetchTimeoutRef.current = null
            loadItems()
          }, 1500)
        }
      } catch (_) {}
    }
    es.onerror = () => {}
    return () => {
      es.close()
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current)
    }
  }, [])

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  const filtered = items.filter((i) => {
    if (!tableFilter.trim()) return true
    const q = tableFilter.toLowerCase()
    const title = (i.title || '').toLowerCase()
    return title.includes(q)
  })

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'title') {
      const av = (a.title || '').toLowerCase()
      const bv = (b.title || '').toLowerCase()
      if (av === bv) return 0
      return av > bv ? dir : -dir
    }
    if (sortKey === 'likes') {
      const av = a.likes ?? 0
      const bv = b.likes ?? 0
      return av === bv ? 0 : av > bv ? dir : -dir
    }
    if (sortKey === 'price') {
      const parsePrice = (p) => {
        if (!p) return 0
        const s = String(p).replace(/[^\d.,]/g, '').replace(',', '.')
        const v = parseFloat(s)
        return Number.isNaN(v) ? 0 : v
      }
      const av = parsePrice(a.price_incl_protection || a.price)
      const bv = parsePrice(b.price_incl_protection || b.price)
      return av === bv ? 0 : av > bv ? dir : -dir
    }
    // default: updatedAt
    const ad = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
    const bd = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
    return ad === bd ? 0 : ad > bd ? dir : -dir
  })

  const handleExportCsv = async () => {
    if (!items.length) return

    // Fetch all pages from the backend so export includes all rows,
    // not just the current page.
    const allItems = []
    for (let p = 1; p <= totalPages; p += 1) {
      const params = new URLSearchParams({
        page: String(p),
        limit: '30',
        source: sourceFilter,
        sort: sortKey,
        dir: sortDir,
      })
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`/api/items?${params.toString()}`)
        if (!res.ok) continue
        // eslint-disable-next-line no-await-in-loop
        const data = await res.json()
        if (Array.isArray(data.items)) {
          allItems.push(...data.items)
        }
      } catch {
        // ignore individual page errors and continue
      }
    }

    if (!allItems.length) return

    // Apply same title filter
    const filteredAll = tableFilter.trim()
      ? allItems.filter((i) => {
          const q = tableFilter.toLowerCase()
          const title = (i.title || '').toLowerCase()
          return title.includes(q)
        })
      : allItems

    // Apply same sorting logic
    const sortedAll = [...filteredAll].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'title') {
        const av = (a.title || '').toLowerCase()
        const bv = (b.title || '').toLowerCase()
        if (av === bv) return 0
        return av > bv ? dir : -dir
      }
      if (sortKey === 'likes') {
        const av = a.likes ?? 0
        const bv = b.likes ?? 0
        return av === bv ? 0 : av > bv ? dir : -dir
      }
      if (sortKey === 'price') {
        const parsePrice = (p) => {
          if (!p) return 0
          const s = String(p).replace(/[^\d.,]/g, '').replace(',', '.')
          const v = parseFloat(s)
          return Number.isNaN(v) ? 0 : v
        }
        const av = parsePrice(a.price_incl_protection || a.price)
        const bv = parsePrice(b.price_incl_protection || b.price)
        return av === bv ? 0 : av > bv ? dir : -dir
      }
      const ad = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bd = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return ad === bd ? 0 : ad > bd ? dir : -dir
    })

    const headers = [
      'title',
      'price',
      'price_incl_protection',
      'source',
      'likes',
      'ebay_from',
      'ebay_to',
      'ebay_count',
      'url',
      'photo_url',
      'brand',
      'updatedAt',
    ]
    const rows = sortedAll.map((i) => {
      const rawFrom = i.ebayData?.minPrice ?? ''
      const rawTo = i.ebayData?.maxPrice ?? ''
      const norm = (s) => {
        if (!s) return ''
        const str = String(s).replace(/\s+/g, ' ').trim()
        // normalise euro symbol to "EUR " for CSV/Excel safety
        return str.replace(/\u00a0?€/g, ' EUR')
      }
      return [
        i.title ?? '',
        i.price_incl_protection || i.price || '',
        i.price_incl_protection || '',
        i.source ?? '',
        i.likes ?? '',
        norm(rawFrom),
        norm(rawTo),
        i.ebayData?.total ?? '',
        i.url ?? '',
        i.photo_url ?? '',
        i.brand ?? '',
        i.updatedAt ?? '',
      ]
    })

    const escapeCell = (value) => {
      const s = String(value ?? '')
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sport-cards.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleChangeSort = (key) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setSortDir('desc')
      return key
    })
  }

  const goToPage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return
    loadItems(nextPage)
  }

  const totalBySource = vintedCount + catawikiCount
  const vintedDeg = totalBySource > 0 ? (vintedCount / totalBySource) * 360 : 0

  return (
    <div className="app">
      <header className="header">
        <h1>Sport cards</h1>
      </header>

      <section className="top-dashboard" aria-label="Overview">
        <div className="top-cards-row">
          {topLiked.map((card) => (
            <a
              key={card.id}
              className="top-card"
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="top-card-thumb-wrap">
                {card.photo_url ? (
                  <img src={card.photo_url} alt="" className="top-card-thumb" />
                ) : (
                  <span className="table-no-img">—</span>
                )}
              </div>
              <div className="top-card-body">
                <div className="top-card-title">{card.title || 'Untitled'}</div>
                <div className="top-card-meta">
                  <span className="top-card-likes">{card.likes ?? 0} likes</span>
                  <span className={`top-card-source top-card-source-${card.source || 'vinted'}`}>
                    {card.source === 'catawiki' ? 'Catawiki' : 'Vinted'}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
        <div className="top-circle">
          <div
            className="top-circle-inner"
            style={{
              '--vintedDeg': `${vintedDeg}deg`,
            }}
          >
            <div className="top-circle-center">
              <span className="top-circle-total">{totalBySource}</span>
              <span className="top-circle-total-label">total cards</span>
            </div>
          </div>
          <div className="top-circle-legend">
            <div className="top-circle-row">
              <span className="legend-dot legend-vinted" />
              <span className="top-circle-label">
                Vinted{vintedDomain ? ` (${vintedDomain.toUpperCase()})` : ''}
              </span>
              <span className="top-circle-value">{vintedCount}</span>
            </div>
            <div className="top-circle-row">
              <span className="legend-dot legend-catawiki" />
              <span className="top-circle-label">Catawiki</span>
              <span className="top-circle-value">{catawikiCount}</span>
            </div>
          </div>
        </div>
      </section>

      <main className="main">
        {error && <p className="status error">{error}</p>}
        {items.length === 0 && !error && <LoadingScreen />}
        {items.length > 0 && (
          <div className="table-wrap">
            <div className="table-toolbar">
              <input
                type="search"
                placeholder="Filter by title…"
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                className="table-filter"
              />
              <div className="table-source-filter">
                <label className="table-source-label">
                  Source:{' '}
                  <select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className="table-source-select"
                  >
                    <option value="all">All</option>
                    <option value="vinted">Vinted</option>
                    <option value="catawiki">Catawiki</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="btn-export"
                onClick={handleExportCsv}
                disabled={!sorted.length}
              >
                Export CSV
              </button>
              <div className="table-pagination table-pagination-top">
                <button
                  type="button"
                  className="btn-page"
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1 || loading}
                >
                  Prev
                </button>
                <span className="page-info">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn-page"
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages || loading}
                >
                  Next
                </button>
              </div>
            </div>
            <table className="cards-table">
              <thead>
                <tr>
                  <th className="col-number">#</th>
                  <th
                    className="col-image col-sortable"
                    onClick={() => handleChangeSort('likes')}
                  >
                    Image / Likes
                    {sortKey === 'likes' && (
                      <span className="sort-indicator">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                  <th
                    className="col-title col-sortable"
                    onClick={() => handleChangeSort('title')}
                  >
                    Title
                    {sortKey === 'title' && (
                      <span className="sort-indicator">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                  <th
                    className="col-price col-sortable"
                    onClick={() => handleChangeSort('price')}
                  >
                    Price
                    {sortKey === 'price' && (
                      <span className="sort-indicator">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                  <th className="col-ebay">eBay</th>
                  <th className="col-source">Source</th>
                  <th
                    className="col-updated col-sortable"
                    onClick={() => handleChangeSort('updatedAt')}
                  >
                    Updated
                    {sortKey === 'updatedAt' && (
                      <span className="sort-indicator">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item, index) => (
                  <tr key={item.id}>
                    <td className="col-number">{index + 1}</td>
                    <td className="col-image">
                      <div className="thumb-wrap">
                        {item.photo_url ? (
                          <img src={item.photo_url} alt="" className="table-thumb" />
                        ) : (
                          <span className="table-no-img">—</span>
                        )}
                        {item.likes != null && (
                          <span className="thumb-badge" title="Likes">
                            {item.likes}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="col-title">
                      <span className="table-title-text">{item.title || 'Untitled'}</span>
                    </td>
                    <td className="col-price">
                      <span className="table-price">
                        {formatPriceDisplay(item.price_incl_protection || item.price) || '—'}
                      </span>
                    </td>
                    <td className="col-ebay">
                      <EbayCell item={item} />
                    </td>
                    <td className="col-source">
                      {item.source === 'catawiki' ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="source-link source-catawiki"
                          title={item.url}
                        >
                          Catawiki
                        </a>
                      ) : (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="source-link source-vinted"
                          title={item.url}
                        >
                          Vinted{vintedDomain ? ` (${vintedDomain.toUpperCase()})` : ''}
                        </a>
                      )}
                    </td>
                    <td className="col-updated">
                      <span className="table-updated">{formatUpdatedAt(item.updatedAt)}</span>
                    </td>
                    <td className="col-actions">
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm('Delete this card from the database?')) return
                          fetch(`/api/items/${item.id}`, { method: 'DELETE' })
                            .then((r) => r.json())
                            .then((data) => {
                              if (data.error) throw new Error(data.error)
                              setItems((prev) => prev.filter((i) => i.id !== item.id))
                            })
                            .catch((err) => setError(err.message))
                        }}
                        className="btn-delete"
                        title="Delete from database"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="table-pagination">
              <button
                type="button"
                className="btn-page"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || loading}
              >
                Prev
              </button>
              <span className="page-info">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-page"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || loading}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} notification={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
    </div>
  )
}
