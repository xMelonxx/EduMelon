---
name: Veridian Midnight
colors:
  surface: '#0f1412'
  surface-dim: '#0f1412'
  surface-bright: '#353a38'
  surface-container-lowest: '#0a0f0d'
  surface-container-low: '#181d1a'
  surface-container: '#1c211e'
  surface-container-high: '#262b29'
  surface-container-highest: '#313633'
  on-surface: '#dfe4e0'
  on-surface-variant: '#bccabb'
  inverse-surface: '#dfe4e0'
  inverse-on-surface: '#2c322f'
  outline: '#869486'
  outline-variant: '#3d4a3e'
  surface-tint: '#4de082'
  primary: '#6bfb9a'
  on-primary: '#003919'
  primary-container: '#4ade80'
  on-primary-container: '#005e2d'
  inverse-primary: '#006d36'
  secondary: '#c1c8c3'
  on-secondary: '#2b322f'
  secondary-container: '#434b47'
  on-secondary-container: '#b3bab5'
  tertiary: '#ffd6d9'
  on-tertiary: '#67001f'
  tertiary-container: '#ffafb7'
  on-tertiary-container: '#97253c'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6dfe9c'
  primary-fixed-dim: '#4de082'
  on-primary-fixed: '#00210c'
  on-primary-fixed-variant: '#005227'
  secondary-fixed: '#dde4df'
  secondary-fixed-dim: '#c1c8c3'
  on-secondary-fixed: '#161d1a'
  on-secondary-fixed-variant: '#414845'
  tertiary-fixed: '#ffdadc'
  tertiary-fixed-dim: '#ffb2b9'
  on-tertiary-fixed: '#400010'
  on-tertiary-fixed-variant: '#891933'
  background: '#0f1412'
  on-background: '#dfe4e0'
  surface-variant: '#313633'
typography:
  h1:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  h2:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  h3:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  data-mono:
    fontFamily: monospace
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.0'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 24px
  gutter: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

This design system is built on a foundation of **Medical Minimalism** combined with **High-Contrast Precision**. It targets a professional audience within the scientific and medical research fields, prioritizing focus, clarity, and a sense of premium technical sophistication.

The aesthetic utilizes a "Deep Sea" layering approach—where the darkest tones provide the void, and vibrant accents provide the life-critical data. The personality is clinical yet modern, evoking the feeling of a high-end laboratory interface or a specialized medical diagnostic tool. By eschewing unnecessary decorative elements, the system ensures that complex medical data remains the protagonist.

## Colors

The palette is optimized for long-duration focus in low-light environments, reducing eye strain for researchers. 

- **Primary (Melon):** Used exclusively for high-priority actions, progress indicators, and successful data points. It provides the "pulse" of the application.
- **Surface (Emerald Dark):** Provides a subtle tonal shift from the true-black background, allowing for logical grouping of data cards and modules without needing heavy borders.
- **Error (Soft Rose):** Reserved for critical physiological alerts, failed data validation, or system warnings. 
- **Neutral (Midnight):** The absolute base layer, providing the necessary depth to make the primary melon accent appear self-illuminated.

## Typography

The typography system relies on a functional pairing of **Plus Jakarta Sans** for expressive, modern headers and **Inter** for legible, clinical body copy. 

For scientific readings and medical values, a monospaced font is introduced as an auxiliary token to ensure tabular data remains perfectly aligned. Weight is used strategically: bold weights for headers to command attention, and regular weights for body copy to ensure breathability within the dark UI. Letter spacing is slightly tightened on large headers for a more "designed" feel and widened on labels for maximum legibility at small scales.

## Layout & Spacing

The design system utilizes an **8px grid** with a **Fluid Grid** model for mobile and a **Fixed Grid** model (max-width: 1280px) for desktop workstations. 

Layouts should prioritize a single-column focal point for critical data entry, with side panels or secondary columns used for historical data or meta-information. Spacing is generous—medical information requires room to "breathe" to avoid user cognitive overload. All containers and interactive zones must adhere to the 24px internal padding rule to maintain the system's expansive, premium feel.

## Elevation & Depth

This design system avoids traditional drop shadows in favor of **Tonal Layering** and **Subtle Outlines**. 

Depth is established by "lifting" elements through color:
1. **Level 0 (Base):** #0A0F0D (Deep Midnight)
2. **Level 1 (Cards/Surfaces):** #141B18 (Dark Emerald)
3. **Level 2 (Overlays/Modals):** #1C2622 (Lightened Emerald)

To reinforce the medical feel, use high-contrast borders (1px width) in a slightly lighter emerald (#212C28) for card boundaries. No blurs are used; the focus is on sharp, clean transitions between surfaces to mimic the precision of surgical equipment.

## Shapes

The shape language features a high-contrast juxtaposition between structural cards and organic controls. 

- **Cards:** Utilize a significant 24px corner radius to soften the technical data and provide a "friendly-scientific" container.
- **Interactive Elements:** Buttons and tags use a full "pill" radius. This ensures they are immediately recognizable as touch-targets and provides a distinct visual contrast against the large, structured cards.
- **Inputs:** Use a medium 12px radius to strike a balance between the card's softness and the button's fluidity.

## Components

- **Buttons:** Primary buttons are filled with #4ADE80 and use black text (#0A0F0D) for maximum contrast. Secondary buttons are outlined with #4ADE80 and no fill.
- **Cards:** Use #141B18 background with 24px radius. Content within cards should follow the 24px padding rule.
- **Inputs:** Ghost-style inputs with a #212C28 border. On focus, the border transitions to #4ADE80. Labels are always positioned above the field in `label-caps`.
- **Chips/Status Tags:** Fully rounded (pill). Use a subtle background tint of the status color (e.g., 10% opacity Primary) with a 100% opacity text for high legibility.
- **Data Visualizations:** Use the Primary Melon for "Healthy/Active" ranges and Soft Rose for "Critical/Out-of-bounds" ranges. Grid lines in charts should be kept at extremely low opacity (#FFFFFF at 5%).
- **Lists:** Clean rows separated by a 1px border (#212C28) with no background, allowing the Surface Emerald to show through.