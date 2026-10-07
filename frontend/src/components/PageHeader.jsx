export default function PageHeader({ title, description, meta }) {
  return (
    <header className="page-header">
      <h1 className="page-header__title">{title}</h1>
      {description ? <p className="page-header__desc">{description}</p> : null}
      {meta ? <p className="page-header__meta">{meta}</p> : null}
    </header>
  )
}
