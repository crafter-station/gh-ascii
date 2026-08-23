# Fix: Stars & Languages wrong for users with >100 repos
Fixes [#2](https://github.com/crafter-station/gh-ascii/issues/2)
## TL;DR
`fetchRepos()` fetched only page 1 (`per_page=100`). Users with more than 100
public repos got silently wrong stats.
## Root cause
GitHub caps `per_page` at 100. Page 2+ was never requested, and sorting by
`pushed` means the dropped repos are the older ones - exactly where most
popular repos live.
## Fix design
- Loop pages until exhaustion, stop early when a page returns < 100 items
- Graceful degradation: mid-pagination failure returns partial data
- Zero behavior change for users with <= 100 repos (still exactly 1 request)
## Verification checklist
- [x] <=100 repos: identical output, 1 request
- [x] >100 repos: all pages counted
- [x] Rate-limit mid-loop: card still renders with partial stats
