# Enhanced Task Creation and Navigation Plan

The goal is to enhance the task creation experience with natural language parsing and explicit UI controls, and to restore the "Stats" navigation item.

## User Review Required

> [!IMPORTANT]
> - I am adding a "Stats" link to the navigation which will point to `/dashboard/stats`. Please confirm if this route exists or should be created. if it should be created then create it.
> - For the date and time picker, I will use a native HTML date input styled to look like the requested button  
> - strictly require a friend selection.

## Proposed Changes

### Navigation
#### [MODIFY] [NavLinks.tsx](file:///c:/LocalFiles/coding/vouch/src/components/NavLinks.tsx)
- Add "Stats" item to the `links` array pointing to `/dashboard/stats`.

### Dashboard Page
#### [MODIFY] [page.tsx](file:///c:/LocalFiles/coding/vouch/src/app/dashboard/page.tsx)
- Fetch `friends` list using `getFriends` action.
- Pass `friends` to `TaskInput` component.

### Task Input Component
#### [MODIFY] [TaskInput.tsx](file:///c:/LocalFiles/coding/vouch/src/components/TaskInput.tsx)
- Accept `friends` prop.
- Implement Natural Language Parser:
    - Parse `@HH:mm` or `@HH` for time.
    - Parse `vouch <name>` for voucher selection.
    - Logic: If time is passed for today, set for tomorrow.
- UI Enhancements:
    - Add "Date" button (triggers hidden date input).
    - Add "Voucher" dropdown (using `Select` component).
    - Sync text input with UI state (parsing updates the state).
    - specific "Shake" animation on the voucher dropdown if submission is attempted without a voucher.
- Update `handleSubmit`:
    - Combine text title (stripped of metadata) with selected date and voucher.
    - Call `createTask` with the consolidated data.

### Styles
#### [MODIFY] [globals.css](file:///c:/LocalFiles/coding/vouch/src/app/globals.css)
- Add `@keyframes shake` if not available for the error state.

## Verification Plan

### Manual Verification
- **Stats Tab**:
    - Build and navigate to `/dashboard`.
    - Verify "Stats" tab is visible.
    - Click and verify it navigates to `/dashboard/stats` (even if 404).

- **UI Controls**:
    - Click "Date" button -> Date picker opens -> Select date -> Verify date state.
    - Click "Voucher" dropdown -> Select friend -> Verify voucher state.
- **Validation**:
    - Enter `Buy milk` (no voucher).
    - Click Enter.
    - Verify Voucher dropdown shakes and no task is created.
