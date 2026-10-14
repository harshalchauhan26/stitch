// Reads the files a person picks (WhatsApp "Export chat" .zip or .txt) in the browser and returns [{ name, text } | { name, error }].
// Reading happens here so nothing is uploaded until the person clicks "Read chats".
import { unzipSync, strFromU8 } from 'fflate';

export const MAX_CHATS = 30;
const base = (n) => n.split('/').pop();

async function textFromZip(file) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (e) => /\.txt$/i.test(e.name) && !e.name.startsWith('__MACOSX') && !base(e.name).startsWith('._') });
  const names = Object.keys(entries);
  if (!names.length) return { error: 'No chat text file found inside this zip' };
  // WhatsApp names it "_chat.txt"; some tools use "chat.txt". Otherwise take the biggest .txt.
  const pick = names.find((n) => /^_?chat\.txt$/i.test(base(n))) || names.sort((a, b) => entries[b].length - entries[a].length)[0];
  return { text: strFromU8(entries[pick]).replace(/^\ufeff/, '') };
}

export async function readChatFiles(fileList) {
  const out = [];
  for (const file of fileList) {
    try {
      if (/\.zip$/i.test(file.name)) out.push({ name: file.name, ...(await textFromZip(file)) });
      else if (/\.txt$/i.test(file.name)) out.push({ name: file.name, text: (await file.text()).replace(/^\ufeff/, '') });
      else out.push({ name: file.name, error: 'Only .zip or .txt chat exports are supported' });
    } catch (e) { out.push({ name: file.name, error: 'Could not open this file' }); }
  }
  return out;
}