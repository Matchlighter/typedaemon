import { readFileSync } from 'node:fs';
import { mdiLightbulb, mdiToggleSwitch } from '@mdi/js';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EntityRow, domainIcon, entityDomain, type EntityRowProps } from './EntityRow';

const base: EntityRowProps = { entityId: 'sensor.office_temp', name: 'Office temperature', linked: true, state: '21.4' };
const html = (p: Partial<EntityRowProps> = {}) => renderToString(<EntityRow {...base} {...p} />);

describe('EntityRow', () => {
    it('linked: id, name, owner, state, linked badge, no unlinked styling', () => {
        const out = html({ owner: { id: 'lights' } });
        expect(out).toContain('sensor.office_temp');
        expect(out).toContain('Office temperature');
        expect(out).toContain('lights');
        expect(out).toContain('21.4');
        expect(out).toContain('badge-ok');
        expect(out).not.toContain('entity-unlinked');
    });

    it('unlinked: warn badge, muted state', () => {
        const out = html({ linked: false, state: undefined });
        expect(out).toContain('badge-outline-warn');
        expect(out).toContain('entity-unlinked');
        expect(out).toContain('unavailable');
        expect(out).toContain('entity-state-muted');
    });

    it('detailHref makes the entity id a link to its page', () => {
        expect(html({ detailHref: '#/entities/a%2Fb' })).toContain('<a class="mono entity-eid entity-eid-link" href="#/entities/a%2Fb"');
        expect(html()).not.toContain('entity-eid-link');
    });

    it('orphan owner is noted', () => {
        const out = html({ owner: { id: 'old_presence', orphan: true } });
        expect(out).toContain('old_presence');
        expect(out).toContain('(orphan)');
        expect(out).toContain('entity-owner-orphan');
    });

    it('owner with an href links to the app', () => {
        const out = html({ owner: { id: 'lights', href: '#/apps/lights' } });
        expect(out).toMatch(/<a[^>]*class="entity-owner"[^>]*href="#\/apps\/lights"[^>]*>lights<\/a>|<a[^>]*href="#\/apps\/lights"[^>]*class="entity-owner"[^>]*>lights<\/a>/);
        expect(html({ owner: { id: 'lights' } })).not.toContain('<a');
    });

    it('flags render only when set', () => {
        expect(html()).not.toContain('auto_clean');
        const out = html({ autoClean: true, persistState: true });
        expect(out).toContain('auto_clean');
        expect(out).toContain('persist_state');
        expect(html({ autoClean: true })).not.toContain('persist_state');
    });

    it('HA link only when href given, opens safely', () => {
        expect(html()).not.toContain('Open in Home Assistant');
        const out = html({ href: '/config/entities?search=sensor.office_temp' });
        expect(out).toContain('href="/config/entities?search=sensor.office_temp"');
        expect(out).toContain('aria-label="Open in Home Assistant"');
        expect(out).toContain('rel="noopener noreferrer"');
    });

    it('action slot renders', () => {
        expect(html({ action: <button className="btn btn-sm">Delete from HA</button> })).toContain('Delete from HA');
    });

    it('domain icon by entity_id domain, with fallback', () => {
        expect(entityDomain('light.kitchen')).toBe('light');
        expect(domainIcon('light.kitchen')).toBe(mdiLightbulb);
        expect(domainIcon('switch.fan')).toBe(mdiToggleSwitch);
        expect(domainIcon('weird_domain.x')).toBeTruthy();
        expect(html({ entityId: 'light.kitchen' })).toContain(mdiLightbulb);
    });
});

describe('entity.css', () => {
    const css = readFileSync(new URL('../styles/entity.css', import.meta.url), 'utf8');
    it('stacks at phone width', () => expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.entity-row/));
});
