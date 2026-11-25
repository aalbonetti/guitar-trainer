// A set list saved on this phone by an earlier version. The app can't import one: it only reads it or removes it.
import { persisted } from './store';

export interface SetSong { name: string; plays: number; isNew: boolean; weeks: string[]; last: string | null; lastIndex: number; outlineId: string | null }
export interface SetList { weeks: string[]; songs: SetSong[]; importedAt: string }

const store = persisted<SetList | null>('gt_setlist_v1', null);
export const getSetList = () => store.get();
export const clearSetList = () => store.set(null);
