DebutDeploy brand assets
========================

STATIC (brand/)
  debutdeploy-mark-gradient.svg / -512.png   primary mark, light surfaces
  debutdeploy-mark-flat-blue.svg / -512.png  single-colour blue, print
  debutdeploy-mark-white.svg / -512.png      dark surfaces, video overlays
  debutdeploy-mark-black.svg                 near-black hexagon, white D
  debutdeploy-mark-mono-dark.svg             one-colour ink outline
  debutdeploy-lockup-horizontal.svg          PRIMARY LOGO (mark + wordmark)
  debutdeploy-lockup-white.svg               lockup for dark backgrounds
  debutdeploy-app-icon.svg / -1024.png       rounded tile, app stores
  debutdeploy-favicon.svg / -32.png          simplified, holds at 16px

ANIMATED (brand/animated/) — CSS inside the SVG, loops forever,
freezes automatically for prefers-reduced-motion. Works in <img>,
CSS background, and when opened directly in a browser.
  debutdeploy-mark-pulse-animated.svg     two hexagon rings pulsing outward
  debutdeploy-mark-trace-animated.svg     circuit traces drawing on, dots popping
  debutdeploy-lockup-animated.svg         pulse + wordmark reveal
  debutdeploy-mark-spinner-animated.svg   rotating dash ring, for build/loading states

COLOUR
  Accent        #2563EB      Ink        #0B0D12
  Accent hover  #1B4ED1      Body       #4D5661
  Accent tint   #EEF3FE      Muted      #8B939F
  Border        #E5E8EE      Surface    #F7F9FC
  Success       #15803D      Warning    #D97706
  Error         #DC2626      Info       #6F8BD6

TYPE
  Plus Jakarta Sans  400/500/600/700/800  headings 800, tracking -0.03em
  IBM Plex Mono      400/500/600          eyebrows, metrics, logs, prices

RULES
  Clear space = half the hexagon width on all sides.
  Below 24px use the favicon variant.
  Never write DDebutDeploy, DebutDepoly or Debut Deploy.
  Never place the gradient mark on the near-black surface — use the white mark.
