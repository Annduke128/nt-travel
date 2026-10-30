# Nightly price display

Status: verifying

The production room table displayed 5,318,950 VND for a two-night stay. Hotel cards, room summaries, program rows and allotment cells rendered full-stay `fromPrice`/`total` values, and the price filter also compared full-stay totals.

The display now divides those totals by the selected number of nights, labels prices per room/night and applies the same basis to price filters. Detail panels show the nightly price alongside an explicitly labeled full-stay total. Selection totals and booking request values retain the original full-stay amounts; nightly rates may differ, so comparison prices represent the average per night.

Regression tests cover one-, two- and five-night searches with the same nightly price, filtering by that price, and choosing two rooms without reducing the full-stay total. Before the fix, all three cases failed at the nightly price/label assertion. Existing program/allotment tests continue to check identities, selection quantities and booking totals.

The live read-only check for Vinpearl Resort & Spa Hạ Long, 25–27 November 2026, returned 5,318,950 VND for both the cheapest hotel offer and Deluxe King Ocean View. Dividing by two yields 2,659,475 VND per night, matching the reported case. The complete release gate passed all 191 tests, lint, type checking and both builds; production dependency audit reported zero vulnerabilities.
