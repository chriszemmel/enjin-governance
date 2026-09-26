import type { Metadata } from "next"
import Link from "next/link"
import { LegalPage, Missing } from "@/components/legal/legal-page"
import { getOperator } from "@/lib/legal/operator"

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What this site processes, why, for how long, and your rights.",
}

// Services this deployment can use. Optional ones only apply when they are
// configured; the list mirrors what the code actually talks to.
const PROCESSORS: { name: string; purpose: string; where: string; when: string }[] = [
  {
    name: "Vercel Inc.",
    purpose: "Hosting, delivery, server logs",
    where: "USA / global edge",
    when: "Always",
  },
  {
    name: "Neon Inc.",
    purpose: "Database (profiles, comments, proposal records, sessions)",
    where: "Region of the deployment",
    when: "Always",
  },
  {
    name: "Cloudflare, Inc. (R2)",
    purpose: "File storage (proposal texts, attachments, avatars)",
    where: "Region of the bucket",
    when: "Always",
  },
  {
    name: "Upstash, Inc.",
    purpose: "Rate limiting (short-lived counters)",
    where: "Region of the database",
    when: "If configured",
  },
  {
    name: "Enjin Blockchain RPC nodes",
    purpose: "Reading the chain and sending your signed transactions",
    where: "Operated by the Enjin ecosystem",
    when: "When you use the site",
  },
  {
    name: "Reown (WalletConnect)",
    purpose: "Relay between this site and a mobile wallet",
    where: "Global",
    when: "Only with WalletConnect / Enjin Wallet",
  },
  {
    name: "CoinGecko",
    purpose: "Token price shown next to amounts (loaded by your browser)",
    where: "Singapore",
    when: "When prices are shown",
  },
  {
    name: "Subscan",
    purpose: "Chain history lookups made by our server (public chain data only)",
    where: "Global",
    when: "Some older referenda",
  },
  {
    name: "Anthropic PBC",
    purpose: "Automatic content checks of uploads, proposal text and comments",
    where: "USA",
    when: "Only if automatic checks are enabled",
  },
  {
    name: "Telegram",
    purpose: "Notifying maintainers of new security reports",
    where: "Global",
    when: "If configured",
  },
]

export default function PrivacyPage() {
  const op = getOperator()
  return (
    <LegalPage title="Privacy policy" subtitle="Datenschutzerklärung" updated="26 September 2026">
      <section className="space-y-2">
        <h2>1. Who is responsible</h2>
        <p>
          The controller under the GDPR is {op.name}
          {op.address.length > 0 ? `, ${op.address.join(", ")}` : ""}
          {op.address.length === 0 && (
            <>
              , <Missing what="Postal address" />
            </>
          )}
          . Contact:{" "}
          {op.email ? <a href={`mailto:${op.email}`}>{op.email}</a> : <Missing what="Email" />}. See
          also the <Link href="/imprint">imprint</Link>.
        </p>
      </section>

      <section className="space-y-2">
        <h2>2. In short</h2>
        <ul>
          <li>No tracking, no analytics, no advertising, no sale of data.</li>
          <li>
            Only cookies and browser storage that the site needs to work (see section 11), so there
            is no consent banner.
          </li>
          <li>
            Blockchain data is public and permanent. We can remove what we store; we cannot change
            what is on chain.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>3. Blockchain data</h2>
        <p>
          Votes, deposits, referenda and the pointer to a proposal&apos;s description (the EGOV1
          record) are written to the Enjin Blockchain by your wallet. They are public, visible to
          anyone and cannot be changed or deleted by us or anyone else. Wallet addresses are
          pseudonyms; they become personal data once they can be linked to you, for example through
          a profile name you choose here. Please keep this in mind before you publish anything.
        </p>
      </section>

      <section className="space-y-2">
        <h2>4. Visiting the site</h2>
        <p>
          When you open a page, our hosting provider processes technical data such as your IP
          address, date and time, the page requested and your browser&apos;s user agent, to deliver
          the site and keep it secure (Art. 6(1)(f) GDPR - our legitimate interest in a working,
          secure service). These logs are kept by the hosting provider for a short period according
          to its retention settings.
        </p>
      </section>

      <section className="space-y-2">
        <h2>5. Connecting a wallet</h2>
        <p>
          Connecting a wallet shares its public address with the site. Your browser then talks
          directly to Enjin Blockchain RPC nodes, which see your IP address. With WalletConnect or
          the Enjin Wallet, messages pass through the WalletConnect relay run by Reown. Your keys
          never leave your wallet; we cannot sign or move anything for you.
        </p>
      </section>

      <section className="space-y-2">
        <h2>6. Signing in</h2>
        <p>
          To comment, file or edit proposals, upload files or report content, you sign a one-time
          message with your wallet. We then store a session: your address, a hash of the session
          token, the time, your IP address and user agent. Sessions expire after 30 days or when you
          sign out. Legal basis: Art. 6(1)(b) GDPR (providing the features you ask for) and Art.
          6(1)(f) GDPR (preventing misuse).
        </p>
      </section>

      <section className="space-y-2">
        <h2>7. What you publish</h2>
        <p>
          Profiles (handle, display name, bio, avatar), comments, proposal texts and attachments are
          stored in our database and file storage and shown publicly with your address. Uploaded
          images are re-encoded before they are stored, which removes embedded metadata such as GPS
          location. You can edit or delete your profile and comments, and remove your own
          attachments.
        </p>
        <p>
          A proposal that reached the chain is referenced by its EGOV1 record, so its text stays
          available as the record of what was voted on. Edits are marked as such. If you need
          something removed for legal reasons, contact us (section 1).
        </p>
      </section>

      <section className="space-y-2">
        <h2>8. Reports and moderation</h2>
        <p>
          When you report content we store your account, the item, the category and your optional
          note, so moderators can review it. Your identity is never shown publicly. Moderation
          decisions are listed in the public <Link href="/moderation-log">moderation log</Link> with
          their reason and the moderator&apos;s name. If posting is paused for an account, we store
          the wallet&apos;s public key and the end date. Legal basis: Art. 6(1)(f) GDPR (a safe
          platform) and Art. 6(1)(c) GDPR where the law requires us to act on reports.
        </p>
      </section>

      <section className="space-y-2">
        <h2>9. Automatic content checks</h2>
        <p>
          If enabled, uploaded images and PDFs, proposal texts and comments are sent to Anthropic
          PBC (USA) to be checked by an AI model for content that must not be published, for
          example a readable wallet recovery phrase or someone else&apos;s ID document. Only the
          item itself is sent (with a file name, if any), not your address or profile. The result
          only blocks or holds an upload or places an item in the moderators&apos; queue; people
          make the decisions on everything else. Under Anthropic&apos;s commercial terms, this
          data is not used to train models. Legal basis: Art. 6(1)(f) GDPR (protecting users and
          third parties from harmful content).
        </p>
      </section>

      <section className="space-y-2">
        <h2>10. Security reports and rate limits</h2>
        <p>
          The <Link href="/security">security form</Link> stores what you enter plus a one-way hash
          of your IP address to spot abuse; maintainers may be notified via Telegram. To stop abuse,
          we count requests per IP address or account for a few minutes.
        </p>
      </section>

      <section className="space-y-2">
        <h2>11. Cookies and browser storage</h2>
        <ul>
          <li>
            <span className="font-mono text-xs">enjin-governance:session</span> - keeps you signed
            in (HTTP-only, 30 days).
          </li>
          <li>A site-access cookie, only while the site is password protected.</li>
          <li>Browser storage for your wallet connection, chosen network and colour theme.</li>
        </ul>
        <p>
          All of these are strictly necessary for features you use (§ 25(2) no. 2 TDDDG), so no
          consent is required. Fonts are served from this site; no third-party font service is
          contacted.
        </p>
      </section>

      <section className="space-y-2">
        <h2>12. Service providers and transfers</h2>
        <p>
          We use the following providers. Where data is processed outside the EU/EEA, the transfer
          is based on an adequacy decision (such as the EU-US Data Privacy Framework) or the EU
          standard contractual clauses.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {["Provider", "Purpose", "Location", "When"].map((h) => (
                  <th
                    key={h}
                    className="border border-border bg-surface-2 px-2 py-1.5 text-left font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name}>
                  <td className="border border-border px-2 py-1.5 align-top font-medium">
                    {p.name}
                  </td>
                  <td className="border border-border px-2 py-1.5 align-top">{p.purpose}</td>
                  <td className="border border-border px-2 py-1.5 align-top">{p.where}</td>
                  <td className="border border-border px-2 py-1.5 align-top">{p.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2>13. How long we keep data</h2>
        <ul>
          <li>Sessions: until they expire (30 days) or you sign out.</li>
          <li>Profiles, comments and files: until you or we delete them.</li>
          <li>Reports: until they are decided, then as part of the moderation record.</li>
          <li>Rate-limit counters: minutes.</li>
          <li>On-chain data: permanently, outside our control.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>14. Your rights</h2>
        <p>
          You have the right to access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17),
          restriction of processing (Art. 18), data portability (Art. 20) and to object to
          processing based on legitimate interests (Art. 21). Write to the contact in section 1. You
          can also lodge a complaint with a data protection supervisory authority (Art. 77), in
          particular in the EU member state where you live or work.
        </p>
      </section>

      <section className="space-y-2">
        <h2>15. Changes</h2>
        <p>
          We update this policy when the site changes. The date at the top shows the current
          version.
        </p>
      </section>
    </LegalPage>
  )
}
