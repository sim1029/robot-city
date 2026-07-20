# Live-model calendar benchmark implementation plan

Approved implementation plan for an ad hoc, live-model benchmark of robot-city's calendar assistant behavior. The runner uses the production Discord handler and tool loop against a fixed fake Calendar and Discord environment, supports named classifier/reason-model configurations, runs ten calendar scenarios three times, and publishes intentional result snapshots to `docs/benchmarks.md`.

The first suite evaluates intent, action, calendar outcome, and final reply equally. It excludes email, approval flows, and event editing until those capabilities are benchmarked separately.
