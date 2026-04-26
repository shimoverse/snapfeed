# Designer / PM quickstart — using the widget

**Persona:** Designer, PM, QA, or anyone giving feedback during dogfooding. You're a *consumer* of the widget, not the person who installed it.
**Goal:** Know how to file useful feedback in 30 seconds without learning a ticketing tool.
**Time budget:** 2 minutes to read this. The widget itself is built to take seconds per piece of feedback.
**snapfeed version:** v0.4.0

---

## How to open the widget

Press **Ctrl+Shift+F** anywhere in the app you're testing. On macOS, **Cmd+Shift+F** also works — the widget listens for both.

If your team set a different hotkey, check with whoever installed snapfeed (or look for a small floating button in the bottom-right corner — that's the widget's trigger button).

## What you see when it opens

A small overlay appears with:

- A textarea (cursor already focused, just start typing)
- A category dropdown — Bug / Idea / Question / Praise / Other (optional, leave blank if unsure)
- A screenshot thumbnail of the page (auto-captured if your team enabled `autoScreenshot`)
- A Send button

## How to file feedback in 5 steps

1. **Type what happened.** Aim for one sentence. Include what you were trying to do and what went wrong.
2. **(Optional) Pick a category.** Bug / Idea / Question / Praise / Other. Helps the team triage. Skip it if you're unsure.
3. **(Optional) Annotate the screenshot.** Click the screenshot thumbnail to open the annotation tools: pen, rectangle, arrow, highlighter, undo. A red arrow on the broken control beats a paragraph of "the third button from the left."
4. **(Optional) Paste another image.** Cmd+V (Ctrl+V on Windows) inside the widget pastes from clipboard — useful when you have a Figma screenshot or a comparison image already copied.
5. **Click Send.**

You'll see "Sent" briefly. The overlay closes. You're done.

## Optional features (if your team enabled them in v0.4)

These appear as extra icons in the widget when enabled. They aren't on by default — check with whoever installed snapfeed if you don't see them.

- **Voice note.** Click the mic icon, talk, click stop. Useful when typing would slow you down or when you want to capture a tone of voice. Browser will ask for microphone permission the first time.
- **Screen recording.** Click the screen icon, the browser asks which window/tab to share, recording starts. Click stop to attach. Default cap is 30 seconds. Useful when the bug only shows up mid-interaction.

## Keyboard shortcuts inside the widget

- **Esc** — close the widget without sending.
- **Cmd+V** / **Ctrl+V** — paste an image from clipboard into the screenshot slot.

## What happens after you click Send

The feedback flows to wherever your team configured snapfeed — typically Slack and/or JIRA/Linear/Notion. You don't pick the destination; the routing config does that based on which page you were on, what category you picked, and which feature flag was active.

If delivery fails (network issue, expired token, etc.), the widget shows an error with details. Snapshot what it says and ping whoever installed snapfeed.

## How to write feedback that actually gets fixed

Three things engineers and PMs care about:

1. **What you were trying to do.** "I was checking out with a promo code." Not "this page is broken."
2. **What you expected vs. what happened.** "I expected the discount to apply; the total didn't change."
3. **A screenshot with one annotation.** Circle the broken thing. Don't write paragraphs about which element — point at it.

For visual issues (alignment, spacing, contrast), the screenshot + annotation is enough. Skip the prose.

For flow issues (confusing copy, wrong navigation), say which step you were on. The widget already captures the URL automatically — you don't need to repeat that.

## Verify it works

When everything is wired correctly:

- Pressing the hotkey opens the widget within ~100ms.
- A screenshot of the current page is already attached (if `autoScreenshot` is on).
- After clicking Send, the overlay shows "Sent" and closes within 1–2 seconds.
- No red error banner appears.

If your team has a "feedback" channel in Slack, your message should appear there within a few seconds.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Hotkey does nothing | Browser extension or dev tool is intercepting the same shortcut (Firefox's "Find again" is a common offender). Click the floating button in the bottom-right corner instead. If there's no button, snapfeed isn't loaded on this page — ping whoever installed it. |
| Widget opens but Send shows an error | Network failure or the destination's token expired. Screenshot the error message and send it to whoever owns snapfeed for your team. |
| No screenshot thumbnail | `autoScreenshot` isn't enabled in your team's config, or `html2canvas` failed silently (some pages with strict CSP block it). You can still send text-only feedback. |
| Microphone or screen-record icons missing | Your team didn't enable the v0.4 voice / screen-recording features. Stick to text + screenshot. |
| You see the widget on a page customers can see | Bug — the widget is supposed to be off in production unless your team explicitly enables it for beta testers. Tell whoever installed snapfeed; they need `enableInProduction` either off or gated by role. |

---

**If your team hasn't installed snapfeed yet:** send them the [indie quickstart](./indie.md) — they can be live in 5 minutes.
