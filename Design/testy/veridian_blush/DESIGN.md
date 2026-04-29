# Design System Strategy: The Organic Workspace

## 1. Overview & Creative North Star
**Creative North Star: "The Living Greenhouse"**

This design system rejects the clinical, rigid constraints of traditional "EdTech" platforms in favor of an organic, editorial experience. We are not building a static repository of information; we are cultivating a vibrant, living workspace where students feel energized, not exhausted. 

The system moves beyond the "template" look by embracing **Asymmetric Vitality**. We leverage the tension between soft, rounded corners and high-end editorial typography. By utilizing overlapping layers and a "borderless" philosophy, we create a UI that feels like it was grown, not manufactured. We prioritize breathing room over information density, ensuring every interaction feels intentional and fresh.

---

## 2. Colors: Tonal Depth & Vitality
The palette is derived from the life cycle of a melon: the protective rind (`secondary`), the vibrant heart (`primary`), and the grounding seeds (`on-surface`).

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning or containment. Boundaries must be defined solely through background color shifts. 
- Use a `surface-container-low` section sitting on a `surface` background to define scope.
- Use `surface-container-highest` to draw immediate focus to a specific module without "boxing it in."

### Surface Hierarchy & Nesting
Treat the UI as physical layers of organic material.
- **Base Layer:** `surface` (#f6faf6) – The soft, breathable canvas.
- **Nesting:** Place a `surface-container-lowest` (#ffffff) card inside a `surface-container-low` (#f1f5f1) area to create a "lifted paper" effect. This creates depth through light logic rather than mechanical lines.

### The "Glass & Gradient" Rule
To escape the "flat" look, utilize **Glassmorphism** for floating elements (like navigation bars or modal overlays). Use a semi-transparent `surface` color with a `backdrop-blur` of 20px. 
- **Signature Textures:** Apply a linear gradient from `primary` (#ab323a) to `primary_container` (#ff7074) at a 135-degree angle for main Action Buttons or Progress Milestones to inject "soul" into the interface.

---

## 3. Typography: The Editorial Voice
We use **Plus Jakarta Sans** across the entire system. Its slightly rounded terminals offer the "friendliness" required for students, while its geometric precision maintains an "authoritative" educational tone.

*   **Display (lg, md, sm):** Used for heroic moments and high-score celebrations. These should be set with tight letter-spacing (-0.02em) to feel like a premium magazine header.
*   **Headline & Title:** Use `headline-lg` (2rem) for module titles. Use `title-md` (1.125rem) for card headings. These are the "wayfinders" of the app.
*   **Body (lg, md, sm):** Set in `on-surface-variant` (#584141) to reduce eye strain. The slight warmth in the grey ensures the text feels "integrated" with the melon-inspired palette.
*   **Labels:** Use `label-md` for micro-copy. Always uppercase with increased letter-spacing (+0.05em) for a sophisticated, modern touch.

---

## 4. Elevation & Depth: Tonal Layering
We achieve hierarchy through **Tonal Layering** rather than traditional structural shadows.

*   **The Layering Principle:** Stacking is our primary tool. A `surface-container-highest` element is perceived as "closer" to the user than a `surface` element.
*   **Ambient Shadows:** If a floating effect is required (e.g., a "Seed" FAB), use a custom shadow: `box-shadow: 0 12px 32px rgba(171, 50, 58, 0.08)`. This uses a tinted version of our `primary` color to mimic natural, ambient light.
*   **The "Ghost Border" Fallback:** If a boundary is strictly required for accessibility (e.g., in high-contrast modes), use `outline-variant` (#dfbfbe) at **15% opacity**. Never use 100% opaque borders.
*   **Soft Corners:** Follow the Roundedness Scale religiously. Use `xl` (3rem) for large containers and `md` (1.5rem) for standard cards to maintain the "soft rind" aesthetic.

---

## 5. Components: Organic Primitives

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`). Shape: `full` (pill). No border. White text.
- **Secondary:** `secondary_container` (#aef2c4) fill with `on_secondary_container` (#30704c) text. Use for "Next" or "Continue" actions.
- **Tertiary:** No fill. `primary` text. Use for "Skip" or "Cancel."

### Input Fields
- **Styling:** Use `surface_container_high` as the background fill. Corners at `sm` (0.5rem). 
- **Interaction:** On focus, the background shifts to `surface_container_lowest` with a 2px "Ghost Border" using `primary`.

### Cards & Lists
- **The "No-Divider" Rule:** Forbid 1px horizontal lines. Use 24px (from Spacing Scale) of vertical whitespace or a subtle background toggle between `surface-container-low` and `surface-container-lowest` to separate list items.
- **Visual Interest:** Cards should occasionally use "Seed Accents"—small, dark `on_surface` (#181d1a) geometric shapes in the corners—to reinforce the melon brand.

### Specialized App Components
- **The Fruit Meter:** A progress bar using a `secondary` (#296a46) track and a `primary` (#ab323a) indicator, mimicking a melon slice filling up.
- **Knowledge Pods:** Rounded `lg` containers for lesson previews, using `surface_bright` to stand out against the background.

---

## 6. Do's and Don'ts

### Do
- **DO** use generous whitespace. If a layout feels "full," remove an element.
- **DO** overlap elements. A card slightly overlapping a header creates a sophisticated, bespoke feel.
- **DO** use the "Seed" color (`on_surface`) sparingly for high-contrast accents like icons or bolded keywords.

### Don't
- **DON'T** use pure black (#000000) or pure grey. Every "neutral" must be tinted with melon greens or corals.
- **DON'T** use sharp 90-degree corners. This breaks the organic "Living Greenhouse" philosophy.
- **DON'T** use traditional Material Design drop shadows. They feel "stock" and "cheap." Stick to Tonal Layering and Ambient Shadows.