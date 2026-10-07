import { na } from '../utils/display'
import { formatCurrency, formatNumber } from '../utils/format'

function spendShare(part, total) {
  if (part == null || !total || total <= 0) return 0
  return Math.min(100, Math.max(0, (part / total) * 100))
}

function BrandCard({ title, data, totalSpend, variant }) {
  const share = spendShare(data.spend, totalSpend)

  return (
    <article className={`brand-card brand-card--${variant}`}>
      <div className="brand-card__header">
        <h3 className="brand-card__title">{title}</h3>
        <span className="brand-card__share">{formatNumber(share, 0)}% of spend</span>
      </div>

      <dl className="brand-card__stats">
        <div>
          <dt>Spend</dt>
          <dd>{na(data.spend, formatCurrency)}</dd>
        </div>
        <div>
          <dt>Installs</dt>
          <dd>{na(data.installs, (v) => formatNumber(v, 0))}</dd>
        </div>
        <div>
          <dt>CPA</dt>
          <dd>{na(data.cpa, formatCurrency)}</dd>
        </div>
      </dl>

      <div className="brand-card__progress" aria-hidden="true">
        <div className="brand-card__progress-track">
          <div className="brand-card__progress-fill" style={{ width: `${share}%` }} />
        </div>
      </div>
    </article>
  )
}

export default function BrandCards({ brandSplit }) {
  const totalSpend = (brandSplit.brand.spend ?? 0) + (brandSplit.nonBrand.spend ?? 0)

  return (
    <section className="brand-row" aria-label="Brand versus non-brand">
      <BrandCard
        title="Brand"
        data={brandSplit.brand}
        totalSpend={totalSpend}
        variant="brand"
      />
      <BrandCard
        title="Non Brand"
        data={brandSplit.nonBrand}
        totalSpend={totalSpend}
        variant="non-brand"
      />
    </section>
  )
}
