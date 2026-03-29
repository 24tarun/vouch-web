# Design System Module

This folder is the source of truth for reusable visual presets.

## Current exports

- `badges/`
  - `TaskStatusBadge`
  - `ActivityEventBadge`
  - `StatsRecurringBadge`
  - `StatsPomoBadge`
  - `HistoryTaskStatusBadge`
  - `VoucherDeadlineBadge`
  - `VoucherPomoAccumulatedBadge`
  - `VoucherProofRequestBadge`
  - `RecurringIndicator`
- `stat-metrics.ts`
  - `STAT_METRIC_PRESETS` with stable `id` values for stat-number styles and glows
- `task_detail_buttons.tsx`
  - `TASK_DETAIL_BUTTON_CLASSES` (ground truth for task detail button styles)
  - `TaskDetailButtonsShowcaseSection` (Section 9 renderer)

## How to use on new pages

1. Import from `@/design-system/badges` for all badge components.
2. Reference stable IDs (for example `active`, `pending-vouch`) when selecting stat styles.
3. Render shared components (`TaskStatusBadge`) for status badges to keep styling consistent.

## Goal

The `/design` page should render these shared presets directly so it remains a live component catalog.
