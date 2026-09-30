# Voreve.ai landing page

One 3D phone travels through one call: **Call → Listen → Understand → Think → Act → Result**.
Dependency-free static site (HTML / CSS / JS, no build). Open `index.html` or serve the folder (`python3 -m http.server`).
Languages: **English and Lithuanian** (switch in the nav; remembered in the browser; `?lang=lt` forces one).

## Files
- `index.html`: markup. Text elements carry `data-t="key"`; attributes use `data-t-attr="aria-label:key"`.
- `i18n.js`: all copy in `en` and `lt`. To add a language, copy the `en` block and translate it.
- `styles.css`: design tokens at the top; phone/screen, scenes, sections, mobile.
- `app.js`: one rAF loop (scroll to phone pose and screen state), plus the section interactions.
- `config.js`: booking URL, contact email, form endpoint (empty until they exist).
- `BRIEF.md`: the design brief (feeling curve, peak, signature move).

## How it works
- **The phone** is CSS 3D: stacked slabs for thickness and a live HTML screen (crisp at any size).
- **Scroll drives the story.** `timeline(x)` turns scroll into `--p1…--p5` on the screen; `POSES_D` / `POSES_M` place the phone.
- **One dark theme** for the whole page (orange is an accent only).
- **The phone never leaves.** Value: rests on the left. Founders: it turns landscape (`rotateZ -90`) into the slot
  `#aboutPhone` and its screen shows the founders (a `.u-found` layer drawn pre-rotated 90deg so it exactly fills the screen
  and turns with the phone, like a real landscape app; names are clickable). Contact: it turns upright again and flies to `#demoPhone`.
  The slots are live targets measured each frame, so the phone follows the page layout.
- **Interactive sections** (each its own device): day scrubber with falling calls (`#day`), the founders' landscape
  screen, and the contact section, where the phone sits beside you: slide the handset (`#answer`) and the
  phone answers too, then plays the start of the call (`ctaX` in `app.js`).
- **Reduced motion / landscape phones:** no animation loop; each story state gets its own static 3D phone.
- **Mobile:** same story, phone above and copy below (during the value list it steps out of the way, then rises
  from below into the landscape founders slot); the rail becomes a bottom bar with Book a Demo.

## Configure (config.js)
- `BOOKING_URL`: calendar link, embedded in the final CTA panel.
- `CONTACT_EMAIL`: enables email links, the copy button, and the form's mailto fallback.
- `FORM_ENDPOINT`: optional form backend; the demo form POSTs JSON here (includes the visitor's language).
