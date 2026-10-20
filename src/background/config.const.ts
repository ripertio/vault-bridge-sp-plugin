export const SYNC_DEBOUNCE_MS = 500;
export const SYNC_DEBOUNCE_MS_MD_TO_SP = 10000; // 10 seconds for MD to SP sync when window is not focused
export const FILE_WATCH_POLL_INTERVAL_MS = 2000;

// Cooldown after MD→SP sync to suppress SP hooks that fire as side-effects
// of the batch update. Must be > SYNC_DEBOUNCE_MS to outlast the debounce window.
export const SP_HOOK_COOLDOWN_MS = 2000;

// Bug #48: when an automatic project-existence check still finds the bound project
// present, that may be a rename/reorder OR SP's project store may not yet have
// dropped a just-deleted project. Re-check once after this delay to disambiguate
// before concluding the project still exists (a rename stays present; a lagged
// deletion becomes absent → the missing-project dialog opens proactively).
export const PROJECT_MISSING_RECHECK_MS = 800;

// Bug #48: deleting the ACTIVE SP project triggers a burst of churn — SP routes away
// from the deleted view and tears it down, its own delete-confirm animates out, and
// the surviving bindings run their MD→SP batch updates. A modal `openDialog` fired
// inside that window gets DISMISSED by the navigation (observed in the SP console as
// `PluginBridge: Dialog closed` with no user click). So the proactive dialog is held
// back by this settle delay and opened once the churn is over; the immediate
// heads-up is the snack, which paints from the background and survives navigation.
// Measured in vivo (SP 18.16, macOS): delete → dialog ≈ 2.0 s, with the surviving
// bindings' syncs completing inside the wait.
export const PROJECT_DELETE_SETTLE_MS = 2000;
