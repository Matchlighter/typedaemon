import type { ReactNode } from 'react';

/** Confirmation copy for cancelling a running `@resumable` call (shared by the app tab and the overview) */
export const cancelResumableCopy = (call: string): { title: string; label: string; will: ReactNode; wont: ReactNode } => ({
    title: `Cancel ${call}?`, label: 'Cancel resumable',
    will: <>Stop this call. Its code sees a cancellation at its next step, and anything it awaits that can be cancelled is cancelled too.</>,
    wont: <>Touch other resumables, or undo what the call already did.</>,
});
