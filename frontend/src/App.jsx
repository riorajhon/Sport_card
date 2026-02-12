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
      <span className="ebay-meta">{data.total != null ? `${data.total} on eBay` : ''}</span>
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tableFilter, setTableFilter] = useState('')
  const [toasts, setToasts] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [vintedDomain, setVintedDomain] = useState(null)
  const [scrapeProgress, setScrapeProgress] = useState({
    running: false,
    currentPage: 0,
    totalPages: 0,
    nextScrapeAt: null,
    periodMs: null,
  })
  const [tick, setTick] = useState(0)
  const refetchTimeoutRef = useRef(null)
  const scrapeProgressRef = useRef(null)
  const scrapePollIntervalRef = useRef(null)

  const loadItems = () => {
    setLoading(true)
    fetch('/api/items')
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || [])
        setLastUpdated(data.lastScrapeEndedAt || null)
        setVintedDomain(data.vintedDomain || null)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadItems()
  }, [])

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      if (cancelled) return
      fetch('/api/scrape/status')
        .then((r) => r.json())
        .catch(() => null)
        .then((data) => {
          if (cancelled || data == null) return
          const next = {
            running: !!data.running,
            currentPage: data.currentPage ?? 0,
            totalPages: data.totalPages ?? 0,
            nextScrapeAt: data.nextScrapeAt ?? null,
            periodMs: data.periodMs ?? null,
          }
          const prev = scrapeProgressRef.current
          if (
            prev == null ||
            prev.running !== next.running ||
            prev.currentPage !== next.currentPage ||
            prev.totalPages !== next.totalPages ||
            prev.nextScrapeAt !== next.nextScrapeAt ||
            prev.periodMs !== next.periodMs
          ) {
            scrapeProgressRef.current = next
            setScrapeProgress(next)
          }
        })
    }
    scrapePollIntervalRef.current = setInterval(poll, 3000)
    poll()
    return () => {
      cancelled = true
      if (scrapePollIntervalRef.current != null) {
        clearInterval(scrapePollIntervalRef.current)
        scrapePollIntervalRef.current = null
      }
    }
  }, [])

  // Tick every second when idle so countdown and progress bar update
  useEffect(() => {
    if (scrapeProgress.running) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [scrapeProgress.running])

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

  const filtered = tableFilter.trim()
    ? items.filter((i) => {
        const q = tableFilter.toLowerCase()
        const title = (i.title || '').toLowerCase()
        const condition = (i.condition || '').toLowerCase()
        const price = (i.price_incl_protection || i.price || '').toString().toLowerCase()
        const ebayStr = i.ebayData?.minPrice
          ? (formatPriceDisplay(i.ebayData.minPrice) || i.ebayData.minPrice).toString().toLowerCase()
          : ''
        return title.includes(q) || condition.includes(q) || price.includes(q) || ebayStr.includes(q)
      })
    : items

  return (
    <div className="app">
      <header className="header">
        <h1>Sport cards</h1>
        <div className="toolbar">
          {lastUpdated && (
            <span className="last-updated">
              Last updated: {formatUpdatedAt(lastUpdated)}
            </span>
          )}
        </div>
      </header>

      <section className="system-status" aria-label="System status">
        {scrapeProgress.running ? (
          <div className="system-status-scraping" role="status" aria-live="polite">
            <div className="system-status-row">
              <span className="system-status-label">Scraping</span>
              <span className="system-status-detail">
                Page {scrapeProgress.currentPage} / {scrapeProgress.totalPages || 100}
                {scrapeProgress.totalPages > 0 && (
                  <span className="system-status-pct">
                    {' '}({Math.round((100 * scrapeProgress.currentPage) / scrapeProgress.totalPages)}%)
                  </span>
                )}
              </span>
            </div>
            <div className="system-status-bar-wrap">
              <div
                className="system-status-bar-fill"
                style={{
                  width: scrapeProgress.totalPages > 0
                    ? `${Math.min(100, (100 * scrapeProgress.currentPage) / scrapeProgress.totalPages)}%`
                    : '0%',
                }}
              />
            </div>
          </div>
        ) : (
          <div className="system-status-idle system-status-wait" role="status">
            <div className="system-status-row">
              <span className="system-status-label">System</span>
              <span className="system-status-detail">
                {scrapeProgress.nextScrapeAt != null && scrapeProgress.periodMs != null ? (
                  (() => {
                    const now = Date.now()
                    const remainingMs = Math.max(0, scrapeProgress.nextScrapeAt - now)
                    const remainingMin = Math.ceil(remainingMs / 60000)
                    return (
                      <>
                        Next scrape in {remainingMin} min
                        <span className="system-status-pct"> · 30 min cycle</span>
                      </>
                    )
                  })()
                ) : (
                  'Idle · Auto scrape every 30 min (100 pages)'
                )}
              </span>
            </div>
            {scrapeProgress.nextScrapeAt != null && scrapeProgress.periodMs != null && (() => {
              const now = Date.now()
              const remainingMs = Math.max(0, scrapeProgress.nextScrapeAt - now)
              const pct = scrapeProgress.periodMs > 0
                ? Math.min(100, (100 * (scrapeProgress.periodMs - remainingMs)) / scrapeProgress.periodMs)
                : 0
              return (
                <div className="system-status-bar-wrap">
                  <div className="system-status-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              )
            })()}
          </div>
        )}
        {lastUpdated && (
          <div className="system-status-last-updated">
            Last updated: {formatUpdatedAt(lastUpdated)}
          </div>
        )}
      </section>

      <main className="main">
        {error && <p className="status error">{error}</p>}
        {items.length === 0 && !error && <LoadingScreen />}
        {items.length > 0 && (
          <div className="table-wrap">
            <div className="table-toolbar">
              <input
                type="search"
                placeholder="Filter table (title, condition, price, eBay…)"
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                className="table-filter"
              />
            </div>
            <table className="cards-table">
              <thead>
                <tr>
                  <th className="col-image">Image</th>
                  <th className="col-title">Title</th>
                  <th className="col-price">Price</th>
                  <th className="col-condition">Condition</th>
                  <th className="col-ebay">eBay</th>
                  <th className="col-source">Source</th>
                  <th className="col-updated">Updated</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
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
                    <td className="col-condition">{item.condition || '—'}</td>
                    <td className="col-ebay">
                      <EbayCell item={item} />
                    </td>
                    <td className="col-source">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-link source-vinted"
                        title={item.url}
                      >
                        Vinted{vintedDomain ? ` (${vintedDomain.toUpperCase()})` : ''}
                      </a>
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
