import { CopyCommand } from "@/components/CopyCommand";
import { InboxDemo } from "@/components/InboxDemo";
import { Logo } from "@/components/Logo";
import { WaitlistForm } from "@/components/WaitlistForm";
import { LINKS } from "@/lib/links";

const FACTS = [
  { v: "Local", l: "No ZeroBox account · no server" },
  { v: "30 days", l: "To undo any cleanup" },
  { v: "1 command", l: "npx zerobox-cli" },
  { v: "MIT", l: "Read every line" },
];

export default function Home() {
  return (
    <div className="page hd-frame">
      <header className="border-b">
        <div className="wrap header-in">
          <a href="#top" className="brand" aria-label="ZeroBox home">
            <Logo width={34} height={26} />
            <span className="brand-name">
              Zero<span className="accent">Box</span>
            </span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href={LINKS.docs}>Docs</a>
            <a href="#features">Features</a>
            <a href={LINKS.changelog}>Changelog</a>
            <a href={LINKS.github}>GitHub</a>
          </nav>
          <a className="btn-ghost cta" href="#install">
            Install
          </a>
        </div>
      </header>

      <main>
        <section id="top" className="hero">
          <Logo width={620} height={462} className="hero-ghost" />
          <div className="wrap hero-in">
            <div className="eyebrow">
              <span className="eyebrow-rule" />
              <span>Gmail cleanup for the terminal</span>
            </div>
            <h1 className="hero-h">
              Get to inbox zero. <span className="accent">From the terminal.</span>
            </h1>
            <p className="lede">
              ZeroBox ranks every sender in your Gmail by how much you actually engage with them, then clears the noise in
              bulk: trash, unsubscribe and filter in one pass.{" "}
              <span className="bright">It runs on your machine, so your mail never touches anyone else&apos;s server.</span>
            </p>
            <CopyCommand id="install" />
            <div className="hero-meta">
              <div className="hero-meta-l">
                <span>macOS · Linux · Windows · Node 20+ · MIT</span>
                <a href={LINKS.docs}>all install methods →</a>
              </div>
              <a href="#waitlist" className="beta-link">
                <span className="beta-tag">BETA</span>
                <span className="beta-text">Free while in beta →</span>
              </a>
            </div>
          </div>
        </section>

        <section className="border-b" aria-label="At a glance">
          <div className="wrap facts">
            {FACTS.map((f) => (
              <div key={f.v} className="fact">
                <div className="fact-v">{f.v}</div>
                <div className="fact-l">{f.l}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b" aria-labelledby="demo-cap">
          <div className="wrap demo-sec">
            <div className="demo-cap">
              <span id="demo-cap">Your inbox, from a terminal</span>
              <span>Click a sender, then Space and R</span>
            </div>
            <InboxDemo />
            <p className="demo-note">
              Sample senders and numbers.{" "}
              <span className="bright">Nothing changes until you press R and confirm, and everything goes to Trash first.</span>
            </p>
          </div>
        </section>

        <section id="features" aria-label="Features">
          <div className="wrap feats">
            <div className="feat">
              <div className="feat-n" aria-hidden="true">01</div>
              <div className="feat-txt">
                <h3>Ranks senders by what you ignore.</h3>
                <p>
                  Every sender gets a verdict, Nuke, Review or Keep, from how much they send and how much of it you open or
                  reply to. Bank, health and account mail is marked Protect, and starred mail is never touched.
                </p>
              </div>
              <div className="card">
                <div className="kv"><span>deals@shop.example</span><span className="c-red">nuke</span></div>
                <div className="kv"><span>news@saas.example</span><span className="c-yellow">review</span></div>
                <div className="kv"><span>alerts@bank.example</span><span className="c-blue">protect</span></div>
              </div>
            </div>

            <div className="feat">
              <div className="feat-n" aria-hidden="true">02</div>
              <div className="feat-txt">
                <h3>Undo is the default.</h3>
                <p>
                  Cleanups go to Gmail Trash, where you can restore them for 30 days. Permanent delete exists, behind a flag
                  you have to type on purpose.
                </p>
              </div>
              <div className="card">
                <div><span className="accent">$</span> zerobox clean</div>
                <div className="c-2">→ 2,016 emails moved to Trash</div>
                <div className="c-3">restore any time in the next 30 days</div>
              </div>
            </div>

            <div className="feat">
              <div className="feat-n" aria-hidden="true">03</div>
              <div className="feat-txt">
                <h3>Unsubscribe without the tabs.</h3>
                <p>
                  Most newsletters support one-click unsubscribe. ZeroBox sends it for you, so you never open forty browser
                  tabs to escape forty lists.
                </p>
              </div>
              <div className="card">
                <div className="kv"><span>deals@shop.example</span><span className="accent">one-click ✓</span></div>
                <div className="kv"><span>offers@travel.example</span><span className="accent">by email ✓</span></div>
                <div className="kv"><span>hello@recipes.example</span><span className="c-2">opens page</span></div>
              </div>
            </div>

            <div className="feat">
              <div className="feat-n" aria-hidden="true">04</div>
              <div className="feat-txt">
                <h3>Keeps it gone.</h3>
                <p>
                  Turn a cleanup into Gmail filters, so the same senders skip your inbox from now on. Zero stays zero.
                </p>
              </div>
              <div className="card">
                <div><span className="accent">$</span> zerobox filter</div>
                <div className="c-2">→ 12 filters created</div>
                <div className="c-3">future mail from these senders skips the inbox</div>
              </div>
            </div>

            <div className="feat">
              <div className="feat-n" aria-hidden="true">05</div>
              <div className="feat-txt">
                <h3>Your machine. Your mail.</h3>
                <p>
                  No ZeroBox account, no server, no tracking. You sign in through your own Google client, ZeroBox talks to
                  Gmail straight from your terminal, and it&apos;s MIT-licensed so you can read every line of what it does.
                </p>
              </div>
              <div className="card">
                <div className="kv"><span className="c-3">data</span><span>~/.config/zerobox</span></div>
                <div className="kv"><span className="c-3">server</span><span>none</span></div>
                <div className="kv"><span className="c-3">license</span><span>MIT</span></div>
              </div>
            </div>
          </div>
        </section>

        <section id="waitlist" className="waitlist" aria-labelledby="waitlist-h">
          <div className="wrap waitlist-in">
            <div className="waitlist-txt">
              <div className="waitlist-eyebrow">
                <span className="accent">ZeroBox Web</span> <span className="c-3">· coming soon</span>
              </div>
              <h2 id="waitlist-h">Same cleanup. No terminal.</h2>
              <p>A hosted version for people who would rather click. Leave your email and we&apos;ll tell you when it&apos;s ready.</p>
            </div>
            <WaitlistForm />
          </div>
        </section>

        <section className="close-sec" aria-labelledby="close-h">
          <Logo width={560} height={417} className="close-ghost" />
          <div className="wrap close-in">
            <h2 id="close-h" className="close-h">
              Your inbox, <span className="accent">at zero.</span>
            </h2>
            <p className="close-p">
              Install with one command. During the beta, <span className="mono bright">zerobox setup</span> walks you
              through connecting your own Google client, about 5 minutes once. Then review the plan and apply it. Nothing
              changes until you press <span className="mono bright">R</span> and confirm.
            </p>
            <CopyCommand />
            <div className="close-meta">
              Windows: the same command in PowerShell or Windows Terminal · requires Node 20+ ·{" "}
              <a href={LINKS.docs}>all install methods →</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <div className="foot-grp">
            <span className="foot-brand">
              <Logo width={24} height={18} />
              <span>Zero<span className="accent">Box</span></span>
            </span>
            <a href={LINKS.docs} className="muted">docs</a>
            <a href={LINKS.github} className="muted">github</a>
            <a href={LINKS.npm} className="muted">npm</a>
            <a href={LINKS.changelog} className="muted">changelog</a>
            <span>built in the terminal · © 2026 CodeMonkeyStudios</span>
          </div>
          <div className="foot-grp">
            <span>v0.1.0 · MIT</span>
            {/* TODO(owner): placeholder until the real Buy Me a Coffee URL exists. */}
            <a href={LINKS.sponsor} className="coffee cta">Sponsor on GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
