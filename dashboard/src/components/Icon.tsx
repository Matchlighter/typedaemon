/** Shared MDI icon: `<Icon path={mdiCheck} />` (import paths from '@mdi/js'). Decorative unless `label` given. */
export function Icon({ path, size = 12, label, className }: { path: string; size?: number; label?: string; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}
            role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
            <path d={path} />
        </svg>
    );
}
