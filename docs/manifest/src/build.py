import re, os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import figs
lang = sys.argv[1]
figs.LANG = lang
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
src = open(os.path.join(HERE, f'content.{lang}.html')).read()
# The Enjin mark (public/brand/enjin-mark.svg in the repository), drawn inline.
MARK_SVG = ('<path d="M0 256C0 114.615 114.615 0 256 0C397.385 0 512 114.615 512 256C512 397.385 397.385 512 256 512C114.615 512 0 397.385 0 256Z" fill="#7866D5"/>'
            '<path d="M232 116C136 116 96 157.017 96 212L96 300C96 354.983 136 396 232 396L325 396C412 396 416 385.501 416 368C416 348.001 408 340 388 340L232 340C184 340 160 316.055 160 292L160 284L388 284C404 284 416 273.5 416 256C416 238.5 404 228 388 228L160 228L160 220C160 195.945 184 172 232 172L388 172C408 172 416 163.999 416 144C416 126.499 412 116 325 116L232 116Z" fill="#fff"/>')
def logo(px):
    return f'<svg class="logo" width="{px}" height="{px}" viewBox="0 0 512 512" aria-hidden="true">{MARK_SVG}</svg>'
def fig(m):
    name, num, cap = m.group(1), m.group(2), m.group(3)
    w = re.search(r'\|w=(\d+)$', cap)  # optional |w=NN: draw the figure at NN% width (page fit)
    cap = cap[:w.start()] if w else cap
    style = f' style="width:{w.group(1)}%;margin-left:auto;margin-right:auto"' if w else ''
    return f'<figure class="fig fig-{name}"><div{style}>{figs.FIGS[name]()}</div><figcaption><b>{num}</b> {cap}</figcaption></figure>'
src = re.sub(r'\{\{FIG:(\w+)\|([^|]+)\|(.*?)\}\}', fig, src, flags=re.S)
LABELS = {
    'list': ('Referenden, ohne Wallet lesbar', 'Referenda, readable without a wallet'),
    'proposal': ('Ein Referendum auf dem Mainnet', 'A referendum on mainnet'),
    'text': ('Antragstext, EGOV1 geprüft', 'Proposal text, EGOV1 verified'),
    'vote': ('Abstain, Test-Wallet ohne Guthaben', 'Abstain, test wallet with no balance'),
    'fellowship': ('Die Fellowship', 'The Fellowship'),
    'moderation': ('Moderation: eine Warteschlange', 'Moderation: one queue'),
    'create': ('Treasury-Antrag, Schritt 1', 'Treasury proposal, step 1'),
    'treasury': ('Treasury', 'Treasury'),
}
import base64
def phones(m):
    names, cap = m.group(1).split(','), m.group(2)
    cells = []
    for n in names:
        b64 = base64.b64encode(open(os.path.join(HERE, 'screens', n + '.jpg'), 'rb').read()).decode()
        label = LABELS[n][0 if lang == 'de' else 1]
        cells.append(f'<div class="phone"><img src="data:image/jpeg;base64,{b64}" alt="{label}"><span>{label}</span></div>')
    return f'<figure class="fig phones">{"".join(cells)}<figcaption>{cap}</figcaption></figure>'
def phone(m):
    n = m.group(1)
    b64 = base64.b64encode(open(os.path.join(HERE, 'screens', n + '.jpg'), 'rb').read()).decode()
    label = LABELS[n][0 if lang == 'de' else 1]
    return f'<figure class="pfloat"><img src="data:image/jpeg;base64,{b64}" alt="{label}"><figcaption>{label}</figcaption></figure>'
src = re.sub(r'\{\{PHONE:(\w+)\}\}', phone, src)
src = re.sub(r'\{\{PHONES:([\w,]+)\|(.*?)\}\}', phones, src, flags=re.S)
src = re.sub(r'\{\{SVG:(\w+)\}\}', lambda m: figs.FIGS[m.group(1)](), src)
src = re.sub(r'\{\{I:([\w-]+)\}\}', lambda m: figs.ih(m.group(1)), src)
src = re.sub(r'\{\{LOGO:(\d+)\}\}', lambda m: logo(int(m.group(1))), src)
tocp = os.path.join(HERE, f'toc.{lang}.json')
toc = json.load(open(tocp)) if os.path.exists(tocp) else {}
src = re.sub(r'<li><span>([^<]+)</span><b>(\d+)</b></li>', lambda m: f'<li><span>{m.group(1)}</span><b>{toc.get(m.group(1), m.group(2))}</b></li>', src)
foot = 'Enjin Governance · Manifest · November 2026' if lang == 'de' else 'Enjin Governance · Manifesto · November 2026'
title = 'Enjin Governance: Manifest' if lang == 'de' else 'Enjin Governance: Manifesto'
CSS = open(os.path.join(HERE, 'style.css')).read().replace('__FOOT__', foot)
# Static fonts embedded locally (OFL, from the @fontsource packages): a static TrueType face embeds in the
# PDF as TrueType, where the Google variable fonts came out as Type 3.
FONT_FACES = [('Inter', 'inter', (400, 500, 600, 700)), ('Space Grotesk', 'space-grotesk', (500, 600, 700)),
              ('JetBrains Mono', 'jetbrains-mono', (400, 600))]
FONTS = ''.join(
    f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{wt};font-display:block;"
    f"src:url(data:font/woff2;base64,{base64.b64encode(open(os.path.join(HERE, 'fonts', f'{slug}-latin-{wt}-normal.woff2'), 'rb').read()).decode()}) format('woff2')}}"
    for fam, slug, wts in FONT_FACES for wt in wts)
html = f'''<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{FONTS}{CSS}</style></head><body>{src}</body></html>'''
assert '\u2014' not in html, 'em dash found'
assert '{{' not in html, re.findall(r'\{\{.{0,30}', html)
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, f'enjin-governance-manifest-{lang}.html'), 'w').write(html)
print('ok', lang, len(html))
