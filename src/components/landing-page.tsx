import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Code2,
  Database,
  Layers3,
  LockKeyhole,
  MessageSquare,
  Radio,
  ShieldCheck,
  Webhook,
  Zap,
} from "lucide-react";

const integrations = ["Sentry", "Datadog", "GitHub", "Vercel", "Stripe", "AWS"];

const features = [
  {
    icon: Webhook,
    title: "One endpoint. Any signal.",
    description:
      "Send alerts from the tools you already use. SignalMend accepts flexible webhook payloads without a brittle setup process.",
    detail: "Sentry · GitHub · Stripe · custom",
  },
  {
    icon: Zap,
    title: "From alert to action",
    description:
      "Route meaningful incidents to Slack with the context your team needs to respond—not another wall of noisy notifications.",
    detail: "Smart routing · Slack delivery",
  },
  {
    icon: ShieldCheck,
    title: "Trust every incoming event",
    description:
      "Verify webhook signatures, keep a clear record of what happened, and give your team a dependable source of truth.",
    detail: "HMAC verification · audit trail",
  },
];

const plans = [
  {
    name: "Developer",
    price: "Free",
    description: "For side projects and your first production signals.",
    features: ["1,000 webhooks / month", "2 signed endpoints", "30 requests / minute", "Slack incident alerts"],
    action: "Start for free",
  },
  {
    name: "Pro Team",
    price: "$29",
    cadence: "/ month",
    description: "For teams that need more coverage without more overhead.",
    features: ["50,000 webhooks / month", "15 signed endpoints", "300 requests / minute", "Incident routing rules"],
    action: "Get started",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "$79",
    cadence: "/ month",
    description: "For high-volume operations and longer audit windows.",
    features: ["500,000 webhooks / month", "Unlimited endpoints", "3,000 requests / minute", "Incident routing rules"],
    action: "Talk to us",
  },
];

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a className={`sm-brand${footer ? " sm-brand-footer" : ""}`} href="#top" aria-label="SignalMend home">
      <span className="sm-brand-mark" aria-hidden="true">
        <Activity size={19} strokeWidth={2.2} />
      </span>
      <span>signal<span className="sm-brand-light">mend</span></span>
    </a>
  );
}

function DashboardPreview() {
  return (
    <div className="sm-product-window" role="img" aria-label="Illustration of the SignalMend incident dashboard">
      <div className="sm-window-top">
        <div className="sm-window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>app.signalmend.com / incidents</span>
        <span className="sm-window-secure"><LockKeyhole size={12} /> Secure</span>
      </div>
      <div className="sm-dashboard">
        <aside className="sm-sidebar">
          <div className="sm-sidebar-brand"><span className="sm-mini-mark"><Activity size={14} /></span> SignalMend</div>
          <span className="sm-sidebar-label">WORKSPACE</span>
          <div className="sm-workspace"><span className="sm-workspace-avatar">A</span> Acme Studio <span>⌄</span></div>
          <div className="sm-side-link sm-side-active"><Layers3 size={15} /> Incidents <span className="sm-side-count">3</span></div>
          <div className="sm-side-link"><Webhook size={15} /> Endpoints</div>
          <div className="sm-side-link"><Radio size={15} /> Integrations</div>
          <div className="sm-side-link"><Database size={15} /> Event log</div>
          <div className="sm-sidebar-bottom"><span className="sm-avatar">JD</span><span>Jamie Davis<small>Owner</small></span><span className="sm-more">···</span></div>
        </aside>
        <div className="sm-dashboard-main">
          <div className="sm-dashboard-heading">
            <div><span className="sm-dashboard-eyebrow">OVERVIEW</span><h3>Incidents</h3></div>
            <span className="sm-live-pill"><i /> All systems operational</span>
          </div>
          <div className="sm-metric-grid">
            <div className="sm-metric"><span>Events today</span><strong>1,284</strong><small><b>↑ 12%</b> vs. yesterday</small><Activity className="sm-metric-icon" size={17} /></div>
            <div className="sm-metric"><span>Open incidents</span><strong>03</strong><small className="sm-neutral">Across 2 services</small><CircleAlert className="sm-metric-icon sm-orange" size={17} /></div>
            <div className="sm-metric"><span>Avg. response</span><strong>2m 14s</strong><small><b>↓ 18%</b> this week</small><Clock3 className="sm-metric-icon" size={17} /></div>
          </div>
          <div className="sm-incidents-card">
            <div className="sm-incidents-heading"><div><strong>Recent incidents</strong><small>Your latest incoming signals</small></div><span>View all <ArrowUpRight size={13} /></span></div>
            <div className="sm-incident-row">
              <span className="sm-status-dot sm-status-red" />
              <span className="sm-incident-source sm-sentry">S</span>
              <span className="sm-incident-copy"><strong>Payment service returning 500s</strong><small>api.production · 2 minutes ago</small></span>
              <span className="sm-severity sm-severity-high">Critical</span>
            </div>
            <div className="sm-incident-row">
              <span className="sm-status-dot sm-status-yellow" />
              <span className="sm-incident-source sm-github"><Code2 size={14} /></span>
              <span className="sm-incident-copy"><strong>Deployment check failed</strong><small>web-app · 18 minutes ago</small></span>
              <span className="sm-severity sm-severity-warn">Warning</span>
            </div>
            <div className="sm-incident-row">
              <span className="sm-status-dot sm-status-green" />
              <span className="sm-incident-source sm-datadog">D</span>
              <span className="sm-incident-copy"><strong>Memory usage back to normal</strong><small>worker-03 · 43 minutes ago</small></span>
              <span className="sm-severity sm-severity-ok">Resolved</span>
            </div>
          </div>
          <div className="sm-delivery-toast"><span><MessageSquare size={16} /></span><div><strong>Delivered to #incident-response</strong><small>Slack notification sent just now</small></div><Check size={15} /></div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="sm-site" id="top">
      <div className="sm-grain" aria-hidden="true" />
      <header className="sm-header">
        <nav className="sm-nav" aria-label="Main navigation">
          <Brand />
          <div className="sm-nav-links">
            <a href="#product">Product</a>
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="sm-nav-actions">
            <a className="sm-login" href="/onboarding">Log in</a>
            <a className="sm-button sm-button-small" href="/onboarding">Get started <ArrowRight size={15} /></a>
          </div>
        </nav>
      </header>

      <section className="sm-hero">
        <div className="sm-hero-copy">
          <div className="sm-eyebrow"><span className="sm-eyebrow-pulse" /> INCIDENT RESPONSE, WITHOUT THE NOISE</div>
          <h1>Catch the signal.<br />Mend the <span>moment.</span></h1>
          <p className="sm-hero-description">
            The webhook engine that turns scattered alerts into clear, actionable incidents. Get the right signal to the right people—before a small issue becomes a big one.
          </p>
          <div className="sm-hero-actions">
            <a className="sm-button" href="/onboarding">Start for free <ArrowRight size={17} /></a>
            <a className="sm-text-link" href="#product">Explore the platform <span><ArrowRight size={15} /></span></a>
          </div>
          <div className="sm-proof"><span className="sm-proof-icon"><ShieldCheck size={15} /></span>Set up in minutes <i /> No credit card required <i /> Built for developers</div>
        </div>
        <div className="sm-hero-visual">
          <div className="sm-visual-glow" aria-hidden="true" />
          <div className="sm-orbit sm-orbit-one" aria-hidden="true" />
          <div className="sm-orbit sm-orbit-two" aria-hidden="true" />
          <DashboardPreview />
          <div className="sm-floating-event">
            <span className="sm-event-icon"><CircleAlert size={16} /></span>
            <span><strong>Critical signal detected</strong><small>Payment API · just now</small></span>
            <span className="sm-event-live"><i /> LIVE</span>
          </div>
          <div className="sm-floating-secure"><LockKeyhole size={14} /><span>Signature verified</span><Check size={13} /></div>
        </div>
      </section>

      <section className="sm-integrations" aria-label="Supported integrations">
        <div className="sm-integrations-label">CONNECTS TO YOUR STACK</div>
        <div className="sm-integrations-list">
          {integrations.map((name) => <span key={name}><i />{name}</span>)}
          <span className="sm-integration-custom"><Webhook size={15} /> Any webhook</span>
        </div>
      </section>

      <section className="sm-section sm-features" id="product">
        <div className="sm-section-heading">
          <span className="sm-section-kicker">LESS NOISE. MORE SIGNAL.</span>
          <h2>Your incident workflow,<br /><span>finally in one place.</span></h2>
          <p>Skip the glue code and the dashboard hopping. SignalMend gives every alert a clear path from source to resolution.</p>
        </div>
        <div className="sm-feature-grid">
          {features.map(({ icon: Icon, title, description, detail }, index) => (
            <article className="sm-feature-card" key={title}>
              <div className="sm-feature-top"><span className="sm-feature-icon"><Icon size={20} /></span><span className="sm-feature-number">0{index + 1}</span></div>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="sm-feature-detail"><Check size={13} />{detail}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="sm-workflow" id="how-it-works">
        <div className="sm-workflow-copy">
          <span className="sm-section-kicker">FROM EVENT TO UNDERSTOOD</span>
          <h2>Every alert has<br />a clearer next step.</h2>
          <p>Keep your team in the loop and your incident history in one place. SignalMend handles the hand-offs, so your people can focus on the fix.</p>
          <a className="sm-inline-link" href="/onboarding">Build your incident workflow <ArrowRight size={16} /></a>
        </div>
        <div className="sm-flow">
          <div className="sm-flow-line" aria-hidden="true" />
          <div className="sm-flow-step">
            <span className="sm-flow-icon sm-flow-purple"><Webhook size={19} /></span>
            <div><span className="sm-flow-label">01 / INGEST</span><strong>Your tools send a signal</strong><small>Sentry detects an exception in production.</small></div>
            <span className="sm-flow-check"><Check size={13} /></span>
          </div>
          <div className="sm-flow-step">
            <span className="sm-flow-icon sm-flow-blue"><ShieldCheck size={19} /></span>
            <div><span className="sm-flow-label">02 / VERIFY</span><strong>SignalMend checks the event</strong><small>Validate the signature. Capture the context.</small></div>
            <span className="sm-flow-check"><Check size={13} /></span>
          </div>
          <div className="sm-flow-step">
            <span className="sm-flow-icon sm-flow-green"><MessageSquare size={19} /></span>
            <div><span className="sm-flow-label">03 / RESPOND</span><strong>Your team gets the right alert</strong><small>Route the incident to your Slack war room.</small></div>
            <span className="sm-flow-check"><Check size={13} /></span>
          </div>
          <div className="sm-flow-step">
            <span className="sm-flow-icon sm-flow-orange"><Database size={19} /></span>
            <div><span className="sm-flow-label">04 / REMEMBER</span><strong>Every action leaves a trail</strong><small>Keep a searchable record for your next review.</small></div>
            <span className="sm-flow-check"><Check size={13} /></span>
          </div>
        </div>
      </section>

      <section className="sm-cta-band">
        <div className="sm-cta-icon"><Zap size={21} /></div>
        <div><span>YOUR NEXT INCIDENT DOESN’T HAVE TO BE CHAOTIC</span><h2>Make the first response the easy part.</h2></div>
        <a className="sm-button sm-button-light" href="/onboarding">Get started free <ArrowRight size={16} /></a>
      </section>

      <section className="sm-section sm-pricing" id="pricing">
        <div className="sm-section-heading">
          <span className="sm-section-kicker">STRAIGHTFORWARD BY DESIGN</span>
          <h2>Room to grow.<br /><span>No enterprise tax.</span></h2>
          <p>Start free, then scale your incident coverage when your team is ready.</p>
        </div>
        <div className="sm-pricing-grid">
          {plans.map((plan) => (
            <article className={`sm-plan${plan.featured ? " sm-plan-featured" : ""}`} key={plan.name}>
              {plan.featured && <span className="sm-plan-badge">MOST POPULAR</span>}
              <span className="sm-plan-name">{plan.name}</span>
              <div className="sm-plan-price">{plan.price}<small>{plan.cadence ?? ""}</small></div>
              <p>{plan.description}</p>
              <a className={plan.featured ? "sm-button" : "sm-button sm-button-outline"} href="/onboarding">{plan.action}<ArrowRight size={15} /></a>
              <div className="sm-plan-divider" />
              <span className="sm-plan-includes">INCLUDES</span>
              <ul>{plan.features.map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}</ul>
            </article>
          ))}
        </div>
        <p className="sm-pricing-note">Need a custom setup? <a href="mailto:hello@signalmend.com">Let’s talk <ArrowUpRight size={13} /></a></p>
      </section>

      <footer className="sm-footer">
        <div className="sm-footer-top"><div><Brand footer /><p>Catch the signal. Mend the moment.</p></div><a href="/onboarding">Start building <ArrowRight size={15} /></a></div>
        <div className="sm-footer-bottom"><span>© {new Date().getFullYear()} SignalMend. Built for calmer on-calls.</span><div><a href="#product">Product</a><a href="#pricing">Pricing</a><a href="mailto:hello@signalmend.com">Contact</a></div></div>
      </footer>
    </main>
  );
}
