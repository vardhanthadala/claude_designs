import { useEffect, useRef, useState } from 'react'
import './Hero.css'

const HERO_VIDEO_URL =
  'https://pub-1e5b4001b36b47e28e6a2fb775966a79.r2.dev/templates/glowinn/hero.mp4'

const STATS = [
  { figure: '2M+', label: 'People', foot: 'Happy Customers' },
  { figure: '1000+', label: 'Products', foot: 'Retail Market' },
]

export default function Hero() {
  const videoRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const play = video.play()
    if (play?.catch) play.catch(() => {})
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.pause()
      setReady(true)
    }
  }, [])

  return (
    <section className="hero" id="top">
      <div className="hero__media" aria-hidden="true">
        <video
          ref={videoRef}
          className={`hero__video ${ready ? 'is-ready' : ''}`}
          src={HERO_VIDEO_URL}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={() => setReady(true)}
        />
        <div className="hero__scrim" />
      </div>

      <div className="hero__body shell">
        <h1 className="hero__title">
          <span className="hero__title-lead">Discover Beauty</span>
          Made for Modern Elegance.
        </h1>

        <a className="btn btn--pearl hero__cta" href="#products">
          Explore Our Products
        </a>
      </div>

      <div className="hero__foot shell">
        <article className="card card--note">
          <h2>Beauty That Speaks for Itself</h2>
          <p>
            From radiant skincare to flawless makeup, explore products designed for every skin
            type and style.
          </p>
        </article>

        <p className="hero__caption">Beauty glowinn in innerway of smile.</p>

        <div className="hero__stats">
          {STATS.map((s) => (
            <article key={s.figure} className="card card--stat">
              <strong>{s.figure}</strong>
              <span className="card__label">{s.label}</span>
              <span className="card__foot">{s.foot}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
