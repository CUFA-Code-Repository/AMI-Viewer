// Folder ingestion (design_doc §2 "Folder loading", §8 missing-files).
// Three input paths converge on a RawFiles object: File System Access API
// directory handle, drag-and-drop DataTransfer, and <input webkitdirectory>.
import type { RawFiles } from '../model/types';

const WANTED = ['sensors.csv', 'gps.csv', 'score.csv', 'system.txt', 'config.txt'];

function matchName(name: string): keyof RawFiles | null {
  const n = name.toLowerCase();
  if (n.endsWith('sensors.csv')) return 'sensors';
  if (n.endsWith('gps.csv')) return 'gps';
  if (n.endsWith('score.csv')) return 'score';
  if (n.endsWith('system.txt')) return 'system';
  if (n.endsWith('config.txt')) return 'config';
  return null;
}

export function isFsAccessSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

/** Pick a directory via the File System Access API. */
export async function pickDirectory(): Promise<RawFiles | null> {
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker !== 'function') return null;
  const handle = await picker({ id: 'ami-session', mode: 'read' });
  return await readFromDirHandle(handle);
}

async function readFromDirHandle(dir: any): Promise<RawFiles> {
  const files: RawFiles = { sessionName: dir.name || 'session' };
  // config.txt may live in the session dir or its parent — we read whatever
  // is directly inside; parent fallback handled by caller if needed.
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind !== 'file') continue;
    const key = matchName(name);
    if (!key) continue;
    const file: File = await entry.getFile();
    (files as any)[key] = await file.text();
  }
  return files;
}

/** Read from a drag-drop DataTransfer (uses webkitGetAsEntry for folders). */
export async function readFromDataTransfer(dt: DataTransfer): Promise<RawFiles | null> {
  // Prefer the FS Access handle if the browser supplies it (Chrome).
  const items = Array.from(dt.items);
  for (const it of items) {
    const getHandle = (it as any).getAsFileSystemHandle;
    if (typeof getHandle === 'function') {
      const handle = await getHandle.call(it);
      if (handle && handle.kind === 'directory') return await readFromDirHandle(handle);
    }
  }
  // Fallback: walk webkitEntries.
  const entries = items
    .map((it) => (it as any).webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length) {
    const collected: File[] = [];
    let sessionName = 'session';
    for (const entry of entries) {
      if (entry.isDirectory) sessionName = entry.name;
      await walkEntry(entry, collected);
    }
    return filesToRaw(collected, sessionName);
  }
  // Last resort: plain files dropped (no directory structure).
  if (dt.files && dt.files.length) {
    return filesToRaw(Array.from(dt.files), 'session');
  }
  return null;
}

function walkEntry(entry: any, out: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f: File) => {
        // tag the folder name onto the file for session naming
        out.push(f);
        resolve();
      }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all: any[] = [];
      const readBatch = () => {
        reader.readEntries((batch: any[]) => {
          if (!batch.length) {
            Promise.all(all.map((e) => walkEntry(e, out))).then(() => resolve());
            return;
          }
          all.push(...batch);
          readBatch();
        }, () => resolve());
      };
      readBatch();
    } else resolve();
  });
}

/** Read from a multi-file <input webkitdirectory> selection. */
export async function readFromFileList(list: FileList): Promise<RawFiles | null> {
  const files = Array.from(list);
  if (!files.length) return null;
  // derive session name from the common top folder in webkitRelativePath
  let sessionName = 'session';
  const rel = (files[0] as any).webkitRelativePath as string | undefined;
  if (rel) sessionName = rel.split('/')[0] || sessionName;
  return filesToRaw(files, sessionName);
}

async function filesToRaw(files: File[], sessionName: string): Promise<RawFiles> {
  const raw: RawFiles = { sessionName };
  for (const f of files) {
    const key = matchName(f.name);
    if (!key) continue;
    // if duplicate names exist (config in root + session), prefer the deeper one
    (raw as any)[key] = await f.text();
  }
  return raw;
}

export function hasAnyKnownFile(raw: RawFiles): boolean {
  return WANTED.some((w) => {
    const k = matchName(w);
    return k && (raw as any)[k] != null;
  });
}
