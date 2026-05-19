# ProxyBox design system — "security hacker / NetOps console" style

Visual reference: Portmaster SPN, Wireshark, Cloudflare Zero Trust, btop, Bitwarden vault.
Goal: dark technical console — dense info, monospace data, vivid status, minimal chrome.

## 1. Tokens

```css
:root {
  /* surface */
  --bg:        #0a0e14;   /* near-black blue (background)              */
  --surface:   #11161d;   /* card surface (slightly lighter)            */
  --surface-2: #161c25;   /* nested surface / inputs                    */
  --raised:    #1c232e;   /* hover / active raised card                 */
  --border:    #232a36;   /* faint border between surfaces              */
  --border-soft: #1a2029; /* even fainter divider inside cards          */

  /* text */
  --text:      #e6edf3;   /* primary text (off-white)                   */
  --muted:     #7d8590;   /* labels, metadata                           */
  --dim:       #545d68;   /* tertiary / inactive                        */

  /* signal colors (status / accent) — vivid, near-CRT */
  --green:     #3fb950;   /* secure / active / pass                     */
  --green-soft:#0e2e1a;   /* tinted bg behind green text                */
  --red:       #f85149;   /* error / blocked / danger                   */
  --red-soft:  #2e0e10;
  --yellow:    #d29922;   /* warn / expiring / grace                    */
  --yellow-soft:#2b2410;
  --blue:      #58a6ff;   /* info / link / customer                     */
  --blue-soft: #0d1e30;
  --cyan:      #39d0d8;   /* IPv6 / encrypted / monitor                 */
  --magenta:   #d2a8ff;   /* admin / role                               */

  /* radius + shadow */
  --radius:    8px;
  --radius-sm: 6px;
  --shadow:    0 1px 0 rgba(255,255,255,0.02) inset, 0 1px 2px rgba(0,0,0,0.3);

  /* fonts */
  --mono: 'JetBrains Mono', 'Fira Code', ui-monospace, 'SF Mono', Menlo, monospace;
  --sans: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
}
```

## 2. Typography

| Use case | Font | Size | Weight | Letter-spacing |
|----------|------|------|--------|----------------|
| Page title `<h1>` | sans | 18px | 600 | -0.01em |
| Section `<h2>` | sans | 14px | 600 | normal |
| Body | sans | 13px | 400 | normal |
| Eyebrow / label | sans | 10.5px | 600 | 0.08em UPPERCASE |
| **IP / port / hash / hostname / id / cmd** | **mono** | **12.5px** | 400 | 0 |
| Metric value | sans | 22px | 600 | -0.02em |
| Code block | mono | 12px | 400 | 0 |

**Rule**: ANY technical string (IP, port, MAC, hash, hostname, proxy id, order id, file path, command) MUST be `.cell-mono` / `<code>`. Plain English labels stay sans.

## 3. Status pill palette

Compact, rounded-full, 11px uppercase, bold colored text on tinted background.

```
active   green text + green-soft bg + green dot
online   same as active
pending  yellow text + yellow-soft bg
warning  yellow same
grace    yellow with pulse animation (about to expire)
expired  dim + line-through
error    red + red-soft + red dot pulse
failed   same as error
suspended red striped
disabled dim
node-down red striped
```

Dot indicator pulses when status is in active/error state — 1.5s ease-in-out infinite.

## 4. Layout primitives

### Sidebar
- Width 220px expanded, 56px collapsed (icon-only)
- `bg: var(--bg)`, no border, divider only via `--border` after each group
- Group label: 9.5px uppercase muted, padding 12px 14px 4px
- Item: 7px 12px padding, 13px sans, icon 16px
- Item active: `bg: var(--surface)` + left border 2px green + bold text
- Item hover: `bg: var(--surface)` + text-color lift

### Topbar
- Height 48px, `bg: var(--bg)`, border-bottom `--border`
- Left: breadcrumb (eyebrow + h1)
- Right: 1-line metric strip ("CPU 12% · RAM 41% · Net 12 Mbps · Conns 234") + lang toggle

### Card / Surface
- `bg: var(--surface)`, `border: 1px solid var(--border)`, `--radius`
- Section head: 12px padding, h2 + status pill right-aligned
- Inner padding 14px

### Data table
- Header row: `bg: var(--surface-2)`, 11px uppercase muted
- Body row: 8px 12px padding, hover `bg: var(--raised)`
- Mono cells default; sans for label cells

### Code/credential box
- `bg: var(--surface-2)`, `border: 1px solid var(--border)`
- Mono 12.5px, padding 9px 12px, copy button right
- Long strings: `word-break: break-all`

### Metric card
- 14px padding, surface bg
- Label: eyebrow style
- Value: 22px bold sans (sometimes mono if it's a count like ASN/IP)
- Optional foot: 11px muted

### Sparkline / chart
- Stroke: `var(--green)` for in, `var(--red)` for out, 1.5px
- Fill below: gradient from accent at 30% opacity → transparent
- No grid lines; mute only at peak label

## 5. Specific patterns from the reference

### Connection row (Portmaster-style)
```
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
●  cache2-fra2.steamcontent.com   DE  ↗ 155.133.226.18:443  TCP  ended 3m ago
```
- Left: status dot (green/red/yellow)
- Sans hostname → mono IP + port
- Country flag inline (DE, US, VN…)
- Action label "ended", "active", "blocked" muted right

### Action button strip
- Ghost-style: transparent bg, `--border` outline, hover `--surface-2`
- Primary action: solid `--green` bg + black text + bold + glow shadow

### Toggle (Use SPN, Block Connections)
- Pill switch, 36×20px
- On: `--green` bg + checkmark
- Off: `--surface-2` bg + dim

## 6. Density rules

- Card padding: 14px (was 18-20px in light theme)
- Row padding: 8px vertical (was 12px)
- Gap between cards: 10px (was 14px)
- Page padding: 18px
- Always show all info; don't truncate IPs/hashes with ellipsis — wrap mono.

## 7. Iconography

- Lucide icons, 16-18px, stroke-width 1.5
- Color: inherit from text — never colored except status dots
- Allowed accent icons: lock (encrypted), shield (secure), zap (rotate), eye-off (private)

## 8. Animation budget

- Status dot pulse: opacity 0.4↔1.0, 1.5s
- Card hover: `transform: translateY(-1px)` 120ms
- Status change: 200ms color crossfade
- Modal/dialog: NOT used — everything inline
- No spinners; use "..." text or skeleton row

## 9. Don't

- No light backgrounds anywhere (no `#fff`, no `#f8fafc`)
- No emoji except country flags in connection rows
- No rounded-full buttons (only rounded-md, 6-8px)
- No blue/purple gradients — flat colors only
- No "Material" shadows — single subtle inset shadow only
- No serif fonts ever

## 10. Required font import

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Or self-host in `/dist/assets/fonts/` — but CSP must allow.
