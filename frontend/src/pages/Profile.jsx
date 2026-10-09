import { UserProfile } from '@clerk/react'

const profileAppearance = {
  variables: {
    colorPrimary: '#5b4fd6',
  },
}

export default function Profile() {
  return (
    <div className="content-shell">
      <section className="panel-card">
        <h1 className="panel-card__title">My Profile</h1>
        <p className="panel-card__subtitle">
          Update your name, email, photo, password, and sign-in methods.
        </p>
        <UserProfile
          routing="hash"
          apiKeysProps={{ hide: true }}
          appearance={profileAppearance}
        />
      </section>
    </div>
  )
}
