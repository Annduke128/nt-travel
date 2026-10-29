# Dialog focus restoration

Opened: 2026-10-29
Status: resolved

The browser scenario reproduced a focus loss after Escape: the dialog closed,
body scrolling was restored, but `document.activeElement` was `body`.
The dialog is conditionally mounted through a React portal. React removes the
native dialog before its passive-effect cleanup calls `close()`, so the browser
cannot restore focus through that close call alone.

The modal effect now captures the invoking element before `showModal()` and
explicitly restores focus during cleanup when that element is still connected.
The same Escape and focus assertion will run again in the browser scenario.

The next native-browser check found that Tab from the last control can move focus
to browser chrome (`document.hasFocus() === false`) while the dialog remains
`:modal` and the page behind it is inert. Explicit first/last Tab boundaries keep
keyboard navigation within the editor. The unit test reproduces the missing
boundary before that handler is added.

The full test run also exposed that the dialog platform shim in the shared test
setup ran in Node suites. Guarding it by `typeof HTMLDialogElement` keeps the shim
restricted to DOM environments. No server behavior changes are needed.

Final verification: all 176 tests in 14 files pass, including Tab boundaries and
focus restoration. The native Chrome scenario completed eight rooms / sixteen
guests, Escape close/reopen, draft reload, missing-guest blocking, and one final
mock booking. Dialog bounds and visibility of the last guest field above the
footer were checked at widths 1440, 1024, 390, and 320. The scroll viewport is a
div around the disabled-capable fieldset, avoiding anonymous-fieldset overflow.
