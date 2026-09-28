import { describe, expectTypeOf, it } from 'vitest';
import { track, trackElement } from '../src/index';

/** Typical app code: props typed with an interface, carrying a Date and an unknown. */
interface TileProps {
  tile: string;
  at: Date;
}

interface ClickProps {
  element_id: number;
  segment_id?: number;
  label: string;
  opened: Date;
}

describe('public prop types', () => {
  it('track() accepts interface-typed props, Date and unknown values', () => {
    const props: TileProps = { tile: 'revenue', at: new Date() };
    const value: unknown = JSON.parse('1');

    track('tile_clicked', props);
    track('tile_clicked', { at: new Date(), value });
    track('tile_clicked');
  });

  it('trackElement() accepts interface-typed props with extra keys', () => {
    const props: ClickProps = { element_id: 4417, label: 'Q3 Revenue', opened: new Date() };
    const value: unknown = JSON.parse('1');

    trackElement(props);
    trackElement({ element_id: 4417, segment_id: 12, value, opened: new Date() });
  });

  it('trackElement() still requires a numeric element_id', () => {
    // @ts-expect-error element_id is required
    trackElement({ label: 'x' });
    // @ts-expect-error element_id must be a number
    trackElement({ element_id: '4417' });
    expectTypeOf(trackElement).returns.toEqualTypeOf<void>();
  });
});
