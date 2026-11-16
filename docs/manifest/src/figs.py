from figs_base import *  # noqa: F401,F403

LANG = 'de'


def tr(de, en):
    return de if LANG == 'de' else en


TONES = {'n': ('#fff', LINE, IND), 'ok': (OK50, '#86EFAC', OK7), 'bad': (BAD50, '#FCA5A5', BAD7),
         'dash': (PAPER, LINE, MUTED), 'teal': (TEAL50, TEAL200, TEAL7), 'ind': (IND50, IND200, IND),
         'warn': ('#FFFBEB', '#FCD34D', WARN7)}


def box(x, y, w, h, icon, num, title, body, tone='n', size=10.8, lh=14.5, tsize=12.5):
    f, s, c = TONES[tone]
    out = rect(x, y, w, h, f, s, 8, 1.3, '5 4' if tone == 'dash' else None)
    tx = x + 12
    if icon:
        out += ic(icon, x + 12, y + 11, 18, c)
        tx = x + 38
    tcol = INK if tone in ('n', 'dash', 'ind') else c
    out += T(tx, y + 25, (f'{num}  ' if num else '') + title, tsize, 600, tcol)
    out += L(x + 12, y + 46, body, size, lh, INK2 if tone != 'dash' else MUTED)
    return out


def mono(x, y, txt, size=10.8, fill=IND7, w=500, anchor='start'):
    return T(x, y, txt, size, w, fill, anchor, M)


# ---------------------------------------------------------------- where the data comes from
def fig_sources():
    b = T(300, 12, tr('Die Chain: die Quelle', 'The chain: the source'), 12.5, 600, TEAL7, fam=D)
    b += box(300, 22, 340, 64, 'network', '', tr('Live-Knoten (RPC)', 'Live node (RPC)'),
             [tr('Referenden, Stimmen, Salden, Konstanten der Runtime', 'Referenda, votes, balances, runtime constants')], 'teal')
    b += box(300, 98, 340, 64, 'archive', '', tr('Archivknoten', 'Archive node'),
             [tr('Zustand an jedem früheren Block: Stimmen, Aufrufe', 'State at any past block: votes, calls')], 'teal')
    b += T(300, 192, tr('Außerhalb der Chain: Zwischenspeicher, nie Quelle', 'Off chain: caches, never the source'), 12.5, 600, MUTED, fam=D)
    b += box(300, 202, 340, 64, 'server', '', tr('App-Server mit Datenbank und Dateien', 'App server with database and files'),
             [tr('Anmeldung, Profile, Kommentare, Entwürfe, Texte, Moderation', 'Sign-in, profiles, comments, drafts, texts, moderation')])
    b += box(300, 278, 340, 56, 'search', '', tr('Block-Explorer (optional)', 'Block explorer (optional)'),
             [tr('nur als letzter Rückgriff für sehr alte Referenden', 'only as a last resort for very old referenda')], 'dash', lh=13)
    b += box(0, 118, 200, 110, 'monitor-smartphone', '', 'Browser',
             tr(['liest die Chain direkt', 'über WebSocket, prüft', 'Hashes selbst und', 'signiert in der Wallet.'],
                ['reads the chain directly', 'over WebSocket, checks', 'hashes itself and', 'signs in the wallet.']), 'ind')
    b += path('M200 140 C 250 140, 250 54, 297 54', TEAL7, 'at', None, 1.6)
    b += path('M200 160 C 255 160, 255 130, 297 130', TEAL7, 'at', None, 1.6)
    b += path('M200 196 C 255 196, 255 234, 297 234', IND, 'ai', None, 1.4)
    b += path('M200 216 C 245 216, 245 306, 297 306', MUTED, 'a', '4 3', 1.3)
    b += T(232, 92, tr('direkt', 'direct'), 10.5, 600, TEAL7, 'middle', halo=True)
    b += T(238, 190, tr('nur Texte', 'texts only'), 10.5, 600, IND7, 'middle', halo=True)
    return svg(640, 334, b, tr('Woher die Daten kommen', 'Where the data comes from'))


# ---------------------------------------------------------------- fallback order
def fig_fallback():
    w, g = 146, 18
    items = [
        ('1', tr('Live', 'Live'), tr(['Laufende Referenden', 'direkt vom Knoten.'], ['Ongoing referenda,', 'straight from the node.']), 'teal'),
        ('2', tr('Archiv', 'Archive'), tr(['Zustand am Block', 'vor der Entscheidung.'], ['State at the block', 'before the decision.']), 'teal'),
        ('3', 'Preimage', tr(['Aufruf aus dem', 'Preimage-Speicher,', 'Länge notfalls gesucht.'], ['The call from the', 'preimage store, its', 'length recovered.']), 'teal'),
        ('4', 'Explorer', tr(['Externer Dienst, nur', 'für sehr alte Fälle,', 'optional.'], ['An outside service,', 'only for very old', 'cases, optional.']), 'dash'),
    ]
    b = ''
    for i, (n, t, body, tone) in enumerate(items):
        x = i * (w + g)
        b += box(x, 0, w, 100, '', n, t, body, tone)
    for i in range(3):
        x = i * (w + g) + w
        b += arrow(x + 1, 50, x + g - 2, 50, MUTED, 'a', None, 1.4)
    b += rect(0, 118, 638, 40, PAPER, LINE, 8, 1.2, '5 4')
    b += T(14, 143, tr('Die erste Quelle, die antwortet, gilt. Antwortet keine, steht der Grund da, nie ein leeres Feld.',
                       'The first source that answers wins. If none answers, the reason shows, never an empty field.'), 10.8, 500, INK2)
    return svg(640, 160, b, tr('Reihenfolge der Quellen', 'Order of sources'))


# ---------------------------------------------------------------- lifecycle
def fig_lifecycle():
    rows = [
        (tr('Vorbereiten', 'Prepare'), tr('Fehlt die Entscheidungskaution, sagt die Karte, wie viel nötig ist.',
                                          'Without a decision deposit, the card says how much is needed.'), 'referendumInfoFor'),
        (tr('Entscheiden', 'Decide'), tr('Ist der Track voll, steht da „In der Warteschlange“, kein Countdown.',
                                         'If the track is full, it says “Queued”, not a countdown.'), 'track.maxDeciding'),
        (tr('Bestätigen', 'Confirm'), tr('Beginnt dort, wo der Alarm der Runtime es sagt, nicht geschätzt.',
                                         "Starts where the runtime's alarm says, not at a guess."), 'alarm'),
        (tr('Ausführen', 'Enact'), tr('Bleibt offen, bis der Scheduler den Aufruf ausgeführt hat.',
                                      'Stays open until the scheduler has run the call.'), 'scheduler.lookup'),
        (tr('Auszahlen', 'Payout'), tr('Nur bei Treasury-Ausgaben: nächste Periode, dann bezahlt, mit Block.',
                                       'Treasury spends only: next period, then paid, with its block.'), 'treasury.proposals'),
    ]
    b = f'<line x1="15" y1="18" x2="15" y2="{18 + 4 * 52}" stroke="{IND200}" stroke-width="3"/>'
    for i, (st, txt, src) in enumerate(rows):
        y = 18 + i * 52
        b += f'<circle cx="15" cy="{y}" r="13" fill="{IND}"/>' + T(15, y + 4.5, str(i + 1), 12, 600, '#fff', 'middle', D)
        b += T(40, y + 5, st, 12.5, 600, INK, fam=D)
        b += T(150, y - 2, txt, 10.8, 400, INK2)
        b += mono(150, y + 15, src, 10.2, MUTED, 400)
    b += rect(0, 270, 638, 38, PAPER, LINE, 8)
    b += T(14, 294, tr('Geschätzte Daten tragen „≈“. Was geschehen ist, kommt mit Block und Ergebnis aus dem Archivknoten.',
                       'Estimated dates carry “≈”. What has happened comes with its block and result from the archive node.'), 10.8, 500, INK2)
    return svg(640, 310, b, tr('Lebenslauf eines Referendums', 'Lifecycle of a referendum'))


# ---------------------------------------------------------------- support denominator
def fig_support():
    x0, x1 = 150, 610
    b = T(0, 14, tr('Ausgabe von ENJ auf dem Mainnet, in Millionen', 'ENJ issuance on mainnet, in millions'), 12.5, 600, INK, fam=D)
    sc = (x1 - x0) / 2029
    b += T(x0 - 12, 47, tr('gesamt 2.029', 'total 2,029'), 11, 600, INK2, 'end')
    b += f'<rect x="{x0}" y="30" width="{1454 * sc}" height="26" fill="{IND}"/>'
    b += f'<rect x="{x0 + 1454 * sc}" y="30" width="{575 * sc}" height="26" fill="url(#hatch)" stroke="{IND}" stroke-width="1"/>'
    b += T(x0 + 8, 47, tr('aktiv ≈ 1.454', 'active ≈ 1,454'), 11, 600, '#fff')
    b += T(x1 - 8, 47, tr('inaktiv ≈ 575', 'inactive ≈ 575'), 11, 600, IND8, 'end', halo=True)
    b += T(0, 100, tr('Referendum #15: Unterstützung bei Beginn der Bestätigung, in Prozent', 'Referendum #15: support when confirming began, in percent'), 12.5, 600, INK, fam=D)
    s2 = (x1 - x0) / 40
    for v in (0, 10, 20, 30, 40):
        x = x0 + v * s2
        b += f'<line x1="{x}" y1="112" x2="{x}" y2="190" stroke="{RULE}" stroke-width="1"/>' + T(x, 206, f'{v}', 10.5, 400, MUTED, 'middle')
    b += T(x0 - 12, 134, tr('geteilt durch aktiv', 'over active'), 11, 600, INK2, 'end')
    b += f'<rect x="{x0}" y="120" width="{33.9 * s2}" height="22" fill="{OK}"/>' + T(x0 + 33.9 * s2 + 6, 136, '33,9' if LANG == 'de' else '33.9', 11, 700, OK7)
    b += T(x0 - 12, 172, tr('geteilt durch gesamt', 'over total'), 11, 600, INK2, 'end')
    b += f'<rect x="{x0}" y="158" width="{24.3 * s2}" height="22" fill="{BAD}"/>' + T(x0 + 24.3 * s2 + 6, 174, '24,3' if LANG == 'de' else '24.3', 11, 700, BAD7)
    rx = x0 + 32.3 * s2
    b += f'<line x1="{rx}" y1="112" x2="{rx}" y2="190" stroke="{INK}" stroke-width="1.6" stroke-dasharray="4 3"/>'
    b += T(rx, 226, tr('verlangt 32,3', 'required 32.3'), 11, 600, INK, 'middle')
    return svg(640, 230, b, tr('Nenner der Unterstützung', 'The support denominator'))


# ---------------------------------------------------------------- EGOV1 batch
def fig_batch():
    b = rect(0, 0, 404, 250, IND50, IND200, 10)
    b += ic('pen', 14, 13, 18, IND) + T(40, 28, tr('utility.batchAll: eine Signatur', 'utility.batchAll: one signature'), 12.5, 600, INK)
    calls = [
        ('preimage.notePreimage(call)', tr('der Aufruf, der ausgeführt werden soll', 'the call to be enacted')),
        ('referenda.submit(origin, call, when)', tr('das Referendum auf seinem Track', 'the referendum on its track')),
        ("preimage.notePreimage('EGOV1:{u,h}')", tr('der Umschlag: Adresse und SHA-256 des Texts', 'the envelope: URL and SHA-256 of the text')),
        ('referenda.setMetadata(index, hash)', tr('bindet den Umschlag an das Referendum', 'binds the envelope to the referendum')),
    ]
    for i, (c, d) in enumerate(calls):
        y = 48 + i * 49
        b += rect(14, y, 376, 41, '#fff', IND200, 6)
        b += T(28, y + 17, str(i + 1), 12, 700, IND, 'middle', D)
        b += mono(42, y + 17, c, 10.8, IND7, 600) + T(42, y + 33, d, 10.5, 400, INK2)
    b += box(434, 0, 206, 104, 'circle-check', '', tr('Alles landet', 'Everything lands'),
             tr(['Referendum und Text sind', 'in einem Block verbunden.', 'Jeder kann es nachlesen.'],
                ['Referendum and text are', 'bound in one block.', 'Anyone can read it back.']), 'ok')
    b += box(434, 128, 206, 122, 'circle-x', '', tr('Index veraltet', 'Stale index'),
             tr(['Kam ein anderer Antrag', 'zuerst, scheitert', 'setMetadata. Der ganze', 'Stapel wird zurückgerollt.'],
                ['If another proposal came', 'first, setMetadata fails.', 'The whole batch is', 'rolled back.']), 'bad')
    b += arrow(404, 52, 432, 52, OK, 'ag')
    b += arrow(404, 190, 432, 190, BAD, 'ar', '5 4')
    return svg(640, 252, b, tr('Der EGOV1-Stapel', 'The EGOV1 batch'))


# ---------------------------------------------------------------- verify
def fig_verify():
    w, g = 112, 20
    steps = [(tr('Verweis', 'Pointer'), 'metadataOf(i)'), (tr('Auflösen', 'Resolve'), 'preimageFor'),
             (tr('Umschlag', 'Envelope'), 'EGOV1:{u,h}'), (tr('Laden', 'Fetch'), tr('JSON von u', 'JSON at u')),
             (tr('Vergleich', 'Compare'), 'SHA-256 = h?')]
    b = ''
    for i, (t, m) in enumerate(steps):
        x = i * (w + g)
        b += rect(x, 0, w, 64, TEAL50 if i < 3 else IND50, TEAL200 if i < 3 else IND200, 8)
        b += T(x + 10, 24, f'{i + 1}  {t}', 12, 600, INK)
        b += mono(x + 10, 46, m, 10.5, TEAL7 if i < 3 else IND7, 600)
        if i:
            b += arrow(x - g + 1, 32, x - 2, 32, MUTED, 'a', None, 1.4)
    b += T(0, 90, tr('Schritte 1 bis 3 auf der Chain', 'Steps 1 to 3 on chain'), 10.8, 600, TEAL7)
    b += T(264, 90, tr('Schritte 4 und 5 überall: Browser, Skript, Indexer', 'Steps 4 and 5 anywhere: browser, script, indexer'), 10.8, 600, IND7)
    b += rect(0, 104, 638, 38, PAPER, LINE, 8, 1.2, '5 4')
    b += T(14, 128, tr('Kein Schritt braucht die Datenbank dieser App. Wer die Chain lesen kann, kann jeden Text prüfen.',
                       "No step needs this app's database. Whoever can read the chain can check every text."), 10.8, 500, INK2)
    return svg(640, 144, b, tr('Einen Text prüfen', 'Checking a text'))


# ---------------------------------------------------------------- filing
def fig_filing():
    w, g, h = 196, 25, 92
    row1 = [('pen', '1', tr('Schreiben', 'Write'), tr(['Markdown, Tabellen, Bilder,', 'Adressen mit Prüfsumme,', 'Vorschau wie für Wähler.'], ['Markdown, tables, images,', 'checksummed addresses,', 'a preview as voters see it.'])),
            ('file-search', '2', tr('Hochladen', 'Upload'), tr(['Typ aus den Bytes, Bild', 'neu kodiert, Metadaten', 'wie GPS entfernt.'], ['Type read from the bytes,', 'images re-encoded, GPS', 'and other metadata gone.'])),
            ('archive', '3', tr('Entwurf ablegen', 'Stage the draft'), tr(['JSON unter seinem Hash.', 'Jede Fassung bleibt,', 'nichts wird überschrieben.'], ['JSON under its hash.', 'Every version is kept,', 'nothing is overwritten.']))]
    row2 = [('wallet', '4', tr('Signieren', 'Sign'), tr(['Ein Stapel. Kautionen und', 'Gebühren stehen vorher', 'da, von der Chain gelesen.'], ['One batch. Deposits and', 'fees are shown first,', 'read from the chain.'])),
            ('hourglass', '5', tr('Finalisiert', 'Finalized'), tr(['Erfolg erst bei Finalität,', 'dann der Link zum', 'Referendum.'], ['Success only at finality,', 'then the link to the', 'referendum.'])),
            ('link', '6', tr('Verknüpfen', 'Link'), tr(['Der Server prüft Verweis,', 'Einreicher und Aufruf auf', 'der Chain.'], ['The server checks the link,', 'depositor and call on', 'chain.']))]
    b = ''
    for i, (icn, n, t, body) in enumerate(row1):
        b += box(i * (w + g), 0, w, h, icn, n, t, body)
    for i, (icn, n, t, body) in enumerate(row2):
        b += box(i * (w + g), 128, w, h, icn, n, t, body, 'ok' if i == 2 else 'n')
    for i in range(2):
        x = i * (w + g) + w
        b += arrow(x + 1, 46, x + g - 2, 46, IND, 'ai', None, 1.4)
        b += arrow(x + 1, 174, x + g - 2, 174, IND, 'ai', None, 1.4)
    b += path(f'M{2 * (w + g) + w / 2} {h + 1} L{2 * (w + g) + w / 2} 110 L{w / 2} 110 L{w / 2} 126', IND, 'ai', None, 1.4)
    b += box(0, 246, 638, 62, 'refresh-cw', '', tr('Erneut versuchen', 'Retry'),
             [tr('Ging die Statusmeldung verloren, findet die App das schon eingereichte Referendum und verknüpft es.',
                 'If the status updates were lost, the app finds the referendum it already filed and links it.')], 'warn')
    b += path(f'M{w / 2} {128 + h + 1} L{w / 2} 244', WARN7, 'aw', '4 3', 1.3)
    return svg(640, 310, b, tr('Einen Antrag einreichen', 'Filing a proposal'))


# ---------------------------------------------------------------- fellowship fast track
def fig_fasttrack():
    w, g = 146, 18
    steps = [('users', '1', tr('Fellowship', 'Fellowship'), tr(['Mitglieder stimmen', 'nach Rang gewichtet', 'über F#N ab.'], ['Members vote on', 'F#N, weighted', 'by rank.']), 'ind'),
             ('list-checks', '2', 'Whitelist', tr(['Der Aufruf steht', 'auf der Whitelist,', 'erkannt am Hash.'], ['The call is on', 'the whitelist,', 'known by its hash.']), 'ind'),
             ('vote', '3', tr('Öffentlich', 'Public'), tr(['Alle stimmen auf', 'dem Track', 'WhitelistedCaller.'], ['Everyone votes on', 'the track', 'WhitelistedCaller.']), 'teal'),
             ('circle-check', '4', tr('Ausführung', 'Dispatch'), tr(['Der Aufruf läuft', 'mit dem Recht', 'der Whitelist.'], ['The call runs', 'with the whitelist', 'origin.']), 'ok')]
    b = ''
    for i, (icn, n, t, body, tone) in enumerate(steps):
        b += box(i * (w + g), 0, w, 100, icn, n, t, body, tone)
    for i in range(3):
        x = i * (w + g) + w
        b += arrow(x + 1, 50, x + g - 2, 50, IND, 'ai', None, 1.4)
    b += path(f'M{w / 2} 102 L{w / 2} 118 L{2 * (w + g) + w / 2} 118 L{2 * (w + g) + w / 2} 102', TEAL7, None, None, 1.4)
    b += T((w / 2 + 2 * (w + g) + w / 2) / 2, 136, tr('verlinken einander über den Hash des Aufrufs', 'link each other by the call hash'), 10.8, 600, TEAL7, 'middle')
    b += box(0, 152, 638, 50, 'triangle-alert', '', tr('Vor Schritt 2', 'Before step 2'),
             [tr('warnt die öffentliche Seite: Die Ausführung würde mit CallIsNotWhitelisted scheitern.',
                 'the public page warns: dispatch would fail with CallIsNotWhitelisted.')], 'warn', lh=13)
    return svg(640, 204, b, tr('Der schnelle Weg', 'The fast track'))


# ---------------------------------------------------------------- layers
def fig_layers():
    b = T(0, 12, tr('Im Browser', 'In the browser'), 12.5, 600, IND7, fam=D)
    b += T(344, 12, tr('Auf dem Server', 'On the server'), 12.5, 600, MUTED, fam=D)
    lw = 296
    b += box(0, 22, lw, 56, 'monitor-smartphone', '', tr('Seiten und Komponenten', 'Pages and components'), [tr('zeigen an, lesen nur über Hooks', 'render, read only through hooks')], 'ind', lh=13)
    b += box(0, 96, lw, 56, 'refresh-cw', '', tr('Abfrage-Schicht', 'Query layer'), [tr('Caches, Hooks; nur useExtrinsic signiert', 'caches, hooks; only useExtrinsic signs')], 'ind', lh=13)
    b += box(0, 170, 142, 56, 'scroll-text', '', 'Governance', [tr('Pallets, EGOV1', 'pallets, EGOV1')], 'ind', lh=13)
    b += box(154, 170, 142, 56, 'wallet', '', 'Wallet', [tr('Verbinder, Signer', 'connectors, signer')], 'ind', lh=13)
    b += box(0, 244, lw, 56, 'network', '', 'Chain', [tr('Knoten, Adressen, Ereignisse; kennt sonst nichts', 'nodes, addresses, events; knows nothing else')], 'teal', lh=13)
    rx = 344
    b += box(rx, 22, lw, 56, 'shield-check', '', 'Proxy', [tr('fremde Herkunft, kaputte Pfade, Sperre', 'foreign origin, broken paths, gate')], 'n', lh=13)
    b += box(rx, 96, lw, 56, 'server', '', tr('API-Routen', 'API routes'), [tr('Eingabe, Sitzung, Eigentum, Limit', 'input, session, ownership, limit')], 'n', lh=13)
    b += box(rx, 170, lw, 56, 'database', '', tr('Datenbank und Dateien', 'Database and files'), [tr('Entwürfe, Profile, Kommentare', 'drafts, profiles, comments')], 'n', lh=13)
    b += box(rx, 244, lw, 56, 'flag', '', 'Moderation', [tr('Rollen, Prüfungen, Status', 'roles, checks, status')], 'n', lh=13)
    for x0 in (148,):
        b += arrow(x0, 79, x0, 94, IND, 'ai', None, 1.4)
    b += arrow(71, 153, 71, 168, IND, 'ai', None, 1.4) + arrow(225, 153, 225, 168, IND, 'ai', None, 1.4)
    b += arrow(71, 227, 71, 242, IND, 'ai', None, 1.4) + arrow(225, 227, 225, 242, IND, 'ai', None, 1.4)
    for y in (79, 153):
        b += arrow(rx + lw / 2, y, rx + lw / 2, y + 15, MUTED, 'a', None, 1.4)
    b += arrow(297, 124, 342, 124, MUTED, 'a', '4 3', 1.4) + T(320, 116, 'fetch', 10.5, 600, MUTED, 'middle', M)
    return svg(640, 302, b, tr('Die Schichten', 'The layers'))


# ---------------------------------------------------------------- moderation
def fig_moderation():
    b = box(0, 0, 186, 74, 'flag', '', tr('Meldung', 'Report'), tr(['von jedem, der', 'angemeldet ist'], ['from anyone who', 'is signed in']))
    b += box(0, 96, 186, 74, 'scan-search', '', tr('Automatische Prüfung', 'Automatic check'), tr(['optional, mit hartem', 'Tageslimit'], ['optional, with a hard', 'daily limit']), 'dash')
    b += box(226, 40, 176, 92, 'list-checks', '', tr('Warteschlange', 'Queue'), tr(['eine für Meldungen', 'und Prüfungen'], ['one for reports', 'and checks']), 'ind')
    b += box(442, 0, 198, 92, 'hand', '', tr('Entscheidung', 'Decision'), tr(['behalten, unscharf,', 'verbergen, zurück;', 'immer mit Grund'], ['keep, blur, hide,', 'restore; always', 'with a reason']))
    b += box(442, 110, 198, 60, 'scroll-text', '', tr('Öffentliches Protokoll', 'Public log'), [tr('ohne die Meldenden', 'without the reporters')], 'ok', lh=13)
    b += path('M186 37 C 206 37, 204 70, 224 70', IND, 'ai', None, 1.4)
    b += path('M186 133 C 206 133, 204 102, 224 102', MUTED, 'a', '4 3', 1.4)
    b += arrow(402, 70, 440, 46, IND, 'ai', None, 1.4)
    b += arrow(541, 93, 541, 108, OK, 'ag', None, 1.4)
    b += rect(0, 192, 640, 44, BAD50, '#FCA5A5', 8)
    b += ic('ban', 12, 205, 18, BAD7) + T(38, 219, tr('Nie berührt: Daten auf der Chain und das festgenagelte JSON. Moderation ändert nur, was die App zeigt.',
                                                     'Never touched: data on chain and the pinned JSON. Moderation only changes what the app shows.'), 10.8, 600, BAD7)
    return svg(640, 238, b, tr('Der Weg einer Meldung', 'The path of a report'))


# ---------------------------------------------------------------- mainnet EGOV1 strip
def fig_mainnet():
    state = ['n'] * 10 + ['ok', 'ed', 'ok', 'ok', 'ed', 'ed', 'ok', 'ok', 'ok', 'ed', 'ok']
    n = len(state)
    cw, g = 26, (640 - 21 * 26) / 20
    col = {'n': (PAPER, LINE), 'ok': (OK50, OK), 'ed': (IND100, IND), 'x': ('#FFFBEB', WARN)}
    b = T(0, 13, tr('Enjin Relaychain, die ersten 21 Referenden', 'Enjin Relaychain, the first 21 referenda'), 12.5, 600, INK, fam=D)
    for i, s in enumerate(state):
        x = i * (cw + g)
        f, st = col[s]
        b += rect(x, 26, cw, cw, f, st, 5, 1.6, '4 3' if s == 'x' else None)
        if s == 'ok':
            b += ic('check', x + 5, 31, 16, OK7, 2.4)
        if s == 'ed':
            b += ic('pen', x + 6, 32, 14, IND7, 2.2)
        b += T(x + cw / 2, 68, f'#{i}', 10, 500, MUTED, 'middle')
    leg = [('ok', tr('EGOV1-Eintrag, Hash passt (7)', 'EGOV1 record, hash matches (7)')),
           ('ed', tr('EGOV1-Eintrag, danach bearbeitet (4)', 'EGOV1 record, edited after filing (4)')),
           ('n', tr('ohne Verweis auf einen Text (10)', 'no link to a text (10)'))]
    for i, (s, t) in enumerate(leg):
        x = 0
        y = 90 + i * 22
        f, st = col[s]
        b += f'<rect x="{x}" y="{y}" width="14" height="14" rx="3" fill="{f}" stroke="{st}" stroke-width="1.4"/>' + T(x + 22, y + 11.5, t, 10.8, 500, INK2)
    return svg(640, 150, b, tr('EGOV1 auf dem Mainnet', 'EGOV1 on mainnet'))


# ---------------------------------------------------------------- commits chart
def fig_chart():
    data = [(tr('Jun', 'Jun'), 2, False), ('Jul', 6, False), ('Aug', 15, False), ('Sep', 60, False), (tr('Okt', 'Oct'), 87, False), ('Nov', 17, True)]
    x0, x1, y0, y1 = 70, 630, 26, 220
    sc = (y1 - y0) / 100
    b = ''
    for v in (0, 25, 50, 75, 100):
        y = y1 - v * sc
        b += f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{RULE if v else LINE}" stroke-width="{1 if v else 1.4}"/>'
        b += T(x0 - 10, y + 4, f'{v}', 11, 400, MUTED, 'end')
    b += f'<text transform="translate(16 {(y0 + y1) / 2}) rotate(-90)" style="{F};font-size:11px;font-weight:500" fill="{MUTED}" text-anchor="middle">{tr("Commits pro Monat", "Commits per month")}</text>'
    slot = (x1 - x0) / len(data)
    bw = 56
    for i, (m, v, part) in enumerate(data):
        cx = x0 + slot * i + slot / 2
        h = v * sc
        fill = 'url(#hatch)' if part else IND
        b += f'<rect x="{cx - bw / 2}" y="{y1 - h}" width="{bw}" height="{h}" fill="{fill}" stroke="{IND}" stroke-width="1"/>'
        b += T(cx, y1 - h - 8, f'{v}', 12, 600, INK, 'middle')
        b += T(cx, y1 + 18, m + (tr(' (bis 13.)', ' (to the 13th)') if part else ''), 11.5, 500, INK2, 'middle')
    return svg(640, 244, b, tr('Commits pro Monat', 'Commits per month'))


FIGS = dict(sources=fig_sources, fallback=fig_fallback, lifecycle=fig_lifecycle, support=fig_support,
            batch=fig_batch, verify=fig_verify, filing=fig_filing, fasttrack=fig_fasttrack, layers=fig_layers,
            moderation=fig_moderation, mainnet=fig_mainnet, chart=fig_chart)
