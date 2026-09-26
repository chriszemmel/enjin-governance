import type { Metadata } from "next"
import Link from "next/link"
import { LegalPage } from "@/components/legal/legal-page"
import { getOperator } from "@/lib/legal/operator"

export const metadata: Metadata = {
  title: "Imprint (Impressum)",
  description: "Who operates this site and how to reach them.",
}

export default function ImprintPage() {
  const op = getOperator()
  return (
    <LegalPage
      title="Imprint (Impressum)"
      subtitle="Information according to § 5 DDG (Germany) / Angaben gemäß § 5 DDG"
      updated="26 September 2026"
    >
      <section className="space-y-1">
        <h2>Operator / Diensteanbieter</h2>
        <p className="text-foreground font-medium">{op.name}</p>
        {op.address.length > 0 ? (
          op.address.map((line) => <p key={line}>{line}</p>)
        ) : (
          <p>
            Postal address on request by email / Anschrift auf Anfrage per E-Mail:{" "}
            <a href={`mailto:${op.email}`}>{op.email}</a>
          </p>
        )}
      </section>

      <section className="space-y-1">
        <h2>Contact / Kontakt</h2>
        <p>
          Email: <a href={`mailto:${op.email}`}>{op.email}</a>
        </p>
        {op.phone && <p>Phone / Telefon: {op.phone}</p>}
        <p>
          Security issues: <Link href="/security">responsible disclosure form</Link>
        </p>
      </section>

      {op.vatId && (
        <section className="space-y-1">
          <h2>VAT ID / USt-IdNr.</h2>
          <p>{op.vatId}</p>
        </section>
      )}

      <section className="space-y-1">
        <h2>Responsible for content / Verantwortlich nach § 18 Abs. 2 MStV</h2>
        <p>
          {op.name}
          {op.address.length > 0 ? `, ${op.address.join(", ")}` : ""}
        </p>
      </section>

      <section className="space-y-2">
        <h2>About this site</h2>
        <p>
          This site is an independent, community-maintained interface to on-chain governance of the
          Enjin Blockchain. It is developed and maintained by {op.name}. The domain is provided by
          Enjin. The Enjin Blockchain itself is developed by Atlas Development Services, a core
          contributor to the Enjin Blockchain, whose developers occasionally contribute to this
          project.
        </p>
        <p>
          Proposals, attachments and comments are published by their authors, who are responsible
          for them. To report content, use the report option next to it or write to the address
          above; see the <Link href="/terms#content">terms</Link> and the{" "}
          <Link href="/docs#content-policy">content policy</Link>.
        </p>
      </section>

      <section className="space-y-2">
        <h2>Consumer dispute resolution / Verbraucherstreitbeilegung</h2>
        <p>
          We are neither obliged nor willing to take part in dispute resolution proceedings before a
          consumer arbitration board. / Wir sind nicht bereit oder verpflichtet, an
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </section>
    </LegalPage>
  )
}
