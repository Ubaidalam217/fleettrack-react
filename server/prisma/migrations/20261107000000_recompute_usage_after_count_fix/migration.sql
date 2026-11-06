-- The local history answered a multi-device message query with `count`
-- applied to the whole answer instead of per device (fixed 2026-11-06), so a
-- fleet day was cut off after its first 3000 messages. Daily usage computed
-- from it since the webhook went live (2026-11-03) is short: mark those days
-- not final so the daily-usage job computes them again.
UPDATE "UsageDay" SET "final" = false WHERE "day" >= '2026-11-02';
