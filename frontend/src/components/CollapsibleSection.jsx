import { useState } from 'react'

export default function CollapsibleSection({
  id,
  title,
  subtitle = null,
  count = null,
  defaultExpanded = true,
  actions = null,
  children,
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const toggle = () => {
    setIsExpanded(previous => !previous)
  }

  const contentId = `${id}-content`
  const toggleLabel = isExpanded ? `Collapse ${title}` : `Expand ${title}`

  return (
    <section className="collapsible-section">
      <div className="collapsible-section__header">
        <div className="collapsible-section__header-content">
          <button
            type="button"
            className="collapsible-section__toggle"
            onClick={toggle}
            aria-expanded={isExpanded}
            aria-controls={contentId}
            aria-label={toggleLabel}
          >
            <svg
              className={`collapsible-section__chevron ${isExpanded ? 'collapsible-section__chevron--expanded' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M4 6L8 10L12 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div className="collapsible-section__title-group">
            <h2 className="collapsible-section__title">
              {title}
              {count !== null && (
                <span className="collapsible-section__count"> · {count}</span>
              )}
            </h2>
            {subtitle && (
              <p className="collapsible-section__subtitle">{subtitle}</p>
            )}
          </div>
        </div>

        {actions && (
          <div className="collapsible-section__actions">
            {actions}
          </div>
        )}
      </div>

      {isExpanded && (
        <div id={contentId} className="collapsible-section__content">
          {children}
        </div>
      )}
    </section>
  )
}
