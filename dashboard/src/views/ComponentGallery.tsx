import { loadGallerySections } from '../gallery';

const sections = loadGallerySections();

/** Dev-only. See gallery.ts for how components register. */
export function ComponentGallery() {
    return (
        <>
            <div className="page-title"><h1>Components</h1></div>
            {sections.length === 0 && <div className="card">No components yet. Add a <code>*.gallery.tsx</code> file.</div>}
            {sections.map(s => (
                <section key={s.title} className="card">
                    <h2>{s.title}</h2>
                    <div style={{ marginTop: 12 }}>{s.render()}</div>
                </section>
            ))}
        </>
    );
}
