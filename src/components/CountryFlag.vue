<script setup>
import { computed } from 'vue'

// Inline SVG country flags — drawn from official national flag specs (public domain).
// Simplified shapes for compactness at small sizes (16-24px). Pass `code` as ISO-3166 alpha-2.
const props = defineProps({
  code: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
  rounded: { type: Boolean, default: true }
})

const normalized = computed(() => String(props.code || '').toUpperCase())
const sizeNum = computed(() => {
  if (typeof props.size === 'number') return props.size
  const n = parseFloat(String(props.size))
  return Number.isFinite(n) ? n : 20
})
const wrapStyle = computed(() => ({
  width: `${sizeNum.value}px`,
  height: `${Math.round(sizeNum.value * 2 / 3)}px`,
  borderRadius: props.rounded ? '3px' : '0',
  display: 'inline-block',
  overflow: 'hidden',
  verticalAlign: '-2px',
  boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
  flex: 'none',
  lineHeight: 0
}))
</script>

<template>
  <span class="country-flag" :style="wrapStyle" :title="normalized">
    <!-- Vietnam: red field, yellow 5-point star center -->
    <svg v-if="normalized === 'VN'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="20" fill="#da251d" />
      <polygon points="15,5 16.18,8.64 20,8.64 16.91,10.89 18.09,14.53 15,12.28 11.91,14.53 13.09,10.89 10,8.64 13.82,8.64" fill="#ffff00" />
    </svg>

    <!-- United States: simplified stripes + blue canton -->
    <svg v-else-if="normalized === 'US'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="20" fill="#bf0a30" />
      <rect y="1.54" width="30" height="1.54" fill="#fff" />
      <rect y="4.62" width="30" height="1.54" fill="#fff" />
      <rect y="7.69" width="30" height="1.54" fill="#fff" />
      <rect y="10.77" width="30" height="1.54" fill="#fff" />
      <rect y="13.85" width="30" height="1.54" fill="#fff" />
      <rect y="16.92" width="30" height="1.54" fill="#fff" />
      <rect width="12" height="10.77" fill="#002868" />
      <g fill="#fff">
        <circle cx="2" cy="2" r="0.5" /><circle cx="4" cy="2" r="0.5" /><circle cx="6" cy="2" r="0.5" /><circle cx="8" cy="2" r="0.5" /><circle cx="10" cy="2" r="0.5" />
        <circle cx="3" cy="3.6" r="0.5" /><circle cx="5" cy="3.6" r="0.5" /><circle cx="7" cy="3.6" r="0.5" /><circle cx="9" cy="3.6" r="0.5" />
        <circle cx="2" cy="5.2" r="0.5" /><circle cx="4" cy="5.2" r="0.5" /><circle cx="6" cy="5.2" r="0.5" /><circle cx="8" cy="5.2" r="0.5" /><circle cx="10" cy="5.2" r="0.5" />
        <circle cx="3" cy="6.8" r="0.5" /><circle cx="5" cy="6.8" r="0.5" /><circle cx="7" cy="6.8" r="0.5" /><circle cx="9" cy="6.8" r="0.5" />
        <circle cx="2" cy="8.4" r="0.5" /><circle cx="4" cy="8.4" r="0.5" /><circle cx="6" cy="8.4" r="0.5" /><circle cx="8" cy="8.4" r="0.5" /><circle cx="10" cy="8.4" r="0.5" />
      </g>
    </svg>

    <!-- United Kingdom: Union Jack -->
    <svg v-else-if="normalized === 'GB' || normalized === 'UK'" viewBox="0 0 60 30" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#c8102e" stroke-width="2" />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" stroke-width="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#c8102e" stroke-width="6" />
    </svg>

    <!-- Germany: 3 horizontal stripes black/red/gold -->
    <svg v-else-if="normalized === 'DE'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect y="0" width="30" height="6.67" fill="#000" />
      <rect y="6.67" width="30" height="6.67" fill="#dd0000" />
      <rect y="13.33" width="30" height="6.67" fill="#ffce00" />
    </svg>

    <!-- Japan: white + red circle center -->
    <svg v-else-if="normalized === 'JP'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="20" fill="#fff" />
      <circle cx="15" cy="10" r="6" fill="#bc002d" />
    </svg>

    <!-- France: 3 vertical stripes -->
    <svg v-else-if="normalized === 'FR'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect x="0" width="10" height="20" fill="#0055a4" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ef4135" />
    </svg>

    <!-- South Korea: white + taegeuk + trigrams (simplified) -->
    <svg v-else-if="normalized === 'KR'" viewBox="0 0 60 40" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="60" height="40" fill="#fff" />
      <circle cx="30" cy="20" r="8" fill="#cd2e3a" />
      <path d="M30,12 A4,4 0 0,1 30,20 A4,4 0 0,0 30,28 A8,8 0 0,1 30,12" fill="#0047a0" />
      <g fill="#000">
        <rect x="10" y="8" width="6" height="1.5" /><rect x="10" y="11" width="6" height="1.5" /><rect x="10" y="14" width="6" height="1.5" />
        <rect x="44" y="8" width="6" height="1.5" /><rect x="44" y="11" width="2.5" height="1.5" /><rect x="47.5" y="11" width="2.5" height="1.5" /><rect x="44" y="14" width="6" height="1.5" />
        <rect x="10" y="25" width="2.5" height="1.5" /><rect x="13.5" y="25" width="2.5" height="1.5" /><rect x="10" y="28" width="6" height="1.5" /><rect x="10" y="31" width="2.5" height="1.5" /><rect x="13.5" y="31" width="2.5" height="1.5" />
        <rect x="44" y="25" width="2.5" height="1.5" /><rect x="47.5" y="25" width="2.5" height="1.5" /><rect x="44" y="28" width="2.5" height="1.5" /><rect x="47.5" y="28" width="2.5" height="1.5" /><rect x="44" y="31" width="2.5" height="1.5" /><rect x="47.5" y="31" width="2.5" height="1.5" />
      </g>
    </svg>

    <!-- Singapore: red/white + crescent + 5 stars -->
    <svg v-else-if="normalized === 'SG'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="10" fill="#ed2939" />
      <rect y="10" width="30" height="10" fill="#fff" />
      <circle cx="7" cy="5" r="3" fill="#fff" />
      <circle cx="8.2" cy="5" r="2.5" fill="#ed2939" />
      <g fill="#fff" transform="translate(11,2)">
        <polygon points="1,2 1.3,2.8 2.2,2.8 1.45,3.4 1.75,4.2 1,3.7 0.25,4.2 0.55,3.4 -0.2,2.8 0.7,2.8" />
        <polygon points="4,1.5 4.3,2.3 5.2,2.3 4.45,2.9 4.75,3.7 4,3.2 3.25,3.7 3.55,2.9 2.8,2.3 3.7,2.3" />
        <polygon points="7,2 7.3,2.8 8.2,2.8 7.45,3.4 7.75,4.2 7,3.7 6.25,4.2 6.55,3.4 5.8,2.8 6.7,2.8" />
        <polygon points="2.5,4 2.8,4.8 3.7,4.8 2.95,5.4 3.25,6.2 2.5,5.7 1.75,6.2 2.05,5.4 1.3,4.8 2.2,4.8" />
        <polygon points="5.5,4 5.8,4.8 6.7,4.8 5.95,5.4 6.25,6.2 5.5,5.7 4.75,6.2 5.05,5.4 4.3,4.8 5.2,4.8" />
      </g>
    </svg>

    <!-- Hong Kong: red + bauhinia (simplified to white circle + flower silhouette) -->
    <svg v-else-if="normalized === 'HK'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="20" fill="#de2910" />
      <g transform="translate(15,10)" fill="#fff">
        <circle cx="0" cy="-3.5" r="1.3" />
        <circle cx="3.3" cy="-1" r="1.3" />
        <circle cx="2" cy="3" r="1.3" />
        <circle cx="-2" cy="3" r="1.3" />
        <circle cx="-3.3" cy="-1" r="1.3" />
        <circle cx="0" cy="0" r="1" fill="#de2910" />
      </g>
    </svg>

    <!-- China: red + 5 gold stars -->
    <svg v-else-if="normalized === 'CN'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="20" fill="#de2910" />
      <g fill="#ffde00">
        <polygon points="6,4 6.6,5.9 8.5,5.9 7,7 7.6,8.9 6,7.8 4.4,8.9 5,7 3.5,5.9 5.4,5.9" />
        <polygon points="12,2.5 12.2,3.1 12.9,3.1 12.35,3.5 12.55,4.1 12,3.7 11.45,4.1 11.65,3.5 11.1,3.1 11.8,3.1" />
        <polygon points="13.5,5 13.7,5.6 14.4,5.6 13.85,6 14.05,6.6 13.5,6.2 12.95,6.6 13.15,6 12.6,5.6 13.3,5.6" />
        <polygon points="13.5,8.5 13.7,9.1 14.4,9.1 13.85,9.5 14.05,10.1 13.5,9.7 12.95,10.1 13.15,9.5 12.6,9.1 13.3,9.1" />
        <polygon points="12,11 12.2,11.6 12.9,11.6 12.35,12 12.55,12.6 12,12.2 11.45,12.6 11.65,12 11.1,11.6 11.8,11.6" />
      </g>
    </svg>

    <!-- India: 3 horizontal stripes saffron/white/green + wheel -->
    <svg v-else-if="normalized === 'IN'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect y="0" width="30" height="6.67" fill="#ff9933" />
      <rect y="6.67" width="30" height="6.67" fill="#fff" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.5" fill="none" stroke="#000080" stroke-width="0.6" />
      <circle cx="15" cy="10" r="0.6" fill="#000080" />
    </svg>

    <!-- Australia: blue + Union Jack canton + stars (simplified) -->
    <svg v-else-if="normalized === 'AU'" viewBox="0 0 60 30" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="60" height="30" fill="#012169" />
      <g transform="scale(0.5)">
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6" />
        <path d="M30,0 V30 M0,15 H60" stroke="#fff" stroke-width="10" />
        <path d="M30,0 V30 M0,15 H60" stroke="#c8102e" stroke-width="6" />
      </g>
      <g fill="#fff">
        <polygon points="45,7 45.7,9 47.8,9 46.1,10.2 46.8,12.2 45,11 43.2,12.2 43.9,10.2 42.2,9 44.3,9" />
        <polygon points="50,15 50.5,16.5 52,16.5 50.75,17.4 51.25,18.9 50,18 48.75,18.9 49.25,17.4 48,16.5 49.5,16.5" />
        <polygon points="40,20 40.5,21.5 42,21.5 40.75,22.4 41.25,23.9 40,23 38.75,23.9 39.25,22.4 38,21.5 39.5,21.5" />
        <polygon points="50,24 50.5,25.5 52,25.5 50.75,26.4 51.25,27.9 50,27 48.75,27.9 49.25,26.4 48,25.5 49.5,25.5" />
        <polygon points="15,18 15.7,20 17.8,20 16.1,21.2 16.8,23.2 15,22 13.2,23.2 13.9,21.2 12.2,20 14.3,20" />
      </g>
    </svg>

    <!-- Canada: red bars + white square + maple leaf (simplified) -->
    <svg v-else-if="normalized === 'CA'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="7.5" height="20" fill="#d52b1e" />
      <rect x="7.5" width="15" height="20" fill="#fff" />
      <rect x="22.5" width="7.5" height="20" fill="#d52b1e" />
      <path d="M15,5 L15.7,8 L18,7.5 L17,9.5 L19,11 L17,11.5 L17.5,14 L15.5,12.5 L15,15 L14.5,12.5 L12.5,14 L13,11.5 L11,11 L13,9.5 L12,7.5 L14.3,8 Z" fill="#d52b1e" />
    </svg>

    <!-- Russia: 3 horizontal stripes white/blue/red -->
    <svg v-else-if="normalized === 'RU'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect y="0" width="30" height="6.67" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039a6" />
      <rect y="13.33" width="30" height="6.67" fill="#d52b1e" />
    </svg>

    <!-- Brazil: green + yellow diamond + blue circle (simplified) -->
    <svg v-else-if="normalized === 'BR'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="20" fill="#009c3b" />
      <polygon points="15,3 27,10 15,17 3,10" fill="#ffdf00" />
      <circle cx="15" cy="10" r="3.8" fill="#002776" />
    </svg>

    <!-- Thailand: 5 horizontal stripes red/white/blue/white/red -->
    <svg v-else-if="normalized === 'TH'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect y="0" width="30" height="3.33" fill="#ed1c24" />
      <rect y="3.33" width="30" height="3.33" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#241d4f" />
      <rect y="13.33" width="30" height="3.33" fill="#fff" />
      <rect y="16.67" width="30" height="3.33" fill="#ed1c24" />
    </svg>

    <!-- Indonesia: red/white horizontal -->
    <svg v-else-if="normalized === 'ID'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect y="0" width="30" height="10" fill="#ce1126" />
      <rect y="10" width="30" height="10" fill="#fff" />
    </svg>

    <!-- Philippines: blue/red horizontal + white triangle -->
    <svg v-else-if="normalized === 'PH'" viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect y="0" width="30" height="10" fill="#0038a8" />
      <rect y="10" width="30" height="10" fill="#ce1126" />
      <polygon points="0,0 0,20 12,10" fill="#fff" />
      <polygon points="3,9.4 3.3,10 3,10.6 3.6,10.3 4.2,10.6 3.9,10 4.2,9.4 3.6,9.7" fill="#fcd116" />
    </svg>

    <!-- Fallback: globe icon -->
    <svg v-else viewBox="0 0 30 20" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="30" height="20" fill="#2a3142" />
      <text x="15" y="14" font-size="9" font-family="ui-monospace, monospace" font-weight="700" fill="#7d8590" text-anchor="middle">{{ normalized || '?' }}</text>
    </svg>
  </span>
</template>
