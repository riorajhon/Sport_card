import { useState, useRef, useEffect } from 'react'
import './App.css'

function formatPriceDisplay(str) {
  if (!str || typeof str !== 'string') return str
  const s = str.trim()
  if (s.endsWith(' USD')) return `$${s.slice(0, -4).trim()}`
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
  const refetchTimeoutRef = useRef(null)

  const loadItems = () => {
    setLoading(true)
    fetch('/api/items')
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || [])
        setLastUpdated(data.lastScrapeEndedAt || null)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadItems()
  }, [])

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

      <main className="main">
        {loading && items.length === 0 && <p className="status">Loading…</p>}
        {error && <p className="status error">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="status">
            No cards in database yet. Scrape runs automatically every hour (50 pages, min 10 likes).
          </p>
        )}
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
                      >
                        Vinted
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
