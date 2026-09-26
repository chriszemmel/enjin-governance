import type { Metadata } from "next"
import Link from "next/link"
import { LegalPage, Missing } from "@/components/legal/legal-page"
import { env } from "@/lib/env"
import { getOperator } from "@/lib/legal/operator"

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The rules for using this governance interface.",
}

export default function TermsPage() {
  const op = getOperator()
  const contact = op.email ? (
    <a href={`mailto:${op.email}`}>{op.email}</a>
  ) : (
    <Missing what="Email" />
  )
  return (
    <LegalPage title="Terms of use" subtitle="Nutzungsbedingungen" updated="26 September 2026">
      <section className="space-y-2">
        <h2>1. What this site is</h2>
        <p>
          This site is an independent, community-maintained interface for on-chain governance of the
          Enjin Blockchain (OpenGov): reading referenda, voting, filing proposals and discussing
          them. It is operated by {op.name} (see <Link href="/imprint">imprint</Link>
          ). The domain is provided by Enjin. The Enjin Blockchain is developed by Atlas Development
          Services, a core contributor to the Enjin Blockchain; its developers occasionally
          contribute code to this project.
        </p>
        <p>
          The site is non-custodial. It never holds your keys or funds and cannot sign, move or
          reverse anything for you. Every transaction is created and signed in your own wallet.
        </p>
      </section>

      <section className="space-y-2">
        <h2>2. No advice, no guarantee of accuracy</h2>
        <p>
          Nothing on this site is financial, investment, legal or tax advice. Balances, tallies,
          prices and timings are read from the chain and third-party services and can be delayed or
          wrong; the blockchain itself is authoritative. Decide and vote on your own judgement.
        </p>
      </section>

      <section className="space-y-2">
        <h2>3. Your wallet and transactions</h2>
        <p>
          You are responsible for your wallet, your keys and every transaction you sign. Blockchain
          transactions are final. Filing a referendum reserves deposits under the chain&apos;s
          rules; whether and when they are refunded is decided by the chain, not by us. Review what
          your wallet shows before you sign.
        </p>
      </section>

      <section className="space-y-2" id="content">
        <h2>4. Content you publish</h2>
        <p>
          You are responsible for the proposals, attachments, comments and profile details you
          publish, and you confirm that you have the rights to them. You allow us to store, display
          and deliver them as part of this site. A proposal that reaches the chain is referenced by
          its EGOV1 record and remains available as the record of what was voted on.
        </p>
        <p>
          Content must follow the <Link href="/docs#content-policy">content policy</Link>. In
          particular, never publish recovery phrases, private keys, other people&apos;s personal
          data, scams or illegal content.
        </p>
      </section>

      <section className="space-y-2">
        <h2>5. Reports, moderation and complaints</h2>
        <p>
          Anyone can report content with the report option next to it, or by email to {contact}.
          Please say where the content is and why it is unlawful or against the content policy.
          Moderators may keep, blur, hide or remove content and pause posting for accounts that
          break these terms. Every decision is recorded with its reason in the public{" "}
          <Link href="/moderation-log">moderation log</Link>; automatic checks may hold uploads for
          review, but a person decides. If you disagree with a decision, write to {contact} and we
          will review it. Referenda, votes and other on-chain records are never changed by
          moderation.
        </p>
      </section>

      <section className="space-y-2">
        <h2>6. Fair use</h2>
        <p>
          Do not attack, overload or try to break into the site, its accounts or its storage, and do
          not use it to harm others. Found a vulnerability? Please report it through the{" "}
          <Link href="/security">security page</Link> instead of exploiting it.
        </p>
      </section>

      <section className="space-y-2">
        <h2>7. Availability and changes</h2>
        <p>
          The site is provided free of charge and as it is. It may change, be interrupted or be
          discontinued. On-chain governance keeps working without it through any other compatible
          client. We may update these terms; the date at the top shows the current version.
        </p>
      </section>

      <section className="space-y-2">
        <h2>8. Liability</h2>
        <p>
          We are liable without limitation for intent and gross negligence and for injury to life,
          body or health. For slight negligence we are only liable for breach of an essential
          obligation, limited to the foreseeable, typical damage. Liability under mandatory law,
          such as product liability, is unaffected. We are not liable for the blockchain, wallets,
          third-party services or content published by others.
        </p>
      </section>

      <section className="space-y-2">
        <h2>9. Open source</h2>
        <p>
          This software is free software under the GNU Affero General Public License v3.0 or later.
          The source code is available at{" "}
          <a href={env.NEXT_PUBLIC_SOURCE_URL} target="_blank" rel="noopener noreferrer">
            {env.NEXT_PUBLIC_SOURCE_URL.replace(/^https?:\/\//, "")}
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2>10. Law</h2>
        <p>
          German law applies. If you use the site as a consumer, the mandatory consumer protection
          rules of the country where you live remain unaffected.
        </p>
      </section>

      <section className="space-y-2">
        <h2>11. Contact</h2>
        <p>Questions about these terms: {contact}.</p>
      </section>
    </LegalPage>
  )
}
