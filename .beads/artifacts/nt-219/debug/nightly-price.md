# Nightly price display

Status: resolved

The production room table displayed 5,318,950 VND for a two-night stay. Hotel cards, room summaries, program rows and allotment cells rendered full-stay `fromPrice`/`total` values, and the price filter also compared full-stay totals.

The display now divides those totals by the selected number of nights, labels prices per room/night and applies the same basis to price filters. Detail panels show the nightly price alongside an explicitly labeled full-stay total. Selection totals and booking request values retain the original full-stay amounts; nightly rates may differ, so comparison prices represent the average per night.

Regression tests cover one-, two- and five-night searches with the same nightly price, filtering by that price, and choosing two rooms without reducing the full-stay total. Before the fix, all three cases failed at the nightly price/label assertion. Existing program/allotment tests continue to check identities, selection quantities and booking totals.

The live read-only check for Vinpearl Resort & Spa Hạ Long, 25–27 November 2026, returned 5,318,950 VND for both the cheapest hotel offer and Deluxe King Ocean View. Dividing by two yields 2,659,475 VND per night, matching the reported case. The complete release gate passed all 191 tests, lint, type checking and both builds; production dependency audit reported zero vulnerabilities.

Release `bb8eb01` was deployed to the existing Compose service. Image `sha256:ae21425afac3fce0b5634d7f1d448418d57ce42aeb1fadf8df20420f5e2c1a4b` is healthy with zero restarts; production configuration was preserved and the prior image retained as `nt-travel:rollback-before-bb8eb01`. Public live/ready endpoints return HTTP 200, and the public JavaScript SHA-256 matches the container. Browser checks against local and public assets used isolated API fixtures for one-, two- and five-night stays, preserving two-room totals of 5,318,950 / 10,637,900 / 26,594,750 VND with no page errors or desktop/mobile overflow. No live booking was created.
